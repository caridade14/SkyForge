const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const CLIENT_ROOT = path.join(ROOT, "src", "client", "core");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

test("Core v11 browser modules have valid ES module syntax", () => {
  const modules = fs.readdirSync(CLIENT_ROOT).filter((name) => name.endsWith(".js"));
  assert.ok(modules.length >= 9);
  for (const moduleName of modules) {
    const source = fs.readFileSync(path.join(CLIENT_ROOT, moduleName), "utf8");
    const result = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: source, encoding: "utf8" });
    assert.equal(result.status, 0, `${moduleName}: ${result.stderr}`);
  }
});

test("SkyForge store supports state changes, undo and redo", async () => {
  const module = await import(dataUrl(read("src/client/core/state-store.js")));
  const store = new module.SkyForgeStore({ storage: null });
  assert.equal(store.get("sun.elevation"), 7);
  store.set("sun.elevation", 18, { label: "Move sun" });
  assert.equal(store.get("sun.elevation"), 18);
  assert.equal(store.undo(), true);
  assert.equal(store.get("sun.elevation"), 7);
  assert.equal(store.redo(), true);
  assert.equal(store.get("sun.elevation"), 18);
});

test("Timeline interpolates numeric keyframes", async () => {
  const stateUrl = dataUrl(read("src/client/core/state-store.js"));
  const timelineSource = read("src/client/core/timeline-engine.js").replace('"./state-store.js"', JSON.stringify(stateUrl));
  const stateModule = await import(stateUrl);
  const timelineModule = await import(dataUrl(timelineSource));
  const store = new stateModule.SkyForgeStore({ storage: null });
  const timeline = new timelineModule.TimelineEngine(store, { startFrame: 1, endFrame: 11 });
  timeline.addKeyframe("sun.elevation", 1, 0);
  timeline.addKeyframe("sun.elevation", 11, 100);
  assert.equal(timeline.sample("sun.elevation", 6), 50);
  timeline.dispose();
});

test("Default node graph evaluates a complete sky scene", async () => {
  const stateUrl = dataUrl(read("src/client/core/state-store.js"));
  const graphSource = read("src/client/core/node-graph.js").replace('"./state-store.js"', JSON.stringify(stateUrl));
  const graphModule = await import(dataUrl(graphSource));
  const graph = new graphModule.NodeGraph();
  graph.createDefaultGraph();
  const result = graph.evaluateOutput({ state: { sun: { elevation: 25 }, atmosphere: { turbidity: 3 }, clouds: { coverage: 0.4 }, color: { workingSpace: "ACEScg" } } });
  assert.equal(result.sun.elevation, 25);
  assert.equal(result.atmosphere.turbidity, 3);
  assert.equal(result.color.workingSpace, "ACEScg");
});

test("Performance guard deduplicates identical physical preview requests", async () => {
  const performanceModule = await import(dataUrl(read("src/client/core/performance-guard.js")));
  let calls = 0;
  const root = {
    location: { href: "http://localhost:3000/" },
    fetch: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }
  };
  const scheduler = performanceModule.installPreviewFetchScheduler(root);
  const [first, second] = await Promise.all([
    root.fetch("/api/lighting/preview", { method: "POST", body: "{}" }),
    root.fetch("/api/lighting/preview", { method: "POST", body: "{}" })
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(await first.json(), { ok: true });
  assert.deepEqual(await second.json(), { ok: true });
  scheduler.restore();
});

test("Performance guard throttles the legacy drawSky loop", async () => {
  const performanceModule = await import(dataUrl(read("src/client/core/performance-guard.js")));
  let now = 0;
  let calls = 0;
  const root = {
    performance: { now: () => now },
    drawSky: () => { calls += 1; return calls; }
  };
  assert.equal(performanceModule.throttleGlobalFunction("drawSky", 10, root), true);
  root.drawSky();
  now = 20;
  root.drawSky();
  now = 120;
  root.drawSky();
  assert.equal(calls, 2);
});

test("Natural-light gateway injects Core v11 and exposes Blender bridge routes", () => {
  const server = read("server-natural-light.js");
  assert.match(server, /skyforge-core-v11\.css/);
  assert.match(server, /src\/client\/core\/bootstrap\.js/);
  assert.match(server, /\/api\/core\/health/);
  assert.match(server, /\/api\/bridge\/blender\/health/);
  assert.match(server, /\/api\/bridge\/blender\/send/);
  assert.match(server, /blender-world-latest\.json/);
});

test("Blender addon exposes a localhost-only N-panel bridge", () => {
  const addon = read("integrations/blender/skyforge_bridge_addon.py");
  assert.match(addon, /BRIDGE_HOST = "127\.0\.0\.1"/);
  assert.match(addon, /BRIDGE_PORT = 8765/);
  assert.match(addon, /\/skyforge\/health/);
  assert.match(addon, /\/skyforge\/world/);
  assert.match(addon, /bl_space_type = "VIEW_3D"/);
  assert.match(addon, /bl_region_type = "UI"/);
  assert.match(addon, /bl_category = "SkyForge"/);
  assert.match(addon, /"version": \(1, 1, 0\)/);
});
