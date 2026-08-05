"use strict";

const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const {
  evaluateNaturalLight,
  normalizeNaturalLightInput,
  createNaturalLightSceneState,
  generateSkyViewLut,
  generateTransmittanceLut,
  generateMultipleScatteringLut
} = require("./src/natural-light");

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INTERNAL_PORT = Number(process.env.SKYFORGE_INTERNAL_PORT || (PUBLIC_PORT === 3000 ? 3001 : PUBLIC_PORT + 1));
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = Number(process.env.SKYFORGE_MAX_LIGHTING_BODY || 8_000_000);
const BLENDER_HOST = "127.0.0.1";
const BLENDER_PORT = Number(process.env.SKYFORGE_BLENDER_PORT || 8765);
const BRIDGE_DIR = path.join(__dirname, "data", "bridge");
const BLENDER_SPOOL_FILE = path.join(BRIDGE_DIR, "blender-world-latest.json");
const CLIENT_TAGS = [
  '<link rel="stylesheet" href="/natural-light-ergonomics.css">',
  '<link rel="stylesheet" href="/src/client/core/skyforge-core-v11.css">',
  '<script src="/natural-light-preview.js" defer></script>',
  '<script src="/natural-light-dashboard.js" defer></script>',
  '<script type="module" src="/src/client/core/bootstrap.js"></script>'
];

let backendProcess = null;
let shuttingDown = false;

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2));
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

function injectClients(html) {
  let source = String(html || "");
  const injection = CLIENT_TAGS.filter((tag) => !source.includes(tag)).join("\n");
  if (!injection) return source;
  return /<\/body\s*>/i.test(source)
    ? source.replace(/<\/body\s*>/i, `${injection}\n</body>`)
    : `${source}\n${injection}\n`;
}

function shouldInject(req, upstream) {
  const type = String(upstream.headers["content-type"] || "").toLowerCase();
  const encoding = String(upstream.headers["content-encoding"] || "").toLowerCase();
  return req.method === "GET" && upstream.statusCode === 200 && type.includes("text/html") && !encoding;
}

function proxyRequest(req, res) {
  const upstreamRequest = http.request({
    hostname: HOST,
    port: INTERNAL_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${HOST}:${INTERNAL_PORT}` }
  }, (upstream) => {
    if (!shouldInject(req, upstream)) {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
      return;
    }
    const chunks = [];
    upstream.on("data", (chunk) => chunks.push(chunk));
    upstream.on("end", () => {
      const body = Buffer.from(injectClients(Buffer.concat(chunks).toString("utf8")), "utf8");
      const headers = { ...upstream.headers, "content-length": String(body.length), "cache-control": "no-cache" };
      delete headers.etag;
      res.writeHead(upstream.statusCode || 200, headers);
      res.end(body);
    });
  });
  upstreamRequest.on("error", (error) => {
    if (!res.headersSent) sendJson(res, 502, { error: "SkyForge core backend is unavailable", detail: error.message });
    else res.destroy(error);
  });
  req.pipe(upstreamRequest);
}

function spawnBackend() {
  backendProcess = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(INTERNAL_PORT) },
    stdio: "inherit",
    windowsHide: true
  });
  backendProcess.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`SkyForge backend exited unexpectedly (code=${code}, signal=${signal || "none"})`);
      process.exitCode = code || 1;
    }
  });
}

function requestJson({ hostname, port, route, method = "GET", payload = null, timeout = 900 }) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? null : Buffer.from(JSON.stringify(payload));
    const request = http.request({
      hostname,
      port,
      path: route,
      method,
      timeout,
      headers: body ? { "Content-Type": "application/json", "Content-Length": body.length } : {}
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let result = {};
        try { result = text ? JSON.parse(text) : {}; } catch { result = { raw: text }; }
        if ((response.statusCode || 500) >= 400) return reject(new Error(result.error || `Request failed (${response.statusCode})`));
        resolve({ statusCode: response.statusCode || 200, payload: result });
      });
    });
    request.on("timeout", () => request.destroy(new Error("Request timed out")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function backendHealthCheck() {
  try {
    await requestJson({ hostname: HOST, port: INTERNAL_PORT, route: "/api/health", timeout: 500 });
    return true;
  } catch {
    return false;
  }
}

async function waitForBackend(attempts = 60, delayMs = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await backendHealthCheck()) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

function normalizeLightingInput(body = {}) {
  try {
    return normalizeNaturalLightInput(body);
  } catch (error) {
    error.statusCode = 400;
    throw error;
  }
}

function buildPhysicalPreview(body = {}) {
  const input = normalizeLightingInput(body);
  return {
    apiVersion: "0.5.0",
    input,
    sceneState: createNaturalLightSceneState(input),
    evaluation: evaluateNaturalLight(input),
    skyViewLut: generateSkyViewLut({ input, lut: body.lut || {} }),
    transmittanceLut: generateTransmittanceLut({
      input,
      transmittanceLut: body.transmittanceLut || { width: 32, height: 16, maxAltitudeMeters: 20_000 }
    }),
    multipleScatteringLut: generateMultipleScatteringLut({
      input,
      multipleScatteringLut: body.multipleScatteringLut || { width: 16, height: 8, maxAltitudeMeters: 20_000 }
    })
  };
}

async function blenderHealth() {
  try {
    const response = await requestJson({ hostname: BLENDER_HOST, port: BLENDER_PORT, route: "/skyforge/health", timeout: 650 });
    return { connected: true, ...response.payload };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

async function spoolBlenderPayload(payload) {
  await fs.mkdir(BRIDGE_DIR, { recursive: true });
  await fs.writeFile(BLENDER_SPOOL_FILE, JSON.stringify(payload, null, 2), "utf8");
}

async function sendToBlender(payload) {
  const normalized = {
    protocol: "skyforge.blender.world.v1",
    sentAt: payload.sentAt || new Date().toISOString(),
    project: payload.project || {},
    sun: payload.sun || {},
    atmosphere: payload.atmosphere || {},
    clouds: payload.clouds || {},
    color: payload.color || {},
    render: payload.render || {},
    hdriPath: payload.hdriPath || null,
    rotation: Number(payload.rotation || 0),
    strength: Number(payload.strength ?? payload.sun?.intensity ?? 1)
  };
  await spoolBlenderPayload(normalized);
  try {
    const result = await requestJson({ hostname: BLENDER_HOST, port: BLENDER_PORT, route: "/skyforge/world", method: "POST", payload: normalized, timeout: 1800 });
    return { ok: true, forwarded: true, sentAt: normalized.sentAt, spoolFile: BLENDER_SPOOL_FILE, blender: result.payload };
  } catch (error) {
    return { ok: true, forwarded: false, queued: true, sentAt: normalized.sentAt, spoolFile: BLENDER_SPOOL_FILE, detail: error.message };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS" && (url.pathname.startsWith("/api/lighting") || url.pathname.startsWith("/api/bridge"))) {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/core/health") {
    sendJson(res, 200, {
      ok: true,
      service: "skyforge-core-v11",
      version: "0.5.0",
      appVersion: "v11",
      build: "CORE11",
      projectSchema: 3,
      backendPort: INTERNAL_PORT,
      blenderPort: BLENDER_PORT,
      injectedClients: CLIENT_TAGS.length
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/lighting/health") {
    sendJson(res, 200, {
      ok: true,
      service: "skyforge-natural-light",
      apiVersion: "0.5.0",
      model: "skyforge-natural-light-phase4",
      modelVersion: "0.4.0",
      previewClientVersion: "0.4.0",
      coreVersion: "v11",
      endpoints: ["POST /api/lighting/evaluate", "POST /api/lighting/scene-state", "POST /api/lighting/lut/sky-view", "POST /api/lighting/lut/transmittance", "POST /api/lighting/lut/multiple-scattering", "POST /api/lighting/preview"]
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bridge/blender/health") {
    sendJson(res, 200, await blenderHealth());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bridge/blender/send") {
    try {
      sendJson(res, 202, await sendToBlender(await readJsonBody(req)));
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Blender bridge failed" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lighting/evaluate") {
    try { sendJson(res, 200, evaluateNaturalLight(normalizeLightingInput(await readJsonBody(req)))); }
    catch (error) { sendJson(res, error.statusCode || 500, { error: error.message || "Natural-light evaluation failed" }); }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lighting/scene-state") {
    try { sendJson(res, 200, createNaturalLightSceneState(await readJsonBody(req))); }
    catch (error) { sendJson(res, error.statusCode || 400, { error: error.message || "Scene-state normalization failed" }); }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lighting/lut/sky-view") {
    try { sendJson(res, 200, generateSkyViewLut(await readJsonBody(req))); }
    catch (error) { sendJson(res, error.statusCode || 400, { error: error.message || "Sky-view LUT failed" }); }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lighting/lut/transmittance") {
    try { sendJson(res, 200, generateTransmittanceLut(await readJsonBody(req))); }
    catch (error) { sendJson(res, error.statusCode || 400, { error: error.message || "Transmittance LUT failed" }); }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lighting/lut/multiple-scattering") {
    try { sendJson(res, 200, generateMultipleScatteringLut(await readJsonBody(req))); }
    catch (error) { sendJson(res, error.statusCode || 400, { error: error.message || "Multiple-scattering LUT failed" }); }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lighting/preview") {
    try { sendJson(res, 200, buildPhysicalPreview(await readJsonBody(req))); }
    catch (error) { sendJson(res, error.statusCode || 400, { error: error.message || "Physical preview failed" }); }
    return;
  }

  proxyRequest(req, res);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping SkyForge services...`);
  server.close(() => {
    if (backendProcess && !backendProcess.killed) backendProcess.kill();
    process.exit(0);
  });
  setTimeout(() => {
    if (backendProcess && !backendProcess.killed) backendProcess.kill("SIGKILL");
    process.exit(1);
  }, 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function start() {
  await fs.mkdir(BRIDGE_DIR, { recursive: true });
  spawnBackend();
  if (!await waitForBackend()) throw new Error(`SkyForge backend did not become ready on port ${INTERNAL_PORT}`);
  server.listen(PUBLIC_PORT, HOST, () => {
    console.log(`SkyForge Core v11: http://${HOST}:${PUBLIC_PORT}`);
    console.log(`Core health: http://${HOST}:${PUBLIC_PORT}/api/core/health`);
    console.log(`Physical lighting: POST http://${HOST}:${PUBLIC_PORT}/api/lighting/preview`);
    console.log(`Blender bridge: POST http://${HOST}:${PUBLIC_PORT}/api/bridge/blender/send`);
  });
}

start().catch((error) => {
  console.error(error);
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
  process.exit(1);
});
