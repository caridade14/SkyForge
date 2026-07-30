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
const {
  estimateGalaxy,
  createGalaxySceneState,
  GALAXY_ENGINE_VERSION
} = require("./src/phase6");
const { injectPhase5Client } = require("./src/natural-light/phase5-runtime-utils");
const { injectPhase6Clients } = require("./src/phase6/runtime-utils");

const PHASE6_VERSION = "0.6.0";
const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INNER_PORT = Number(process.env.SKYFORGE_PHASE6_INNER_PORT || (PUBLIC_PORT === 3000 ? 3001 : PUBLIC_PORT + 1));
const CORE_PORT = Number(process.env.SKYFORGE_INTERNAL_PORT || INNER_PORT + 1);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = Number(process.env.SKYFORGE_MAX_LIGHTING_BODY || 1_000_000);

const STATIC_FILES = Object.freeze({
  "/natural-light-phase5.js": {
    path: path.join(__dirname, "natural-light-phase5.js"),
    type: "application/javascript; charset=utf-8"
  },
  "/phase6-gpu-renderer.js": {
    path: path.join(__dirname, "phase6-gpu-renderer.js"),
    type: "application/javascript; charset=utf-8"
  },
  "/galaxy-builder.js": {
    path: path.join(__dirname, "galaxy-builder.js"),
    type: "application/javascript; charset=utf-8"
  },
  "/phase6-gpu.css": {
    path: path.join(__dirname, "phase6-gpu.css"),
    type: "text/css; charset=utf-8"
  }
});

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

function serveStatic(res, entry) {
  fs.readFile(entry.path, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: "SkyForge Phase 6 asset not found", detail: path.basename(entry.path) });
      return;
    }
    res.writeHead(200, {
      "Content-Type": entry.type,
      "Content-Length": content.length,
      "Cache-Control": "no-cache"
    });
    res.end(content);
  });
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

function normalizeProxyHeaders(headers, bodyLength = null) {
  const normalized = { ...headers };
  delete normalized["transfer-encoding"];
  if (bodyLength === null) {
    if (normalized["content-length"] && headers["transfer-encoding"]) delete normalized["content-length"];
  } else {
    delete normalized["content-length"];
    normalized["content-length"] = String(bodyLength);
  }
  delete normalized.etag;
  normalized["cache-control"] = "no-cache";
  return normalized;
}

function proxyRequest(req, res) {
  const headers = { ...req.headers, host: `${HOST}:${INNER_PORT}` };
  const upstream = http.request({
    hostname: HOST,
    port: INNER_PORT,
    path: req.url,
    method: req.method,
    headers,
    insecureHTTPParser: true
  }, (upstreamResponse) => {
    if (!shouldInject(req, upstreamResponse)) {
      res.writeHead(upstreamResponse.statusCode || 502, normalizeProxyHeaders(upstreamResponse.headers));
      upstreamResponse.pipe(res);
      return;
    }
    const chunks = [];
    upstreamResponse.on("data", (chunk) => chunks.push(chunk));
    upstreamResponse.on("end", () => {
      const original = Buffer.concat(chunks).toString("utf8");
      const injectedHtml = injectPhase6Clients(injectPhase5Client(original));
      const injected = Buffer.from(injectedHtml, "utf8");
      res.writeHead(
        upstreamResponse.statusCode || 200,
        normalizeProxyHeaders(upstreamResponse.headers, injected.length)
      );
      res.end(injected);
    });
  });
  upstream.on("error", (error) => {
    if (!res.headersSent) {
      sendJson(res, 502, {
        error: "SkyForge Natural Light gateway is unavailable",
        detail: error.message
      });
    } else {
      res.destroy(error);
    }
  });
  req.pipe(upstream);
}

function spawnNaturalLightGateway() {
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
      console.error(`SkyForge Natural Light gateway exited unexpectedly (code=${code}, signal=${signal || "none"})`);
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

function phase6Health() {
  return {
    ok: true,
    service: "skyforge-phase6-gpu-galaxy",
    version: PHASE6_VERSION,
    naturalLightVersion: PHASE5_RENDERER_VERSION,
    galaxyEngineVersion: GALAXY_ENGINE_VERSION,
    viewport: {
      preferredBackend: "WebGPU",
      fallbackBackend: "WebGL2",
      renderer: "procedural HDR full-screen GPU",
      toneMapper: "ACES fitted",
      features: [
        "physical atmosphere composite",
        "procedural volumetric cloud approximation",
        "aerial perspective",
        "sun disc and directional lighting",
        "PBR reference objects",
        "ground-bounce approximation",
        "procedural galaxies",
        "GPU animation and quality presets"
      ]
    },
    galaxyBuilder: {
      menu: "Galaxy",
      types: ["spiral", "barred", "elliptical", "irregular", "ring"],
      presets: ["Milky Way", "Andromeda", "Sombrero", "Whirlpool", "Starburst", "Elliptical", "Ring"]
    },
    endpoints: [
      "GET /api/phase6/health",
      "POST /api/phase6/galaxy/build",
      "POST /api/phase6/scene-state",
      "GET /api/lighting/phase5/health",
      "POST /api/lighting/phase5/pipeline"
    ]
  };
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if ((requestUrl.pathname.startsWith("/api/phase6") || requestUrl.pathname.startsWith("/api/lighting/phase5")) && req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  const staticEntry = STATIC_FILES[requestUrl.pathname];
  if (req.method === "GET" && staticEntry) {
    serveStatic(res, staticEntry);
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/phase6/health") {
    sendJson(res, 200, phase6Health());
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/phase6/galaxy/build") {
    try {
      const body = await readJsonBody(req);
      sendJson(res, 200, estimateGalaxy(body));
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: error.message || "Galaxy generation failed" });
    }
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/phase6/scene-state") {
    try {
      const body = await readJsonBody(req);
      const input = normalizeNaturalLightInput(body);
      const evaluation = evaluateNaturalLight(input);
      sendJson(res, 200, {
        apiVersion: PHASE6_VERSION,
        input,
        evaluation,
        renderState: createPhase5RenderState(body, evaluation),
        galaxyState: createGalaxySceneState(body)
      });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: error.message || "Phase 6 scene-state generation failed" });
    }
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/lighting/phase5/health") {
    sendJson(res, 200, {
      ok: true,
      service: "skyforge-natural-light-phase5",
      version: PHASE5_RENDERER_VERSION,
      hdr: "RGBA16F scene-linear contract",
      workingSpace: "ACEScg",
      toneMapper: "ACES-fitted",
      atmosphere: "Rayleigh-Mie-ozone-multiple-scattering",
      clouds: "Beer-Lambert + Henyey-Greenstein reference",
      pbr: "Cook-Torrance GGX",
      previewBackend: "Phase 6 WebGPU/WebGL2 GPU composite",
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
  console.log(`Received ${signal}; stopping SkyForge Phase 6 services...`);
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
  spawnNaturalLightGateway();
  if (!(await waitForChild())) {
    throw new Error(`SkyForge Natural Light gateway did not become ready on port ${INNER_PORT}`);
  }
  server.listen(PUBLIC_PORT, HOST, () => {
    console.log(`SkyForge Phase 6 GPU + Galaxy Builder: http://${HOST}:${PUBLIC_PORT}`);
    console.log(`Phase 6 health: GET http://${HOST}:${PUBLIC_PORT}/api/phase6/health`);
    console.log(`Galaxy build API: POST http://${HOST}:${PUBLIC_PORT}/api/phase6/galaxy/build`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    if (childProcess && !childProcess.killed) childProcess.kill();
    process.exit(1);
  });
}

module.exports = {
  PHASE6_VERSION,
  phase6Health,
  normalizeProxyHeaders,
  start
};
