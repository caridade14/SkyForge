"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const {
  normalizeNaturalLightInput,
  evaluateNaturalLight,
  createPhase5RenderState,
  PHASE5_RENDERER_VERSION
} = require("./src/natural-light");
const { injectPhase5Client } = require("./src/natural-light/phase5-runtime-utils");

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INNER_PORT = Number(process.env.SKYFORGE_PHASE5_INNER_PORT || (PUBLIC_PORT === 3000 ? 3001 : PUBLIC_PORT + 1));
const CORE_PORT = Number(process.env.SKYFORGE_INTERNAL_PORT || INNER_PORT + 1);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = Number(process.env.SKYFORGE_MAX_LIGHTING_BODY || 1_000_000);
const PHASE5_CLIENT_PATH = path.join(__dirname, "natural-light-phase5.js");

let childProcess = null;
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

function shouldInject(req, upstreamResponse) {
  const contentType = String(upstreamResponse.headers["content-type"] || "").toLowerCase();
  const contentEncoding = String(upstreamResponse.headers["content-encoding"] || "").toLowerCase();
  return req.method === "GET" && upstreamResponse.statusCode === 200 && contentType.includes("text/html") && !contentEncoding;
}

function proxyRequest(req, res) {
  const headers = { ...req.headers, host: `${HOST}:${INNER_PORT}` };
  const upstream = http.request({
    hostname: HOST,
    port: INNER_PORT,
    path: req.url,
    method: req.method,
    headers
  }, (upstreamResponse) => {
    if (!shouldInject(req, upstreamResponse)) {
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
      return;
    }
    const chunks = [];
    upstreamResponse.on("data", (chunk) => chunks.push(chunk));
    upstreamResponse.on("end", () => {
      const injected = Buffer.from(injectPhase5Client(Buffer.concat(chunks).toString("utf8")), "utf8");
      const responseHeaders = { ...upstreamResponse.headers };
      delete responseHeaders["content-length"];
      delete responseHeaders.etag;
      responseHeaders["content-length"] = String(injected.length);
      responseHeaders["cache-control"] = "no-cache";
      res.writeHead(upstreamResponse.statusCode || 200, responseHeaders);
      res.end(injected);
    });
  });
  upstream.on("error", (error) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: "SkyForge Natural Light Phase 4 gateway is unavailable", detail: error.message });
    } else {
      res.destroy(error);
    }
  });
  req.pipe(upstream);
}

function spawnPhase4Gateway() {
  childProcess = spawn(process.execPath, [path.join(__dirname, "server-natural-light.js")], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(INNER_PORT),
      SKYFORGE_INTERNAL_PORT: String(CORE_PORT)
    },
    stdio: "inherit",
    windowsHide: true
  });
  childProcess.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`SkyForge Natural Light Phase 4 gateway exited unexpectedly (code=${code}, signal=${signal || "none"})`);
      process.exitCode = code || 1;
    }
  });
}

function childHealthCheck() {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: HOST,
      port: INNER_PORT,
      path: "/api/lighting/health",
      timeout: 700
    }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForChild(attempts = 80, delayMs = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await childHealthCheck()) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname.startsWith("/api/lighting/phase5") && req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/natural-light-phase5.js") {
    fs.readFile(PHASE5_CLIENT_PATH, (error, content) => {
      if (error) {
        sendJson(res, 404, { error: "Phase 5 client not found" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Content-Length": content.length,
        "Cache-Control": "no-cache"
      });
      res.end(content);
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/lighting/phase5/health") {
    sendJson(res, 200, {
      ok: true,
      service: "skyforge-natural-light-phase5",
      version: PHASE5_RENDERER_VERSION,
      hdr: "RGBA16F scene-linear",
      workingSpace: "ACEScg",
      toneMapper: "ACES-fitted",
      atmosphere: "Rayleigh-Mie-ozone-multiple-scattering",
      clouds: "Beer-Lambert + Henyey-Greenstein reference",
      pbr: "Cook-Torrance GGX",
      previewBackend: "Canvas2D reference",
      preferredBackends: ["WebGPU", "WebGL2"],
      finalRenderer: "Cycles bridge planned"
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/lighting/phase5/pipeline") {
    try {
      const body = await readJsonBody(req);
      const input = normalizeNaturalLightInput(body);
      const evaluation = evaluateNaturalLight(input);
      sendJson(res, 200, {
        apiVersion: PHASE5_RENDERER_VERSION,
        input,
        evaluation,
        renderState: createPhase5RenderState(body, evaluation)
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: error.message || "Phase 5 render-state generation failed" });
    }
    return;
  }

  proxyRequest(req, res);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping SkyForge Phase 5 services...`);
  server.close(() => {
    if (childProcess && !childProcess.killed) childProcess.kill();
    process.exit(0);
  });
  setTimeout(() => {
    if (childProcess && !childProcess.killed) childProcess.kill("SIGKILL");
    process.exit(1);
  }, 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function start() {
  spawnPhase4Gateway();
  if (!(await waitForChild())) {
    throw new Error(`SkyForge Natural Light Phase 4 gateway did not become ready on port ${INNER_PORT}`);
  }
  server.listen(PUBLIC_PORT, HOST, () => {
    console.log(`SkyForge Natural Light Phase 5: http://${HOST}:${PUBLIC_PORT}`);
    console.log(`Phase 5 render-state API: POST http://${HOST}:${PUBLIC_PORT}/api/lighting/phase5/pipeline`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    if (childProcess && !childProcess.killed) childProcess.kill();
    process.exit(1);
  });
}

module.exports = { injectPhase5Client };
