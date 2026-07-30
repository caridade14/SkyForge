"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const {
  PHASE7_VERSION,
  normalizeOpenMeteoPayload,
  weatherToRenderState,
  computeMoonState,
  injectPhase7Clients
} = require("./src/phase7");

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INNER_PORT = Number(process.env.SKYFORGE_PHASE7_INNER_PORT || (PUBLIC_PORT === 3000 ? 3001 : PUBLIC_PORT + 1));
const NATURAL_LIGHT_PORT = Number(process.env.SKYFORGE_PHASE6_INNER_PORT || INNER_PORT + 1);
const CORE_PORT = Number(process.env.SKYFORGE_INTERNAL_PORT || NATURAL_LIGHT_PORT + 1);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = Number(process.env.SKYFORGE_MAX_BODY || 1_000_000);
const CACHE_TTL_MS = 5 * 60 * 1000;

const STATIC_FILES = Object.freeze({
  "/phase7-gpu-renderer.js": { path: path.join(__dirname, "phase7-gpu-renderer.js"), type: "application/javascript; charset=utf-8" },
  "/phase7-functional-controller.js": { path: path.join(__dirname, "phase7-functional-controller.js"), type: "application/javascript; charset=utf-8" },
  "/phase7-functional.css": { path: path.join(__dirname, "phase7-functional.css"), type: "text/css; charset=utf-8" }
});

let childProcess = null;
let shuttingDown = false;
const weatherCache = new Map();

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
    if (error) return sendJson(res, 404, { error: "Phase 7 asset not found", detail: path.basename(entry.path) });
    res.writeHead(200, { "Content-Type": entry.type, "Content-Length": content.length, "Cache-Control": "no-cache" });
    res.end(content);
  });
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) { const error = new Error("Request body is too large"); error.statusCode = 413; throw error; }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { const error = new Error("Invalid JSON body"); error.statusCode = 400; throw error; }
}

async function fetchJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { "User-Agent": `SkyForge/${PHASE7_VERSION}` }, signal: controller.signal });
    if (!response.ok) throw new Error(`Remote service returned HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timeout); }
}

function validateCoordinates(url) {
  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    const error = new Error("Valid lat and lon parameters are required"); error.statusCode = 400; throw error;
  }
  return { latitude, longitude };
}

async function getLiveWeather(url) {
  const { latitude, longitude } = validateCoordinates(url);
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { ...cached.value, cached: true };

  const endpoint = new URL("https://api.open-meteo.com/v1/forecast");
  endpoint.searchParams.set("latitude", String(latitude));
  endpoint.searchParams.set("longitude", String(longitude));
  endpoint.searchParams.set("timezone", "auto");
  endpoint.searchParams.set("forecast_days", "1");
  endpoint.searchParams.set("current", [
    "temperature_2m", "relative_humidity_2m", "apparent_temperature", "is_day",
    "precipitation", "rain", "showers", "snowfall", "weather_code",
    "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
    "surface_pressure", "visibility", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"
  ].join(","));
  endpoint.searchParams.set("daily", ["sunrise", "sunset", "weather_code", "precipitation_sum", "snowfall_sum"].join(","));

  const payload = await fetchJson(endpoint);
  const weather = normalizeOpenMeteoPayload(payload);
  const renderState = weatherToRenderState(weather);
  const moon = computeMoonState(weather.localTime, weather.latitude, weather.longitude);
  const value = { ...weather, renderState, moon, apiVersion: PHASE7_VERSION };
  weatherCache.set(key, { at: Date.now(), value });
  return value;
}

async function searchCities(url) {
  const name = String(url.searchParams.get("name") || "").trim();
  const count = Math.min(50, Math.max(1, Number(url.searchParams.get("count") || 20)));
  if (name.length < 2) { const error = new Error("City search requires at least two characters"); error.statusCode = 400; throw error; }
  const endpoint = new URL("https://geocoding-api.open-meteo.com/v1/search");
  endpoint.searchParams.set("name", name);
  endpoint.searchParams.set("count", String(count));
  endpoint.searchParams.set("language", "en");
  endpoint.searchParams.set("format", "json");
  const payload = await fetchJson(endpoint);
  return {
    query: name,
    results: (payload.results || []).map((item) => ({
      id: item.id, name: item.name, country: item.country, admin1: item.admin1,
      countryCode: item.country_code, latitude: item.latitude, longitude: item.longitude,
      elevation: item.elevation, timezone: item.timezone
    }))
  };
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

function shouldInject(req, upstreamResponse) {
  const contentType = String(upstreamResponse.headers["content-type"] || "").toLowerCase();
  const encoding = String(upstreamResponse.headers["content-encoding"] || "").toLowerCase();
  return req.method === "GET" && upstreamResponse.statusCode === 200 && contentType.includes("text/html") && !encoding;
}

function proxyRequest(req, res) {
  const headers = { ...req.headers, host: `${HOST}:${INNER_PORT}` };
  const upstream = http.request({ hostname: HOST, port: INNER_PORT, path: req.url, method: req.method, headers, insecureHTTPParser: true }, (upstreamResponse) => {
    if (!shouldInject(req, upstreamResponse)) {
      res.writeHead(upstreamResponse.statusCode || 502, normalizeProxyHeaders(upstreamResponse.headers));
      upstreamResponse.pipe(res);
      return;
    }
    const chunks = [];
    upstreamResponse.on("data", (chunk) => chunks.push(chunk));
    upstreamResponse.on("end", () => {
      const html = injectPhase7Clients(Buffer.concat(chunks).toString("utf8"));
      const body = Buffer.from(html, "utf8");
      res.writeHead(upstreamResponse.statusCode || 200, normalizeProxyHeaders(upstreamResponse.headers, body.length));
      res.end(body);
    });
  });
  upstream.on("error", (error) => {
    if (!res.headersSent) sendJson(res, 502, { error: "SkyForge Phase 6 gateway is unavailable", detail: error.message });
    else res.destroy(error);
  });
  req.pipe(upstream);
}

function spawnPhase6Gateway() {
  childProcess = spawn(process.execPath, [path.join(__dirname, "server-skyforge-phase6.js")], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(INNER_PORT),
      SKYFORGE_PHASE6_INNER_PORT: String(NATURAL_LIGHT_PORT),
      SKYFORGE_INTERNAL_PORT: String(CORE_PORT)
    },
    stdio: "inherit",
    windowsHide: true
  });
  childProcess.on("exit", (code, signal) => {
    if (!shuttingDown) { console.error(`SkyForge Phase 6 exited unexpectedly (code=${code}, signal=${signal || "none"})`); process.exitCode = code || 1; }
  });
}

function childHealthCheck() {
  return new Promise((resolve) => {
    const request = http.get({ hostname: HOST, port: INNER_PORT, path: "/api/phase6/health", timeout: 900 }, (response) => { response.resume(); resolve(response.statusCode === 200); });
    request.on("timeout", () => { request.destroy(); resolve(false); }); request.on("error", () => resolve(false));
  });
}

async function waitForChild(attempts = 100, delayMs = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) { if (await childHealthCheck()) return true; await new Promise((resolve) => setTimeout(resolve, delayMs)); }
  return false;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (requestUrl.pathname.startsWith("/api/phase7") && req.method === "OPTIONS") return sendJson(res, 204, {});
  const staticEntry = STATIC_FILES[requestUrl.pathname];
  if (req.method === "GET" && staticEntry) return serveStatic(res, staticEntry);
  if (req.method === "GET" && requestUrl.pathname === "/api/phase7/health") return sendJson(res, 200, {
    ok: true,
    service: "skyforge-functional-scene-engine",
    version: PHASE7_VERSION,
    renderer: "WebGL2 full-scene procedural GPU",
    galaxyDefault: "disabled until user creation",
    weather: "Open-Meteo current conditions with local timezone",
    composites: ["physical sun", "moon", "stars", "layered clouds", "rain", "snow", "fog", "aurora", "galaxy", "interactive color grade"],
    endpoints: ["GET /api/phase7/weather", "GET /api/phase7/geo/search", "GET /api/phase7/health"]
  });
  if (req.method === "GET" && requestUrl.pathname === "/api/phase7/weather") {
    try { return sendJson(res, 200, await getLiveWeather(requestUrl)); }
    catch (error) { return sendJson(res, error.statusCode || 502, { error: error.message || "Live weather request failed" }); }
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/phase7/geo/search") {
    try { return sendJson(res, 200, await searchCities(requestUrl)); }
    catch (error) { return sendJson(res, error.statusCode || 502, { error: error.message || "City search failed" }); }
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/phase7/scene/normalize") {
    try { const body = await readJsonBody(req); return sendJson(res, 200, { apiVersion: PHASE7_VERSION, weather: weatherToRenderState(body.weather || {}), moon: computeMoonState(body.dateTime || new Date(), body.latitude, body.longitude) }); }
    catch (error) { return sendJson(res, error.statusCode || 400, { error: error.message || "Scene normalization failed" }); }
  }
  proxyRequest(req, res);
});

function shutdown(signal) {
  if (shuttingDown) return; shuttingDown = true; console.log(`Received ${signal}; stopping SkyForge Phase 7 services...`);
  server.close(() => { if (childProcess && !childProcess.killed) childProcess.kill(); process.exit(0); });
  setTimeout(() => { if (childProcess && !childProcess.killed) childProcess.kill("SIGKILL"); process.exit(1); }, 3500).unref();
}
process.on("SIGINT", () => shutdown("SIGINT")); process.on("SIGTERM", () => shutdown("SIGTERM"));

async function start() {
  spawnPhase6Gateway();
  if (!(await waitForChild())) throw new Error(`SkyForge Phase 6 did not become ready on port ${INNER_PORT}`);
  server.listen(PUBLIC_PORT, HOST, () => {
    console.log(`SkyForge Phase 7 Functional Scene Engine: http://${HOST}:${PUBLIC_PORT}`);
    console.log(`Phase 7 health: GET http://${HOST}:${PUBLIC_PORT}/api/phase7/health`);
    console.log(`Live weather: GET http://${HOST}:${PUBLIC_PORT}/api/phase7/weather?lat=45.764&lon=4.8357`);
  });
}
if (require.main === module) start().catch((error) => { console.error(error); if (childProcess && !childProcess.killed) childProcess.kill(); process.exit(1); });

module.exports = { start, getLiveWeather, searchCities };
