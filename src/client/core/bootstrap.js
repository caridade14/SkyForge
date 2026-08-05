import { createSkyForgeStore } from "./state-store.js";
import { TimelineEngine } from "./timeline-engine.js";
import { NodeGraph } from "./node-graph.js";
import { ProjectService } from "./project-service.js";
import { BlenderBridgeClient } from "./blender-bridge.js";
import { LightingSync } from "./lighting-sync.js";
import { RenderService } from "./render-service.js";
import { SkyForgeUIBridge } from "./ui-bridge.js";

function boot() {
  if (globalThis.SkyForgeCore?.version === "v11") return globalThis.SkyForgeCore;

  const store = createSkyForgeStore({
    storageKey: "skyforge.core.v11.autosave",
    historyLimit: 240,
    autosaveDelay: 700
  });
  store.restore();

  const nodeGraph = new NodeGraph({ serialized: store.get("nodes") });
  if (!nodeGraph.nodes.size) nodeGraph.createDefaultGraph();
  store.set("nodes", nodeGraph.serialize(), { transient: true, record: false });

  const timeline = new TimelineEngine(store);
  const projects = new ProjectService(store, { timeline, nodeGraph, appVersion: "v11", appBuild: "CORE11" });
  const blender = new BlenderBridgeClient(store);
  const lighting = new LightingSync(store);
  const render = new RenderService(store);
  const ui = new SkyForgeUIBridge({ store, timeline, nodeGraph, projects, blender, lighting, render });

  nodeGraph.subscribe((_event, serialized) => {
    store.set("nodes", serialized, { label: "Edit node graph" });
  });
  timeline.subscribe((event) => {
    if (event.type === "seek" || event.type === "play" || event.type === "pause") {
      store.batch("Update timeline transport", (draft) => {
        draft.timeline.currentFrame = event.currentFrame;
        draft.timeline.playing = event.playing;
      }, { transient: true, record: false });
    }
  });

  ui.init();
  lighting.schedule();
  blender.startPolling(8000);
  store.batch("Finish SkyForge Core boot", (draft) => {
    draft.app.version = "v11";
    draft.app.build = "CORE11";
    draft.app.ready = true;
  }, { transient: true, record: false });

  const api = {
    version: "v11",
    build: "CORE11",
    store,
    timeline,
    nodeGraph,
    projects,
    blender,
    lighting,
    render,
    ui,
    openHub: (section) => ui.openHub(section),
    save: () => projects.download(),
    open: () => projects.openPicker(),
    newProject: (name) => projects.newProject(name),
    undo: () => store.undo(),
    redo: () => store.redo(),
    sendToBlender: (options) => blender.send(options),
    queueRender: (options) => render.queue(options),
    dispose() {
      blender.stopPolling();
      lighting.dispose();
      timeline.dispose();
      ui.dispose();
      store.destroy();
      delete globalThis.SkyForgeCore;
    }
  };

  globalThis.SkyForgeCore = api;
  globalThis.dispatchEvent?.(new CustomEvent("skyforge:core-ready", { detail: api }));
  return api;
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();

export { boot };
