"use strict";

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { evaluateNaturalLight } = require("./src/natural-light");

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INTERNAL_PORT = Number(
  process.env.SKYFORGE_INTERNAL_PORT || (PUBLIC_PORT === 3000 ? 3001 : PUBLIC_PORT + 1)
);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = Number(process.env.SKYFORGE_MAX_LIGHTING_BODY || 1_000_000);

let backendProcess = null;
let shuttingDown = false;

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2));
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
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

function normalizeLightingInput(body = {}) {
  const source = body.input || body.naturalLight || body;
  const required = ["latitude", "longitude", "dateTime"];
  const missing = required.filter((key) => source[key] === undefined || source[key] === null || source[key] === "");

  if (missing.length) {
    const error = new Error(`Missing required fields: ${missing.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  return source;
}

function proxyRequest(req, res) {
  const headers = { ...req.headers, host: `${HOST}:${INTERNAL_PORT}` };
  const upstream = http.request(
    {
      hostname: HOST,
      port: INTERNAL_PORT,
      path: req.url,
      method: req.method,
      headers
    },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    }
  );

  upstream.on("error", (error) => {
    if (!res.headersSent) {
      sendJson(res, 502, {
        error: "SkyForge backend is unavailable",
        detail: error.message
      });
    } else {
      res.destroy(error);
    }
  });

  req.pipe(upstream);
}

function spawnBackend() {
  backendProcess = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(INTERNAL_PORT)
    },
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

function backendHealthCheck() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: HOST,
        port: INTERNAL_PORT,
        path: "/api/health",
        timeout: 500
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      }
    );

    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForBackend(attempts = 50, delayMs = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await backendHealthCheck()) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname.startsWith("/api/lighting") && req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/lighting/health") {
    sendJson(res, 200, {
      ok: true,
      service: "skyforge-natural-light",
      model: "skyforge-natural-light-phase1",
      modelVersion: "0.1.0",
      backendPort: INTERNAL_PORT
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/lighting/evaluate") {
    try {
      const body = await readJsonBody(req);
      const input = normalizeLightingInput(body);
      sendJson(res, 200, evaluateNaturalLight(input));
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.message || "Natural-light evaluation failed"
      });
    }
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
  spawnBackend();
  const ready = await waitForBackend();
  if (!ready) {
    throw new Error(`SkyForge backend did not become ready on port ${INTERNAL_PORT}`);
  }

  server.listen(PUBLIC_PORT, HOST, () => {
    console.log(`SkyForge Natural Light gateway: http://${HOST}:${PUBLIC_PORT}`);
    console.log(`Physical lighting API: POST http://${HOST}:${PUBLIC_PORT}/api/lighting/evaluate`);
  });
}

start().catch((error) => {
  console.error(error);
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
  process.exit(1);
});
