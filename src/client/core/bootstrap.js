import "./performance-guard.js";
import { SkyForgeViewport } from "../viewport/viewport.js";
import { createSkyForgeStore } from "./state-store.js";
import { TimelineEngine } from "./timeline-engine.js";
import { NodeGraph } from "./node-graph.js";
import { ProjectService, completeProjectState } from "./project-service.js";
import { BlenderBridgeClient } from "./blender-bridge.js";
import { LightingSync } from "./lighting-sync.js";
import { RenderService } from "./render-service.js";
import { SkyForgeUIBridge } from "./ui-bridge.js";
import { Composition } from "../studio/composition.js";
import { TimelinePanel } from "../studio/timeline-panel.js";
import { NodePanel } from "../studio/node-panel.js";
import { StudioWorkspace } from "../studio/workspace.js";

function boot() {
  if (globalThis.SkyForgeCore?.version === "v11") return globalThis.SkyForgeCore;

  const store = createSkyForgeStore({
    storageKey: "skyforge.core.v11.autosave",
    historyLimit: 240,
    autosaveDelay: 700
  });
  store.restore();
  store.replace(completeProjectState(store.snapshot()), { transient: true, record: false });

  const nodeGraph = new NodeGraph({ serialized: store.get("nodes") });
  if (!nodeGraph.nodes.size) nodeGraph.createDefaultGraph();
  store.set("nodes", nodeGraph.serialize(), { transient: true, record: false });

  const timeline = new TimelineEngine(store);
  const projects = new ProjectService(store, { timeline, nodeGraph, appVersion: "v11", appBuild: "CORE11" });
  const blender = new BlenderBridgeClient(store);
  const lighting = new LightingSync(store);
  const render = new RenderService(store);
  const ui = new SkyForgeUIBridge({ store, timeline, nodeGraph, projects, blender, lighting, render });

  ui.init();
  const viewport = new SkyForgeViewport(store).init();
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
    viewport,
    performance: globalThis.__skyforgePerformanceGuard || null,
    openHub: (section) => ui.openHub(section),
    save: () => projects.download(),
    open: () => projects.openPicker(),
    newProject: (name) => projects.newProject(name),
    undo: () => store.undo(),
    redo: () => store.redo(),
    sendToBlender: (options) => blender.send(options),
    queueRender: (options) => render.queue(options),
    dispose() {
      globalThis.removeEventListener?.("pagehide", onPageHide);
      api.timelinePanel?.dispose();
      api.nodePanel?.dispose();
      api.workspace?.dispose();
      api.composition?.dispose();
      viewport.dispose();
      blender.stopPolling();
      lighting.dispose();
      timeline.dispose();
      ui.dispose();
      store.destroy();
      globalThis.__skyforgePerformanceGuard?.dispose?.();
      delete globalThis.SkyForgeCore;
    }
  };

  const onPageHide = (event) => { if (!event.persisted) api.dispose(); };
  globalThis.addEventListener?.("pagehide", onPageHide);

  api.composition = new Composition(api).init();
  api.workspace = new StudioWorkspace(api).init();
  if (api.workspace.editors) {
    api.timelinePanel = new TimelinePanel(api).init(api.workspace.editors.timeline);
    api.nodePanel = new NodePanel(api).init(api.workspace.editors.nodes);
  }

  globalThis.SkyForgeCore = api;
  globalThis.dispatchEvent?.(new CustomEvent("skyforge:core-ready", { detail: api }));
  return api;
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();

export { boot };
