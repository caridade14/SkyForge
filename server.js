const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const { randomUUID } = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const PROJECTS_DIR = path.join(DATA_DIR, "projects");
const OUTPUTS_DIR = path.join(DATA_DIR, "outputs");
const LEGACY_RENDERS_FILE = path.join(DATA_DIR, "renders.json");
const DB_FILE = path.join(DATA_DIR, "skyforge.db");
const INDEX_FILE = path.join(ROOT, "SF30.html");
const WORKER_TICK_MS = Number(process.env.RENDER_WORKER_TICK_MS || 1000);

function safeLog(method, ...args) {
  try {
    console[method](...args);
  } catch {
    // Hidden/background launches can have closed stdio handles.
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".exr": "application/octet-stream",
  ".ico": "image/x-icon"
};

const DEFAULT_SCENE = {
  city: "",
  date: "2026-05-29",
  time: "",
  latitude: "",
  longitude: "",
  weather: "No weather loaded",
  sun: {
    elevation: "",
    azimuth: "",
    intensity: "",
    turbidity: ""
  },
  clouds: {
    type: "",
    coverage: "",
    altitude: "",
    density: ""
  },
  output: {
    format: "EXR 32-bit",
    resolution: "4K"
  },
  groups: [
    { key: "grp-world-environment", name: "World Environment", type: "ROOT", collapsed: false },
    { key: "grp-atmosphere", name: "Atmosphere", type: "VOL", collapsed: false },
    { key: "grp-cloud-system", name: "Cloud System", type: "CLOUDS", collapsed: false },
    { key: "grp-cameras-probes", name: "Cameras / Probes", type: "CAM", collapsed: false }
  ],
  objects: [],
  nodeGraph: {
    nodes: [{ id: "node-output", type: "HDRI", name: "HDRI Output", x: 260, y: 120, props: { format: "EXR 32-bit" } }],
    links: [],
    view: { x: 0, y: 0, zoom: 1 }
  }
};

const DEFAULT_PROJECT = {
  id: "default",
  name: "SkyForge Demo Scene",
  ownerId: "system",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  scene: DEFAULT_SCENE
};

const DEFAULT_ASSETS = [
  { id: "asset-hdri-golden-hour", type: "hdri", name: "Golden Hour HDRI", tags: ["sunset", "warm", "4k"] },
  { id: "asset-cloud-cumulus", type: "cloud", name: "Cumulus Layer", tags: ["soft", "volume"] },
  { id: "asset-lut-kodak-2383", type: "lut", name: "Kodak 2383 Look", tags: ["filmic", "warm"] },
  { id: "asset-volume-haze", type: "volume", name: "Soft Haze Volume", tags: ["atmosphere", "mist"] }
];

const RENDER_STATUS = new Set(["queued", "rendering", "done", "failed", "cancelled"]);
let db;
let workerBusy = false;

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  await fs.mkdir(OUTPUTS_DIR, { recursive: true });

  const dbExists = await exists(DB_FILE);
  openDatabase();
  createSchema();
  migrateSchema();
  seedSystemUser();
  seedDefaultAssets();
  seedDefaultSettings();

  if (!dbExists || countRows("projects") === 0) {
    await migrateLegacyProjects();
  }

  if (!dbExists || countRows("renders") === 0) {
    await migrateLegacyRenders();
  }

  if (!getProject("default")) {
    saveProjectRecord(DEFAULT_PROJECT, true);
  }

  await backfillRenderArtifacts();
}

function openDatabase() {
  db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'artist',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT,
      scene_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS project_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      note TEXT,
      scene_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_versions_number
      ON project_versions(project_id, version_number);

    CREATE TABLE IF NOT EXISTS renders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      filename TEXT NOT NULL,
      dimensions TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      output_path TEXT,
      manifest_path TEXT,
      preview_path TEXT,
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      worker_heartbeat_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_renders_project_created
      ON renders(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS render_logs (
      id TEXT PRIMARY KEY,
      render_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (render_id) REFERENCES renders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_render_logs_render_created
      ON render_logs(render_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_assets_type_name
      ON assets(type, name);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function migrateSchema() {
  ensureColumn("renders", "output_path", "TEXT");
  ensureColumn("renders", "manifest_path", "TEXT");
  ensureColumn("renders", "preview_path", "TEXT");
  ensureColumn("renders", "started_at", "TEXT");
  ensureColumn("renders", "completed_at", "TEXT");
  ensureColumn("renders", "error", "TEXT");
  ensureColumn("renders", "worker_heartbeat_at", "TEXT");
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function seedSystemUser() {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("system", "Local Artist", "local@skyforge.test", "admin", now, now);
}

function seedDefaultAssets() {
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO assets (id, type, name, tags_json, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const asset of DEFAULT_ASSETS) {
    insert.run(
      asset.id,
      asset.type,
      asset.name,
      stringify(asset.tags),
      stringify(asset.metadata || {}),
      now,
      now
    );
  }
}

function seedDefaultSettings() {
  const defaults = {
    defaultResolution: "4096x2048 (4K)",
    colorSpace: "ACES",
    renderDevice: "CPU Worker",
    autosaveInterval: "5 minutes",
    blenderPath: "C:/Program Files/Blender Foundation/Blender/blender.exe",
    outputDirectory: "data/outputs"
  };
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
  `);

  for (const [key, value] of Object.entries(defaults)) {
    insert.run(key, stringify(value), now);
  }
}

async function migrateLegacyProjects() {
  const files = await fs.readdir(PROJECTS_DIR).catch(() => []);
  const jsonFiles = files.filter((name) => name.endsWith(".json"));

  if (!jsonFiles.length) {
    saveProjectRecord(DEFAULT_PROJECT, true);
    return;
  }

  for (const file of jsonFiles) {
    const legacy = await readJson(path.join(PROJECTS_DIR, file)).catch(() => null);
    if (!legacy) continue;

    saveProjectRecord({
      id: safeId(legacy.id || path.basename(file, ".json")),
      name: legacy.name || "Untitled SkyForge Scene",
      ownerId: legacy.ownerId || "system",
      createdAt: legacy.createdAt || new Date().toISOString(),
      updatedAt: legacy.updatedAt || new Date().toISOString(),
      scene: legacy.scene || DEFAULT_SCENE
    }, true);
  }
}

async function migrateLegacyRenders() {
  const renders = await readJson(LEGACY_RENDERS_FILE).catch(() => []);
  if (!Array.isArray(renders)) return;

  for (const render of renders) {
    saveRenderRecord({
      id: render.id || randomUUID(),
      projectId: safeId(render.projectId || "default"),
      status: RENDER_STATUS.has(render.status) ? render.status : "queued",
      progress: clampProgress(render.progress),
      filename: render.filename,
      dimensions: render.dimensions,
      settings: render.settings || {},
      createdAt: render.createdAt || new Date().toISOString(),
      updatedAt: render.updatedAt || render.createdAt || new Date().toISOString()
    });
  }
}

async function backfillRenderArtifacts() {
  const rows = db.prepare(`
    SELECT * FROM renders
    WHERE status = 'done'
      AND (output_path IS NULL OR manifest_path IS NULL OR preview_path IS NULL OR preview_path NOT LIKE '%.png')
  `).all();

  for (const row of rows) {
    await completeRenderJob(renderFromRow(row));
  }
}

function countRows(table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function exists(file) {
  return fs.access(file).then(() => true).catch(() => false);
}

function safeId(id) {
  return String(id || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64) || "default";
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function stringify(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function weatherCodeLabel(code) {
  const n = Number(code);
  const labels = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Severe thunderstorm with hail"
  };
  return labels[n] || `Weather code ${Number.isFinite(n) ? n : "unknown"}`;
}

function average(values) {
  const clean = (values || []).map(Number).filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function sum(values) {
  return (values || []).map(Number).filter(Number.isFinite).reduce((total, value) => total + value, 0);
}

function round(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

async function fetchJson(url) {
  if (typeof fetch !== "function") {
    const error = new Error("This Node runtime does not provide fetch");
    error.statusCode = 500;
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "SkyForge/1.0 weather bridge" }
    });
    const body = await response.text();
    let data = {};
    try {
      data = body ? JSON.parse(body) : {};
    } catch {
      data = { raw: body };
    }
    if (!response.ok || data.error) {
      const error = new Error(data.reason || data.error || `Weather provider returned ${response.status}`);
      error.statusCode = response.ok ? 502 : response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dateDiffDays(date) {
  const selected = new Date(`${date}T00:00:00Z`);
  const today = new Date(`${todayIso()}T00:00:00Z`);
  if (Number.isNaN(selected.getTime())) return 0;
  return Math.round((selected.getTime() - today.getTime()) / 86400000);
}

function summarizeWeatherPayload(data, requestedDate, source) {
  const hourly = data.hourly || {};
  const daily = data.daily || {};
  const dailyIndex = Array.isArray(daily.time) ? daily.time.indexOf(requestedDate) : -1;
  const indexes = Array.isArray(hourly.time)
    ? hourly.time.reduce((out, time, index) => {
        if (String(time).startsWith(`${requestedDate}T`)) out.push(index);
        return out;
      }, [])
    : [];
  const noonIndex = indexes.find((index) => String(hourly.time[index]).includes("T12:00")) ?? indexes[Math.floor(indexes.length / 2)] ?? 0;
  const pickHourly = (name) => Array.isArray(hourly[name]) ? hourly[name][noonIndex] : null;
  const pickDaily = (name) => dailyIndex >= 0 && Array.isArray(daily[name]) ? daily[name][dailyIndex] : null;
  const sliceHourly = (name) => Array.isArray(hourly[name]) ? indexes.map((index) => hourly[name][index]) : [];

  const weatherCode = pickDaily("weather_code") ?? pickHourly("weather_code") ?? 0;
  const temperature = pickHourly("temperature_2m") ?? average(sliceHourly("temperature_2m"));
  const humidity = pickHourly("relative_humidity_2m") ?? average(sliceHourly("relative_humidity_2m"));
  const cloudCover = average(sliceHourly("cloud_cover")) ?? pickHourly("cloud_cover") ?? 0;
  const precipitation = pickDaily("precipitation_sum") ?? sum(sliceHourly("precipitation")) ?? sum(sliceHourly("rain"));
  const windSpeed = pickDaily("wind_speed_10m_max") ?? pickHourly("wind_speed_10m") ?? average(sliceHourly("wind_speed_10m")) ?? 0;
  const windDirection = pickDaily("wind_direction_10m_dominant") ?? pickHourly("wind_direction_10m") ?? 270;

  return {
    date: requestedDate,
    source,
    timezone: data.timezone || "auto",
    weatherCode: Number(weatherCode) || 0,
    weather: weatherCodeLabel(weatherCode),
    temperature: round(temperature, 1),
    humidity: round(humidity, 0),
    cloudCover: round(cloudCover, 0),
    precipitation: round(precipitation, 1),
    windSpeed: round(windSpeed, 1),
    windDirection: round(windDirection, 0),
    latitude: data.latitude,
    longitude: data.longitude
  };
}

async function searchGeo(url) {
  const query = url.searchParams.get("name") || "";
  const count = Math.min(50, Math.max(1, Number(url.searchParams.get("count") || 20)));
  if (!query.trim()) {
    const error = new Error("Missing city search query");
    error.statusCode = 400;
    throw error;
  }
  const endpoint = new URL("https://geocoding-api.open-meteo.com/v1/search");
  endpoint.searchParams.set("name", query.trim());
  endpoint.searchParams.set("count", String(count));
  endpoint.searchParams.set("language", "en");
  endpoint.searchParams.set("format", "json");
  const data = await fetchJson(endpoint);
  return {
    query,
    results: (data.results || []).map((item) => ({
      id: item.id,
      name: item.name,
      country: item.country,
      admin1: item.admin1,
      countryCode: item.country_code,
      latitude: item.latitude,
      longitude: item.longitude,
      timezone: item.timezone
    }))
  };
}

async function getWeather(url) {
  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lon"));
  const date = url.searchParams.get("date") || todayIso();
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const error = new Error("Valid lat and lon are required");
    error.statusCode = 400;
    throw error;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error("Date must be YYYY-MM-DD");
    error.statusCode = 400;
    throw error;
  }

  const diff = dateDiffDays(date);
  const useArchive = diff < -7;
  const useRecentPast = !useArchive && diff < 0;
  const endpoint = new URL(useArchive ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast");
  endpoint.searchParams.set("latitude", String(latitude));
  endpoint.searchParams.set("longitude", String(longitude));
  if (useRecentPast) {
    endpoint.searchParams.set("past_days", String(Math.min(7, Math.abs(diff))));
  } else {
    endpoint.searchParams.set("start_date", date);
    endpoint.searchParams.set("end_date", date);
  }
  endpoint.searchParams.set("timezone", "auto");
  endpoint.searchParams.set("hourly", [
    "temperature_2m",
    "relative_humidity_2m",
    "cloud_cover",
    "precipitation",
    "rain",
    "weather_code",
    "wind_speed_10m",
    "wind_direction_10m"
  ].join(","));
  endpoint.searchParams.set("daily", [
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "wind_speed_10m_max",
    "wind_direction_10m_dominant"
  ].join(","));
  if (!useArchive && diff > 16) {
    const error = new Error("Forecast data is available up to 16 days ahead");
    error.statusCode = 400;
    throw error;
  }
  const data = await fetchJson(endpoint);
  return summarizeWeatherPayload(data, date, useArchive ? "historical-archive" : "forecast");
}

function sendBuffer(res, status, contentType, buffer) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": buffer.length,
    "Access-Control-Allow-Origin": "*"
  });
  res.end(buffer);
}

function projectFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scene: parseJson(row.scene_json, {})
  };
}

function projectSummaryFromRow(row) {
  const scene = parseJson(row.scene_json, {});
  const versions = db.prepare("SELECT COUNT(*) AS count FROM project_versions WHERE project_id = ?").get(row.id).count;
  const renders = db.prepare("SELECT COUNT(*) AS count FROM renders WHERE project_id = ?").get(row.id).count;
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    updatedAt: row.updated_at,
    city: scene.city,
    versions,
    renders
  };
}

function renderFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    progress: row.progress,
    filename: row.filename,
    dimensions: row.dimensions,
    settings: parseJson(row.settings_json, {}),
    outputPath: row.output_path,
    manifestPath: row.manifest_path,
    previewPath: row.preview_path,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
    workerHeartbeatAt: row.worker_heartbeat_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function userFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function assetFromRow(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    tags: parseJson(row.tags_json, []),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function versionFromRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    versionNumber: row.version_number,
    note: row.note,
    scene: parseJson(row.scene_json, {}),
    createdAt: row.created_at
  };
}

function listProjects() {
  return db.prepare(`
    SELECT * FROM projects
    ORDER BY updated_at DESC
  `).all().map(projectSummaryFromRow);
}

function getProject(id) {
  return projectFromRow(db.prepare("SELECT * FROM projects WHERE id = ?").get(safeId(id)));
}

function createProject(body) {
  const now = new Date().toISOString();
  const id = safeId(body.id || body.name || `project-${Date.now()}`);

  if (getProject(id)) {
    const error = new Error("Project already exists");
    error.statusCode = 409;
    throw error;
  }

  const project = {
    id,
    name: body.name || "Untitled SkyForge Scene",
    ownerId: safeId(body.ownerId || "system"),
    createdAt: now,
    updatedAt: now,
    scene: body.scene || DEFAULT_SCENE
  };

  saveProjectRecord(project, true);
  return getProject(id);
}

function saveProject(id, body) {
  const safeProjectId = safeId(id);
  const existing = getProject(safeProjectId);
  const now = new Date().toISOString();
  const project = {
    id: safeProjectId,
    name: body.name || existing?.name || "Untitled SkyForge Scene",
    ownerId: safeId(body.ownerId || existing?.ownerId || "system"),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    scene: body.scene || existing?.scene || {}
  };

  saveProjectRecord(project, !body.skipVersion, body.versionNote || "Saved from UI");
  return getProject(safeProjectId);
}

function duplicateProject(id, body = {}) {
  const source = getProject(id);
  if (!source) {
    const error = new Error("Project not found");
    error.statusCode = 404;
    throw error;
  }

  const now = new Date().toISOString();
  const newId = uniqueProjectId(body.id || `${source.id}-copy`);
  const project = {
    id: newId,
    name: body.name || `${source.name} Copy`,
    ownerId: body.ownerId || source.ownerId || "system",
    createdAt: now,
    updatedAt: now,
    scene: body.scene || source.scene
  };

  saveProjectRecord(project, true, `Duplicated from ${source.id}`);
  return getProject(newId);
}

function deleteProject(id) {
  const safeProjectId = safeId(id);
  if (safeProjectId === "default") {
    const error = new Error("The default project cannot be deleted");
    error.statusCode = 400;
    throw error;
  }

  const project = getProject(safeProjectId);
  if (!project) {
    const error = new Error("Project not found");
    error.statusCode = 404;
    throw error;
  }

  db.prepare("DELETE FROM projects WHERE id = ?").run(safeProjectId);
  return { ok: true, deleted: safeProjectId };
}

function exportProject(id) {
  const project = getProject(id);
  if (!project) {
    const error = new Error("Project not found");
    error.statusCode = 404;
    throw error;
  }

  return {
    exportedAt: new Date().toISOString(),
    project,
    versions: listProjectVersions(project.id),
    renders: listRenders({ projectId: project.id })
  };
}

function importProjectBundle(body) {
  const bundle = body.project ? body : { project: body };
  const source = bundle.project || {};
  const now = new Date().toISOString();
  const id = uniqueProjectId(body.id || source.id || source.name || "imported-project");
  const project = {
    id,
    name: body.name || source.name || "Imported SkyForge Project",
    ownerId: body.ownerId || source.ownerId || "system",
    createdAt: now,
    updatedAt: now,
    scene: source.scene || DEFAULT_SCENE
  };

  saveProjectRecord(project, true, "Imported bundle");

  if (Array.isArray(bundle.versions)) {
    for (const version of bundle.versions.slice().reverse()) {
      createProjectVersion(id, {
        scene: version.scene || project.scene,
        note: `Imported: ${version.note || `v${version.versionNumber || ""}`}`.trim()
      });
    }
  }

  return getProject(id);
}

function getSettings() {
  const rows = db.prepare("SELECT * FROM app_settings ORDER BY key").all();
  return rows.reduce((settings, row) => {
    settings[row.key] = parseJson(row.value_json, null);
    return settings;
  }, {});
}

function saveSettings(body) {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `);

  for (const [key, value] of Object.entries(body || {})) {
    if (/^[a-zA-Z0-9_.-]+$/.test(key)) upsert.run(key, stringify(value), now);
  }

  return getSettings();
}

function uniqueProjectId(baseId) {
  const base = safeId(baseId || "project");
  if (!getProject(base)) return base;

  for (let index = 2; index < 1000; index++) {
    const candidate = `${base}-${index}`;
    if (!getProject(candidate)) return candidate;
  }

  return `${base}-${Date.now()}`;
}

function saveProjectRecord(project, createVersion = false, versionNote = "Imported scene") {
  db.prepare(`
    INSERT INTO projects (id, name, owner_id, scene_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      owner_id = excluded.owner_id,
      scene_json = excluded.scene_json,
      updated_at = excluded.updated_at
  `).run(
    safeId(project.id),
    project.name,
    safeId(project.ownerId || "system"),
    stringify(project.scene || {}),
    project.createdAt || new Date().toISOString(),
    project.updatedAt || new Date().toISOString()
  );

  if (createVersion) {
    createProjectVersion(project.id, {
      scene: project.scene || {},
      note: versionNote
    });
  }
}

function listProjectVersions(projectId) {
  return db.prepare(`
    SELECT * FROM project_versions
    WHERE project_id = ?
    ORDER BY version_number DESC
  `).all(safeId(projectId)).map(versionFromRow);
}

function getProjectVersion(projectId, versionNumber) {
  return versionFromRow(db.prepare(`
    SELECT * FROM project_versions
    WHERE project_id = ? AND version_number = ?
  `).get(safeId(projectId), Number(versionNumber)));
}

function createProjectVersion(projectId, body = {}) {
  const project = getProject(projectId);
  if (!project) {
    const error = new Error("Project not found");
    error.statusCode = 404;
    throw error;
  }

  const row = db.prepare(`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS nextVersion
    FROM project_versions
    WHERE project_id = ?
  `).get(project.id);

  const version = {
    id: randomUUID(),
    projectId: project.id,
    versionNumber: row.nextVersion,
    note: body.note || "Manual checkpoint",
    scene: body.scene || project.scene,
    createdAt: new Date().toISOString()
  };

  db.prepare(`
    INSERT INTO project_versions (id, project_id, version_number, note, scene_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(version.id, version.projectId, version.versionNumber, version.note, stringify(version.scene), version.createdAt);

  return version;
}

function restoreProjectVersion(projectId, versionNumber) {
  const version = getProjectVersion(projectId, versionNumber);
  if (!version) {
    const error = new Error("Project version not found");
    error.statusCode = 404;
    throw error;
  }

  const project = getProject(projectId);
  if (!project) {
    const error = new Error("Project not found");
    error.statusCode = 404;
    throw error;
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE projects
    SET scene_json = ?, updated_at = ?
    WHERE id = ?
  `).run(stringify(version.scene), now, project.id);

  createProjectVersion(project.id, {
    scene: version.scene,
    note: `Restored from v${String(version.versionNumber).padStart(3, "0")}`
  });

  return getProject(project.id);
}

function listRenders(filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.projectId) {
    clauses.push("project_id = ?");
    params.push(safeId(filters.projectId));
  }

  if (filters.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT * FROM renders
    ${where}
    ORDER BY created_at DESC
  `).all(...params).map(renderFromRow);
}

function getRender(id) {
  return renderFromRow(db.prepare("SELECT * FROM renders WHERE id = ?").get(id));
}

function listRenderLogs(renderId) {
  return db.prepare(`
    SELECT * FROM render_logs
    WHERE render_id = ?
    ORDER BY created_at ASC
  `).all(renderId).map((row) => ({
    id: row.id,
    renderId: row.render_id,
    level: row.level,
    message: row.message,
    data: parseJson(row.data_json, {}),
    createdAt: row.created_at
  }));
}

function logRender(renderId, level, message, data = {}) {
  if (!renderId) return;
  db.prepare(`
    INSERT INTO render_logs (id, render_id, level, message, data_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), renderId, level, message, stringify(data), new Date().toISOString());
}

function createRender(body) {
  const projectId = safeId(body.projectId || "default");
  if (!getProject(projectId)) saveProjectRecord(DEFAULT_PROJECT, true);

  const now = new Date().toISOString();
  const job = {
    id: randomUUID(),
    projectId,
    status: "queued",
    progress: 0,
    settings: body.settings || {},
    createdAt: now,
    updatedAt: now
  };
  job.filename = renderFilename(job);
  job.dimensions = renderDimensions(job.settings.resolution);

  saveRenderRecord(job);
  logRender(job.id, "info", "Render queued", {
    projectId: job.projectId,
    filename: job.filename,
    dimensions: job.dimensions
  });
  return getRender(job.id);
}

function saveRenderRecord(job) {
  const filename = job.filename || renderFilename(job);
  const dimensions = job.dimensions || renderDimensions(job.settings?.resolution);

  db.prepare(`
    INSERT INTO renders (
      id, project_id, status, progress, filename, dimensions, settings_json,
      output_path, manifest_path, preview_path, started_at, completed_at, error, worker_heartbeat_at,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      progress = excluded.progress,
      filename = excluded.filename,
      dimensions = excluded.dimensions,
      settings_json = excluded.settings_json,
      output_path = excluded.output_path,
      manifest_path = excluded.manifest_path,
      preview_path = excluded.preview_path,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      error = excluded.error,
      worker_heartbeat_at = excluded.worker_heartbeat_at,
      updated_at = excluded.updated_at
  `).run(
    job.id,
    safeId(job.projectId || "default"),
    RENDER_STATUS.has(job.status) ? job.status : "queued",
    clampProgress(job.progress),
    filename,
    dimensions,
    stringify(job.settings || {}),
    job.outputPath || null,
    job.manifestPath || null,
    job.previewPath || null,
    job.startedAt || null,
    job.completedAt || null,
    job.error || null,
    job.workerHeartbeatAt || null,
    job.createdAt || new Date().toISOString(),
    job.updatedAt || new Date().toISOString()
  );
}

function updateRender(id, body) {
  const job = getRender(id);
  if (!job) {
    const error = new Error("Render job not found");
    error.statusCode = 404;
    throw error;
  }

  if (body.status !== undefined && !RENDER_STATUS.has(body.status)) {
    const error = new Error("Invalid render status");
    error.statusCode = 400;
    throw error;
  }

  const updated = {
    ...job,
    status: body.status ?? job.status,
    progress: body.progress === undefined ? job.progress : clampProgress(body.progress),
    updatedAt: new Date().toISOString()
  };
  saveRenderRecord(updated);
  return getRender(id);
}

function cancelRender(id) {
  const job = getRender(id);
  if (!job) {
    const error = new Error("Render job not found");
    error.statusCode = 404;
    throw error;
  }

  const cancelled = updateRender(id, {
    status: "cancelled",
    progress: Math.min(job.progress || 0, 99)
  });
  logRender(id, "warn", "Render cancelled", { progress: cancelled.progress });
  return cancelled;
}

function getWorkerStatus() {
  const counts = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM renders
    GROUP BY status
  `).all().reduce((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});

  return {
    enabled: true,
    tickMs: WORKER_TICK_MS,
    busy: workerBusy,
    queued: counts.queued || 0,
    rendering: counts.rendering || 0,
    done: counts.done || 0,
    failed: counts.failed || 0,
    cancelled: counts.cancelled || 0
  };
}

function getStats() {
  const renderCounts = getWorkerStatus();
  return {
    projects: countRows("projects"),
    versions: countRows("project_versions"),
    renders: {
      total: countRows("renders"),
      queued: renderCounts.queued,
      rendering: renderCounts.rendering,
      done: renderCounts.done,
      failed: renderCounts.failed,
      cancelled: renderCounts.cancelled
    },
    assets: countRows("assets"),
    users: countRows("users"),
    worker: renderCounts
  };
}

function getRenderArtifacts(renderId) {
  const job = getRender(renderId);
  if (!job) {
    const error = new Error("Render job not found");
    error.statusCode = 404;
    throw error;
  }

  return {
    render: job,
    artifacts: {
      output: job.outputPath,
      preview: job.previewPath,
      manifest: job.manifestPath,
      logs: `/api/renders/${job.id}/logs`
    }
  };
}

function retryRender(id) {
  const source = getRender(id);
  if (!source) {
    const error = new Error("Render job not found");
    error.statusCode = 404;
    throw error;
  }

  const job = createRender({
    projectId: source.projectId,
    settings: source.settings
  });
  logRender(job.id, "info", "Render retried", { sourceRenderId: source.id });
  return job;
}

function deleteRender(id) {
  const job = getRender(id);
  if (!job) {
    const error = new Error("Render job not found");
    error.statusCode = 404;
    throw error;
  }

  db.prepare("DELETE FROM renders WHERE id = ?").run(id);
  return { ok: true, deleted: id };
}

function getNextWorkerJob() {
  return renderFromRow(db.prepare(`
    SELECT * FROM renders
    WHERE status = 'rendering'
    ORDER BY updated_at ASC
    LIMIT 1
  `).get()) || renderFromRow(db.prepare(`
    SELECT * FROM renders
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 1
  `).get());
}

function renderStepFor(job) {
  const resolution = job.settings?.resolution || "4K";
  const steps = {
    "2K": 18,
    "4K": 12,
    "8K": 7,
    "16K": 4
  };
  return steps[resolution] || steps["4K"];
}

async function processRenderQueue() {
  if (workerBusy) return;
  workerBusy = true;

  try {
    let job = getNextWorkerJob();
    if (!job) return;

    const now = new Date().toISOString();
    if (job.status === "queued") {
      job = {
        ...job,
        status: "rendering",
        progress: Math.max(1, job.progress || 0),
        startedAt: job.startedAt || now,
        workerHeartbeatAt: now,
        updatedAt: now
      };
      saveRenderRecord(job);
      logRender(job.id, "info", "Render started", {
        resolution: job.settings?.resolution || "4K",
        format: job.settings?.format || "EXR 32-bit"
      });
      return;
    }

    const nextProgress = Math.min(100, (job.progress || 0) + renderStepFor(job));
    if (nextProgress >= 100) {
      await completeRenderJob(job);
      return;
    }

    saveRenderRecord({
      ...job,
      progress: nextProgress,
      workerHeartbeatAt: now,
      updatedAt: now
    });
    if (nextProgress % 24 === 0 || nextProgress >= 90) {
      logRender(job.id, "debug", "Render progress updated", { progress: nextProgress });
    }
  } catch (error) {
    safeLog("error", "Render worker failed:", error);
  } finally {
    workerBusy = false;
  }
}

async function completeRenderJob(job) {
  const now = new Date().toISOString();
  const project = getProject(job.projectId);
  const outputPath = path.join(OUTPUTS_DIR, job.filename);
  const manifestPath = path.join(OUTPUTS_DIR, `${path.parse(job.filename).name}.render.json`);
  const previewPath = path.join(OUTPUTS_DIR, `${path.parse(job.filename).name}.preview.png`);

  const manifest = {
    id: job.id,
    projectId: job.projectId,
    projectName: project?.name || "Unknown Project",
    filename: job.filename,
    dimensions: job.dimensions,
    settings: job.settings,
    scene: project?.scene || {},
    status: "done",
    completedAt: now,
    note: "Prototype render artifact. Replace this worker with a true HDRI/EXR renderer when the image pipeline is ready."
  };

  const previewBuffer = renderPreviewPng(job, manifest);
  if (path.extname(outputPath).toLowerCase() === ".png") {
    await fs.writeFile(outputPath, previewBuffer);
  } else {
    await fs.writeFile(outputPath, renderPlaceholder(job, manifest), "utf8");
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(previewPath, previewBuffer);

  if (!getRender(job.id)) return;

  saveRenderRecord({
    ...job,
    status: "done",
    progress: 100,
    outputPath: toPublicPath(outputPath),
    manifestPath: toPublicPath(manifestPath),
    previewPath: toPublicPath(previewPath),
    completedAt: now,
    workerHeartbeatAt: now,
    updatedAt: now
  });
  logRender(job.id, "info", "Render completed", {
    outputPath: toPublicPath(outputPath),
    manifestPath: toPublicPath(manifestPath),
    previewPath: toPublicPath(previewPath)
  });
}

function renderPlaceholder(job, manifest) {
  return [
    "SkyForge prototype render artifact",
    `Render ID: ${job.id}`,
    `Filename: ${job.filename}`,
    `Dimensions: ${job.dimensions}`,
    `Format request: ${job.settings?.format || "EXR 32-bit"}`,
    "",
    "This is not a real HDRI/EXR pixel payload yet.",
    "The render worker created this artifact so the backend pipeline can be tested end to end.",
    "",
    JSON.stringify(manifest, null, 2)
  ].join("\n");
}

function renderPreviewPng(job, manifest) {
  const scene = manifest.scene || {};
  const sun = scene.sun || {};
  const clouds = scene.clouds || {};
  const width = 1024;
  const height = 512;
  const coverage = Math.max(0, Math.min(100, Number(clouds.coverage) || 52)) / 100;
  const density = Math.max(0, Math.min(1, Number(clouds.density) || 0.7));
  const elevation = Math.max(-10, Math.min(90, Number(sun.elevation) || 7));
  const azimuth = ((Number(sun.azimuth) || 215) % 360 + 360) % 360;
  const sunX = width * (azimuth / 360);
  const sunY = height * (0.62 - elevation / 170);

  return createPng(width, height, (x, y) => {
    const u = x / (width - 1);
    const v = y / (height - 1);
    const horizon = Math.exp(-Math.pow((v - 0.56) / 0.18, 2));
    const upper = 1 - Math.min(1, v * 1.45);
    const lower = Math.max(0, (v - 0.55) / 0.45);

    let r = mix(9, 18, upper);
    let g = mix(14, 48, upper);
    let b = mix(28, 92, upper);

    r = mix(r, 214, horizon * 0.72);
    g = mix(g, 112, horizon * 0.55);
    b = mix(b, 32, horizon * 0.35);

    r = mix(r, 8, lower * 0.7);
    g = mix(g, 6, lower * 0.7);
    b = mix(b, 8, lower * 0.7);

    const dx = shortestWrappedDistance(x, sunX, width);
    const dy = y - sunY;
    const sunCore = Math.exp(-(dx * dx + dy * dy) / 1200);
    const sunGlow = Math.exp(-(dx * dx + dy * dy) / 35000);
    r = mix(r, 255, Math.min(1, sunGlow * 0.7 + sunCore));
    g = mix(g, 221, Math.min(1, sunGlow * 0.48 + sunCore));
    b = mix(b, 116, Math.min(1, sunGlow * 0.22 + sunCore * 0.55));

    const cloudBand = Math.exp(-Math.pow((v - 0.28) / 0.2, 2));
    const noise = layeredNoise(u * 6.5, v * 5.5);
    const cloudMask = smoothstep(0.52 + (1 - coverage) * 0.32, 0.96, noise) * cloudBand * (0.35 + density * 0.65);
    r = mix(r, 255, cloudMask * 0.58);
    g = mix(g, 235, cloudMask * 0.52);
    b = mix(b, 205, cloudMask * 0.42);

    const vignette = 1 - Math.min(0.38, Math.hypot(u - 0.5, v - 0.5) * 0.38);
    return [
      clampByte(r * vignette),
      clampByte(g * vignette),
      clampByte(b * vignette),
      255
    ];
  });
}

function previewPngFromScene(scene = {}, settings = {}) {
  const job = {
    id: "preview",
    filename: "SkyForge_preview.png",
    dimensions: renderDimensions(settings.resolution || scene.output?.resolution || "2K"),
    settings: {
      format: "PNG Preview",
      resolution: settings.resolution || scene.output?.resolution || "2K"
    }
  };
  return renderPreviewPng(job, { scene });
}

function analyzeScene(scene = {}) {
  const sun = scene.sun || {};
  const clouds = scene.clouds || {};
  const output = scene.output || {};
  const elevation = Number(sun.elevation) || 7;
  const intensity = Number(sun.intensity) || 1.8;
  const coverage = Number(clouds.coverage) || 62;
  const density = Number(clouds.density) || 0.7;
  const resolution = output.resolution || "4K";
  const lowSun = elevation < 12;
  const cloudy = coverage > 70 || density > 0.75;
  const quality = Math.max(58, Math.min(98, Math.round(92 - Math.abs(coverage - 55) * 0.12 - Math.abs(elevation - 10) * 0.18)));
  const risk = resolution === "16K" ? "Heavy render" : cloudy ? "Soft contrast" : intensity > 2.3 ? "Highlight clipping" : "Low";
  const hdri = cloudy ? "Soft Overcast" : lowSun ? "Golden Hour" : "Clean Daylight";
  const temp = lowSun ? "5200 K" : cloudy ? "6500 K" : "5900 K";
  const exposure = intensity > 2.2 ? "-0.10 EV" : cloudy ? "+0.45 EV" : "+0.20 EV";
  const suggestion = cloudy
    ? "increase exposure slightly, soften direct sun and keep a broad cool fill."
    : lowSun
      ? "use warm low sun, orange horizon scatter and a cooler blue zenith."
      : "keep neutral daylight, moderate turbidity and controlled highlight rolloff.";

  return {
    quality,
    risk,
    sun: `${Math.round(Number(sun.azimuth) || 215)}° / ${Math.round(elevation)}°`,
    intensity: intensity.toFixed(1),
    hdri,
    exposure,
    temp,
    suggestion
  };
}

function createPng(width, height, pixelAt) {
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      const offset = row + 1 + x * bytesPerPixel;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", createIhdr(width, height)),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function createIhdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function layeredNoise(x, y) {
  return (
    valueNoise(x, y) * 0.55 +
    valueNoise(x * 2.1 + 4.2, y * 2.1 - 1.7) * 0.3 +
    valueNoise(x * 4.4 - 2.0, y * 4.4 + 3.1) * 0.15
  );
}

function valueNoise(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = smooth(x - x0);
  const yf = smooth(y - y0);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return mix(mix(a, b, xf), mix(c, d, xf), yf);
}

function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function smooth(value) {
  return value * value * (3 - 2 * value);
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function shortestWrappedDistance(x, target, width) {
  const direct = x - target;
  const left = x - (target - width);
  const right = x - (target + width);
  return [direct, left, right].reduce((best, current) => Math.abs(current) < Math.abs(best) ? current : best, direct);
}

function renderPreviewSvg(job, manifest) {
  const scene = manifest.scene || {};
  const city = scene.city || "skyforge";
  const weather = scene.weather || "procedural";
  const sun = scene.sun || {};
  const clouds = scene.clouds || {};
  const output = scene.output || job.settings || {};
  const coverage = Math.max(0, Math.min(100, Number(clouds.coverage) || 52));
  const sunY = Math.max(160, Math.min(720, 720 - (Number(sun.elevation) || 7) * 5));
  const hazeOpacity = Math.max(0.1, Math.min(0.7, (Number(clouds.density) || 0.7) * 0.55));
  const cloudCount = Math.max(5, Math.min(18, Math.round(coverage / 7)));
  const cloudSvg = Array.from({ length: cloudCount }, (_, index) => {
    const x = 60 + ((index * 173) % 1160);
    const y = 90 + ((index * 61) % 300);
    const rx = 80 + ((index * 19) % 70);
    const ry = 22 + ((index * 11) % 24);
    const opacity = (0.18 + (coverage / 100) * 0.35).toFixed(2);
    return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#fff4d8" opacity="${opacity}"/>`;
  }).join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" role="img" aria-label="SkyForge render preview">
  <defs>
    <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#07111f"/>
      <stop offset="28%" stop-color="#17345c"/>
      <stop offset="52%" stop-color="#b9651f"/>
      <stop offset="72%" stop-color="#5a2110"/>
      <stop offset="100%" stop-color="#090608"/>
    </linearGradient>
    <radialGradient id="sun" cx="50%" cy="${(sunY / 720 * 100).toFixed(1)}%" r="28%">
      <stop offset="0%" stop-color="#fff9c8" stop-opacity="1"/>
      <stop offset="18%" stop-color="#ffd64c" stop-opacity=".95"/>
      <stop offset="55%" stop-color="#df781d" stop-opacity=".35"/>
      <stop offset="100%" stop-color="#df781d" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="haze" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#254d80" stop-opacity=".18"/>
      <stop offset="50%" stop-color="#ffb156" stop-opacity="${hazeOpacity.toFixed(2)}"/>
      <stop offset="100%" stop-color="#121a30" stop-opacity=".22"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#sky)"/>
  <rect width="1280" height="720" fill="url(#sun)"/>
  <rect y="300" width="1280" height="220" fill="url(#haze)" opacity=".82"/>
  <g filter="blur(1px)">
    ${cloudSvg}
  </g>
  <circle cx="640" cy="${sunY.toFixed(0)}" r="34" fill="#fff2a4" opacity=".92"/>
  <path d="M0 530 C240 500 420 565 640 535 C850 508 1020 545 1280 515 L1280 720 L0 720 Z" fill="#0b0a0b" opacity=".55"/>
  <g font-family="DM Mono, Consolas, monospace" fill="#fff" opacity=".9">
    <text x="32" y="48" font-size="24">SkyForge Preview</text>
    <text x="32" y="82" font-size="16">${escapeXml(city)} · ${escapeXml(weather)} · ${escapeXml(output.resolution || job.settings?.resolution || "4K")}</text>
    <text x="32" y="686" font-size="13">${escapeXml(job.filename)} · ${escapeXml(job.id)}</text>
  </g>
</svg>
`;
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&"']/g, (ch) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&apos;"
  })[ch]);
}

function toPublicPath(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function startRenderWorker() {
  setInterval(() => {
    processRenderQueue();
  }, WORKER_TICK_MS);
  processRenderQueue();
}

function listUsers() {
  return db.prepare("SELECT * FROM users ORDER BY created_at DESC").all().map(userFromRow);
}

function createUser(body) {
  const now = new Date().toISOString();
  const id = safeId(body.id || body.name || `user-${Date.now()}`);

  db.prepare(`
    INSERT INTO users (id, name, email, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    body.name || "Unnamed User",
    body.email || null,
    body.role || "artist",
    now,
    now
  );

  return userFromRow(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}

function listAssets(url) {
  const type = url.searchParams.get("type");
  const query = (url.searchParams.get("q") || "").toLowerCase();
  let rows;

  if (type) {
    rows = db.prepare("SELECT * FROM assets WHERE type = ? ORDER BY name").all(type);
  } else {
    rows = db.prepare("SELECT * FROM assets ORDER BY type, name").all();
  }

  const assets = rows.map(assetFromRow);
  if (!query) return assets;

  return assets.filter((asset) => {
    const haystack = `${asset.name} ${asset.type} ${asset.tags.join(" ")}`.toLowerCase();
    return haystack.includes(query);
  });
}

function createAsset(body) {
  const now = new Date().toISOString();
  const id = safeId(body.id || body.name || `asset-${Date.now()}`);

  if (db.prepare("SELECT id FROM assets WHERE id = ?").get(id)) {
    const error = new Error("Asset already exists");
    error.statusCode = 409;
    throw error;
  }

  db.prepare(`
    INSERT INTO assets (id, type, name, tags_json, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    body.type || "asset",
    body.name || "Untitled Asset",
    stringify(body.tags || []),
    stringify(body.metadata || {}),
    now,
    now
  );

  return assetFromRow(db.prepare("SELECT * FROM assets WHERE id = ?").get(id));
}

function getAsset(id) {
  return assetFromRow(db.prepare("SELECT * FROM assets WHERE id = ?").get(safeId(id)));
}

function updateAsset(id, body) {
  const safeAssetId = safeId(id);
  const existing = getAsset(safeAssetId);
  if (!existing) {
    const error = new Error("Asset not found");
    error.statusCode = 404;
    throw error;
  }

  db.prepare(`
    UPDATE assets
    SET type = ?, name = ?, tags_json = ?, metadata_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    body.type || existing.type,
    body.name || existing.name,
    stringify(body.tags || existing.tags || []),
    stringify(body.metadata || existing.metadata || {}),
    new Date().toISOString(),
    safeAssetId
  );

  return getAsset(safeAssetId);
}

function deleteAsset(id) {
  const safeAssetId = safeId(id);
  if (!getAsset(safeAssetId)) {
    const error = new Error("Asset not found");
    error.statusCode = 404;
    throw error;
  }

  db.prepare("DELETE FROM assets WHERE id = ?").run(safeAssetId);
  return { ok: true, deleted: safeAssetId };
}

function getActivity(limit = 40) {
  const versionRows = db.prepare(`
    SELECT 'version' AS kind, id, project_id AS projectId, note AS label, created_at AS createdAt
    FROM project_versions
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  const renderRows = db.prepare(`
    SELECT 'render' AS kind, id, project_id AS projectId, status AS label, updated_at AS createdAt
    FROM renders
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);

  return versionRows.concat(renderRows)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

function renderFilename(job) {
  const resolution = job.settings?.resolution || "4K";
  const format = String(job.settings?.format || "EXR").split(" ")[0].toLowerCase();
  return `SkyForge_${resolution}_${job.id.slice(0, 8)}.${format}`;
}

function renderDimensions(resolution) {
  const sizes = {
    "2K": "2048x1024",
    "4K": "4096x2048",
    "8K": "8192x4096",
    "16K": "16384x8192"
  };
  return sizes[resolution] || sizes["4K"];
}

function clampProgress(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "skyforge-backend",
      database: path.basename(DB_FILE)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stats") {
    sendJson(res, 200, getStats());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/activity") {
    sendJson(res, 200, { activity: getActivity(Number(url.searchParams.get("limit") || 40)) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/geo/search") {
    sendJson(res, 200, await searchGeo(url));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/weather") {
    sendJson(res, 200, await getWeather(url));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/settings") {
    sendJson(res, 200, getSettings());
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/settings") {
    sendJson(res, 200, saveSettings(await parseBody(req)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/preview") {
    const body = await parseBody(req);
    sendBuffer(res, 200, "image/png", previewPngFromScene(body.scene || body, body.settings || {}));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/scene/analyze") {
    const body = await parseBody(req);
    sendJson(res, 200, analyzeScene(body.scene || body));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    sendJson(res, 200, { projects: listProjects() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    sendJson(res, 201, createProject(await parseBody(req)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/import") {
    sendJson(res, 201, importProjectBundle(await parseBody(req)));
    return;
  }

  const projectDuplicateMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/duplicate$/);
  if (projectDuplicateMatch && req.method === "POST") {
    sendJson(res, 201, duplicateProject(projectDuplicateMatch[1], await parseBody(req)));
    return;
  }

  const projectExportMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/export$/);
  if (projectExportMatch && req.method === "GET") {
    sendJson(res, 200, exportProject(projectExportMatch[1]));
    return;
  }

  const projectVersionsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/versions$/);
  if (projectVersionsMatch && req.method === "GET") {
    sendJson(res, 200, { versions: listProjectVersions(projectVersionsMatch[1]) });
    return;
  }

  if (projectVersionsMatch && req.method === "POST") {
    sendJson(res, 201, createProjectVersion(projectVersionsMatch[1], await parseBody(req)));
    return;
  }

  const projectVersionRestoreMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/versions\/(\d+)\/restore$/);
  if (projectVersionRestoreMatch && req.method === "POST") {
    sendJson(res, 200, restoreProjectVersion(projectVersionRestoreMatch[1], projectVersionRestoreMatch[2]));
    return;
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && req.method === "GET") {
    const project = getProject(projectMatch[1]);
    if (!project) {
      sendError(res, 404, "Project not found");
      return;
    }
    sendJson(res, 200, project);
    return;
  }

  if (projectMatch && req.method === "PUT") {
    sendJson(res, 200, saveProject(projectMatch[1], await parseBody(req)));
    return;
  }

  if (projectMatch && req.method === "DELETE") {
    sendJson(res, 200, deleteProject(projectMatch[1]));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/renders") {
    sendJson(res, 200, {
      renders: listRenders({
        projectId: url.searchParams.get("projectId"),
        status: url.searchParams.get("status")
      })
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/worker") {
    sendJson(res, 200, getWorkerStatus());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/renders") {
    sendJson(res, 201, createRender(await parseBody(req)));
    return;
  }

  const renderLogsMatch = url.pathname.match(/^\/api\/renders\/([^/]+)\/logs$/);
  if (renderLogsMatch && req.method === "GET") {
    sendJson(res, 200, { logs: listRenderLogs(renderLogsMatch[1]) });
    return;
  }

  const renderArtifactsMatch = url.pathname.match(/^\/api\/renders\/([^/]+)\/artifacts$/);
  if (renderArtifactsMatch && req.method === "GET") {
    sendJson(res, 200, getRenderArtifacts(renderArtifactsMatch[1]));
    return;
  }

  const renderMatch = url.pathname.match(/^\/api\/renders\/([^/]+)$/);
  const renderRetryMatch = url.pathname.match(/^\/api\/renders\/([^/]+)\/retry$/);
  if (renderRetryMatch && req.method === "POST") {
    sendJson(res, 201, retryRender(renderRetryMatch[1]));
    return;
  }

  if (renderMatch && req.method === "GET") {
    const job = getRender(renderMatch[1]);
    if (!job) {
      sendError(res, 404, "Render job not found");
      return;
    }
    sendJson(res, 200, job);
    return;
  }

  if (renderMatch && req.method === "PATCH") {
    sendJson(res, 200, updateRender(renderMatch[1], await parseBody(req)));
    return;
  }

  if (renderMatch && req.method === "DELETE") {
    sendJson(res, 200, deleteRender(renderMatch[1]));
    return;
  }

  const renderCancelMatch = url.pathname.match(/^\/api\/renders\/([^/]+)\/cancel$/);
  if (renderCancelMatch && req.method === "POST") {
    sendJson(res, 200, cancelRender(renderCancelMatch[1]));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/users") {
    sendJson(res, 200, { users: listUsers() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    sendJson(res, 201, createUser(await parseBody(req)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/assets") {
    sendJson(res, 200, { assets: listAssets(url) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/assets") {
    sendJson(res, 201, createAsset(await parseBody(req)));
    return;
  }

  const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (assetMatch && req.method === "GET") {
    const asset = getAsset(assetMatch[1]);
    if (!asset) {
      sendError(res, 404, "Asset not found");
      return;
    }
    sendJson(res, 200, asset);
    return;
  }

  if (assetMatch && req.method === "PUT") {
    sendJson(res, 200, updateAsset(assetMatch[1], await parseBody(req)));
    return;
  }

  if (assetMatch && req.method === "DELETE") {
    sendJson(res, 200, deleteAsset(assetMatch[1]));
    return;
  }

  sendError(res, 404, "API route not found");
}

async function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? INDEX_FILE : path.join(ROOT, decodeURIComponent(url.pathname));
  const normalizedPath = path.normalize(requestedPath);

  if (!normalizedPath.startsWith(ROOT)) {
    sendError(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(normalizedPath);
    const type = MIME_TYPES[path.extname(normalizedPath).toLowerCase()] || "application/octet-stream";
    const headers = { "Content-Type": type };
    if (type.includes("text/html")) {
      headers["Cache-Control"] = "no-store, max-age=0";
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    sendError(res, 404, "File not found");
  }
}

async function main() {
  await ensureStorage();
  startRenderWorker();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
      } else {
        await serveStatic(req, res, url);
      }
    } catch (error) {
      sendError(res, error.statusCode || 500, error.message || "Internal server error");
    }
  });

  server.listen(PORT, () => {
    safeLog("log", `SkyForge backend running at http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  safeLog("error", error);
  process.exit(1);
});
