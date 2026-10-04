const CONTROL_BINDINGS = {
  "time of day": ["time.timeOfDay", 1], date: ["time.date", 1], latitude: ["location.latitude", 1], longitude: ["location.longitude", 1], location: ["location.name", 1],
  elevation: ["sun.elevation", 1], azimuth: ["sun.azimuth", 1], "sun intensity": ["sun.intensity", 0.1], "color temp (k)": ["sun.temperature", 1],
  turbidity: ["atmosphere.turbidity", 0.1], haze: ["atmosphere.haze", 0.1], "ozone layer": ["atmosphere.ozone", 0.1], "mie scattering": ["atmosphere.mieCoefficient", 0.001],
  rayleigh: ["atmosphere.rayleigh", .1], "mie anisotropy": ["atmosphere.mieDirectionalG", .01],
  coverage: ["clouds.coverage", 0.01], altitude: ["clouds.altitude", 1], thickness: ["clouds.thickness", 1], density: ["clouds.density", 0.01], erosion: ["clouds.erosion", 0.01], detail: ["clouds.detail", 0.01],
  "wind speed": ["clouds.windSpeed", 1], "wind direction": ["clouds.windDirection", 1], precipitation: ["clouds.precipitation", 0.01], exposure: ["camera.exposure", 0.1], saturation: ["color.saturation", 0.01], contrast: ["color.contrast", 0.01]
};

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (match) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[match]));
const normalize = (value) => String(value || "").replace(/\s+/g, " ").replace(/[:：]$/, "").trim().toLowerCase();
const editable = (target) => Boolean(target?.closest?.("input,textarea,select,[contenteditable='true']"));
const SUN_CONTROL_SELECTOR = '[data-sf-core-path="sun.azimuth"],[data-sf-core-path="sun.elevation"]';
const angleText = (value) => `${Number(value.toFixed(1))}°`;

function matchingControls(root, selector) {
  return [...(root.matches?.(selector) ? [root] : []), ...(root.querySelectorAll?.(selector) || [])];
}

function controlLabel(control) {
  return normalize(control.closest(".sl-wrap,.s-row,.tog-row,.prefs-field,.rp-sec")?.querySelector(".sl-name,.s-lbl,.tog-lbl,.prefs-lbl,.rp-title")?.textContent);
}

function stateSummary(state) {
  return `${state.project?.name || "Untitled Sky"}${state.project?.modified ? " • Modified" : ""} • ${state.engine?.lighting?.status || "idle"}`;
}

export class SkyForgeUIBridge {
  constructor(services) {
    Object.assign(this, services);
    this.bound = new WeakSet();
    this.hub = null;
    this.status = null;
    this.toasts = null;
    this.unsubscribe = null;
    this.observer = null;
    this.disposed = false;
    this.sunControlDocuments = new Map();
    this.controlListeners = new Map();
    this.controlBindings = new Map();
    this.keyboardOwner = null;
    this.keyboardHandler = null;
  }

  init() {
    document.documentElement.classList.add("sf-core-v11");
    document.body.classList.add("sf-core-ready");
    document.title = "SkyForge Core v11 — HDRI & Atmosphere Workstation";
    this.disableLegacySplash();
    this.upgradeBranding();
    this.createUI();
    this.bindControls(document);
    this.bindKeyboard();
    this.observe();
    this.unsubscribe = this.store.subscribe((state, change) => this.refresh(state, change));
    this.refresh(this.store.snapshot(), { type: "boot", label: "Core initialized" });
    this.toast("SkyForge Core v11 loaded", "success");
    return this;
  }

  disableLegacySplash() {
    try { localStorage.setItem("skyforge.startupSplash.hidden.v1", "1"); } catch {}
    const hide = () => {
      const splash = document.getElementById("sf-startup-ov");
      if (splash?.classList.contains("show")) splash.classList.remove("show");
    };
    hide();
    globalThis.sfCloseStartupSplash = hide;
    globalThis.sfShowStartupSplash = (force) => { hide(); if (force) this.openHub(); };
    const splash = document.getElementById("sf-startup-ov");
    if (splash) {
      this.splashObserver = new MutationObserver(hide);
      this.splashObserver.observe(splash, { attributes: true, attributeFilter: ["class"] });
    }
  }

  upgradeBranding() {
    try { globalThis.SF_APP_VERSION = "v11"; globalThis.SF_APP_BUILD = "CORE11"; } catch {}
    document.querySelectorAll(".logo-ver").forEach((item) => { item.textContent = "v11"; });
    const logo = document.querySelector(".logo");
    if (logo && !logo.querySelector(".sf-core-badge")) {
      const badge = document.createElement("button");
      badge.className = "sf-core-badge";
      badge.textContent = "CORE";
      badge.title = "Open Command Center (Ctrl+Shift+H)";
      badge.onclick = (event) => { event.stopPropagation(); this.openHub(); };
      logo.appendChild(badge);
    }
  }

  createUI() {
    this.toasts = document.createElement("div");
    this.toasts.className = "sf-core-toasts";
    document.body.appendChild(this.toasts);

    this.status = document.createElement("button");
    this.status.className = "sf-core-status";
    this.status.innerHTML = '<i></i><span>Core loading</span>';
    this.status.onclick = () => this.openHub("engine");
    document.body.appendChild(this.status);

    this.hub = document.createElement("div");
    this.hub.className = "sf-core-hub";
    this.hub.hidden = true;
    this.hub.innerHTML = `
      <div class="sf-core-backdrop" data-action="close"></div>
      <section class="sf-core-window" role="dialog" aria-modal="true">
        <header><div class="sf-core-mark">SF</div><div><small>PRODUCTION WORKSPACE</small><h1>SkyForge Core <b>v11</b></h1></div><button data-action="close">×</button></header>
        <nav><button class="active" data-section="project">Project</button><button data-section="engine">Engine</button><button data-section="pipeline">Pipeline</button><button data-section="bridge">Blender Bridge</button></nav>
        <main>
          <section class="active" data-panel="project"><div class="sf-core-hero"><small>ACTIVE PROJECT</small><h2 data-field="project">Untitled Sky</h2><p>Central state, autosave, recovery and non-destructive history.</p></div><div class="sf-core-actions"><button data-action="new"><b>New Project</b><span>Clean physical sky</span></button><button data-action="open"><b>Open Project</b><span>.skyforge or JSON</span></button><button class="primary" data-action="save"><b>Save Project</b><span>Portable project file</span></button><button data-action="undo"><b>Undo</b><span>Previous state</span></button><button data-action="redo"><b>Redo</b><span>Reapply change</span></button><button data-action="reset-layout"><b>Reset Workspace</b><span>Restore panels</span></button></div></section>
          <section data-panel="engine"><div class="sf-core-metrics"><article><small>LIGHTING</small><b data-field="lighting">idle</b></article><article><small>ATMOSPHERE</small><b data-field="atmosphere">Physical</b></article><article><small>TIMELINE</small><b data-field="timeline">Frame 1</b></article><article><small>NODES</small><b data-field="nodes">0 nodes</b></article></div><div class="sf-core-row"><button data-action="evaluate">Evaluate Physical Sky</button><button data-action="timeline">Play / Pause</button><button data-action="graph">Default Node Graph</button></div><pre data-field="log">Engine ready.</pre></section>
          <section data-panel="pipeline"><div class="sf-core-pipeline"><article><span>01</span><b>Physical Atmosphere</b><small>Rayleigh, Mie, ozone and multiple scattering</small></article><article><span>02</span><b>Procedural Clouds</b><small>Coverage, density, altitude, erosion and wind</small></article><article><span>03</span><b>Display Preview</b><small>sRGB display; ACES / OpenColorIO workflow pending</small></article><article><span>04</span><b>Render Jobs</b><small>Queue and preview; professional HDR / EXR renderer pending</small></article></div><div class="sf-core-row"><button data-action="preview">Generate Preview</button><button class="primary" data-action="render">Queue Render Job</button></div></section>
          <section data-panel="bridge"><div class="sf-core-bridge"><i data-field="bridge-orb"></i><div><small>BLENDER LOCAL BRIDGE</small><h2 data-field="bridge">Checking…</h2><p>Local port 8765 with queued payload fallback.</p></div></div><div class="sf-core-row"><button data-action="bridge-health">Test Connection</button><button class="primary" data-action="bridge-send">Send World to Blender</button></div><p class="sf-core-help">Install <code>integrations/blender/skyforge_bridge_addon.py</code>, enable it, then press Start Bridge in Blender.</p></section>
        </main>
        <footer><span>CORE11 • Schema 3 • Display preview</span><span data-field="footer">Ready</span></footer>
      </section>`;
    this.hub.onclick = (event) => {
      const section = event.target.closest("[data-section]")?.dataset.section;
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (section) this.setSection(section);
      if (action) this.action(action);
    };
    document.body.appendChild(this.hub);
  }

  toast(message, tone = "info") {
    const item = document.createElement("div");
    item.className = `sf-core-toast ${tone}`;
    item.innerHTML = `<i></i><span>${esc(message)}</span>`;
    this.toasts.appendChild(item);
    requestAnimationFrame(() => item.classList.add("show"));
    setTimeout(() => { item.classList.remove("show"); setTimeout(() => item.remove(), 200); }, 2800);
  }

  setSection(section) {
    if (!["project", "engine", "pipeline", "bridge"].includes(section)) section = "project";
    this.hub.querySelectorAll("[data-section]").forEach((item) => item.classList.toggle("active", item.dataset.section === section));
    this.hub.querySelectorAll("[data-panel]").forEach((item) => item.classList.toggle("active", item.dataset.panel === section));
  }

  openHub(section = "project") { this.setSection(section); this.hub.hidden = false; document.body.classList.add("sf-core-hub-open"); }
  closeHub() { this.hub.hidden = true; document.body.classList.remove("sf-core-hub-open"); }

  async action(action) {
    try {
      if (action === "close") return this.closeHub();
      if (action === "new") { this.projects.newProject(); return this.toast("New project created", "success"); }
      if (action === "open") { if (await this.projects.openPicker()) this.toast("Project opened", "success"); return; }
      if (action === "save") { this.projects.download(); return this.toast("Project exported", "success"); }
      if (action === "undo") return this.store.undo() ? this.toast("Undo") : this.toast("Nothing to undo", "warning");
      if (action === "redo") return this.store.redo() ? this.toast("Redo") : this.toast("Nothing to redo", "warning");
      if (action === "reset-layout") { document.body.classList.remove("sf-hide-left", "sf-hide-right", "sf-hide-timeline", "sf-hide-status"); globalThis.dispatchEvent?.(new Event("skyforge:reset-workspace")); return this.toast("Workspace restored", "success"); }
      if (action === "evaluate") { const result = await this.lighting.evaluate(); return this.toast(result ? "Physical sky evaluated" : "Lighting evaluation failed", result ? "success" : "error"); }
      if (action === "timeline") return this.timeline.toggle();
      if (action === "graph") {
        const graph = new this.nodeGraph.constructor(); graph.registry = this.nodeGraph.registry;
        graph.createDefaultGraph();
        this.store.set("nodes", graph.serialize(), { label: "Create default node graph" });
        return this.toast("Default node graph created", "success");
      }
      if (action === "preview") { await this.render.preview(); return this.toast("Preview generated", "success"); }
      if (action === "render") { await this.render.queue(); return this.toast("Render job queued", "success"); }
      if (action === "bridge-health") { const result = await this.blender.health(); return this.toast(result.connected ? "Blender connected" : "Blender is offline", result.connected ? "success" : "warning"); }
      if (action === "bridge-send") { const result = await this.blender.send(); return this.toast(result.forwarded ? "World sent to Blender" : "World queued for Blender", result.forwarded ? "success" : "warning"); }
    } catch (error) { this.toast(error.message || "Operation failed", "error"); }
  }

  bindControls(root) {
    if (this.disposed) return;
    matchingControls(root, "input,select").forEach((control) => {
      if (this.bound.has(control)) return;
      const [path, defaultScale] = CONTROL_BINDINGS[controlLabel(control)] || [];
      if (!path) return;
      // Legacy normalized sliders use both 0..10 and 0..100. In particular,
      // density is 0..10: binding it as percent made 0.7 become at most 0.1.
      const scale = ["clouds.density", "clouds.erosion", "clouds.detail"].includes(path) && control.type === "range" && Number(control.max) === 10 ? .1 : defaultScale;
      this.bound.add(control);
      control.dataset.sfCorePath = path;
      control.dataset.sfCoreScale = String(scale);
      this.controlBindings.set(control, { path, scale });
      this.bindSunControlEvents(control.ownerDocument || document);
      const commit = () => {
        if (this.disposed) return;
        if (control.value === "" && ["range", "number"].includes(control.type)) return;
        const numeric = Number(control.value);
        const value = control.type === "checkbox" ? control.checked : control.tagName === "SELECT" || ["text", "date", "time"].includes(control.type) ? control.value : Number.isFinite(numeric) ? numeric * scale : control.value;
        this.store.set(path, value, { label: `Change ${controlLabel(control)}` });
      };
      control.addEventListener("input", commit);
      control.addEventListener("change", commit);
      this.controlListeners.set(control, commit);
      const value = this.store.get(path);
      if (value !== undefined) control.type === "checkbox" ? control.checked = Boolean(value) : control.value = typeof value === "number" ? value / scale : value;
    });
    this.syncControls(this.store.snapshot(), root);
  }

  bindSunControlEvents(documentRef) {
    if (this.disposed || this.sunControlDocuments.has(documentRef)) return;
    const sync = (event) => {
      const path = event.target?.dataset?.sfCorePath;
      // Document bubbling follows the late legacy listeners on the input itself.
      if (!this.disposed && path) this.syncControls(this.store.snapshot(), documentRef);
    };
    documentRef.addEventListener("input", sync);
    documentRef.addEventListener("change", sync);
    this.sunControlDocuments.set(documentRef, sync);
  }

  syncSunControls(state, root = document) {
    const documentRef = root.ownerDocument || (root.getElementById ? root : document);
    matchingControls(root, SUN_CONTROL_SELECTOR).forEach((control) => {
      const axis = control.dataset.sfCorePath.split(".")[1];
      const value = state.sun?.[axis];
      if (!Number.isFinite(value)) return;
      if (control.type === "range") {
        // The full elevation range also represents physical night-time directions.
        control.min = axis === "elevation" ? "-90" : "0";
        control.max = axis === "elevation" ? "90" : "360";
        control.step = "0.1";
      }
      control.value = value;
      const label = control.closest(".sl-wrap,.s-row,.tog-row,.prefs-field,.rp-sec")?.querySelector(".sl-val");
      if (label) label.textContent = angleText(value);
    });
    const { azimuth, elevation } = state.sun || {};
    for (const [id, value] of [["v-az", azimuth], ["v-elev", elevation]]) {
      const label = documentRef.getElementById(id);
      if (label && Number.isFinite(value)) label.textContent = angleText(value);
    }
    if (Number.isFinite(azimuth) && Number.isFinite(elevation)) {
      for (const id of ["rp-sun", "ai-sun"]) {
        const label = documentRef.getElementById(id);
        if (label) label.textContent = `${angleText(azimuth)} / ${angleText(elevation)}`;
      }
    }
  }

  syncControls(state, root = document) {
    for (const [control, { path, scale }] of this.controlBindings) {
      if (root !== control.ownerDocument && root !== control && root.contains && !root.contains(control)) continue;
      const value = path.split(".").reduce((part, key) => part?.[key], state);
      if (value === undefined || path === "sun.azimuth" || path === "sun.elevation") continue;
      if (control.type === "range" && Number.isFinite(value)) {
        const raw = value / scale;
        // Imported/node/animated values must not silently round or clamp to a
        // different value in the old range input before the next user edit.
        control.step = "any";
        if (path === "sun.intensity") control.min = "0";
        if (raw < Number(control.min)) control.min = String(raw);
        if (raw > Number(control.max)) control.max = String(raw);
      }
      if (control.type === "checkbox") control.checked = Boolean(value);
      else control.value = typeof value === "number" ? Number((value / scale).toFixed(6)) : value;
      const label = control.closest(".sl-wrap,.s-row,.tog-row,.prefs-field,.rp-sec")?.querySelector(".sl-val");
      if (label && typeof value === "number") {
        const unit = path === "clouds.coverage" ? "%" : ["clouds.altitude", "clouds.thickness"].includes(path) ? " m" : path === "clouds.windSpeed" ? " km/h" : path === "clouds.windDirection" ? "°" : "";
        const display = path === "clouds.coverage" ? value * 100 : value;
        const text = `${Number(display.toFixed(3))}${unit}`;
        if (label.textContent !== text) label.textContent = text;
      }
    }
    this.syncSunControls(state, root);
  }

  observe() {
    if (this.disposed) return;
    this.observer?.disconnect();
    this.observer = new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => { if (node.nodeType === 1) this.bindControls(node); })));
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  bindKeyboard() {
    if (this.disposed || this.keyboardHandler) return;
    this.keyboardOwner = document;
    this.keyboardHandler = (event) => {
      if (this.disposed) return;
      if (event.key === "Escape" && !this.hub.hidden) { event.preventDefault(); return this.closeHub(); }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && ['z', 'y'].includes(event.key.toLowerCase()) && editable(event.target)) return;
      if (mod && event.shiftKey && event.key.toLowerCase() === "h") { event.preventDefault(); return this.openHub(); }
      if (mod && event.key.toLowerCase() === "s") { event.preventDefault(); this.projects.download(); return; }
      if (mod && event.key.toLowerCase() === "o") { event.preventDefault(); this.projects.openPicker().catch((error) => this.toast(error.message, "error")); return; }
      if (mod && event.key.toLowerCase() === "n") { event.preventDefault(); this.projects.newProject(); return; }
      if (mod && event.shiftKey && event.key.toLowerCase() === "z") { event.preventDefault(); this.store.redo(); return; }
      if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); this.store.undo(); return; }
      if (event.code === "Space" && !editable(event.target)) { event.preventDefault(); this.timeline.toggle(); }
    };
    this.keyboardOwner.addEventListener("keydown", this.keyboardHandler);
  }

  refresh(state, change = {}) {
    this.syncControls(state);
    this.status.querySelector("span").textContent = stateSummary(state);
    this.status.dataset.tone = state.engine?.lighting?.status === "error" ? "error" : state.engine?.lighting?.status === "evaluating" ? "busy" : "ready";
    const set = (field, value) => { const element = this.hub.querySelector(`[data-field="${field}"]`); if (element) element.textContent = value; };
    set("project", state.project?.name || "Untitled Sky");
    set("lighting", state.engine?.lighting?.status || "idle");
    set("atmosphere", state.atmosphere?.model || "Physical");
    set("timeline", `${state.timeline?.playing ? "Playing" : "Frame"} ${Math.round(state.timeline?.currentFrame || 1)}`);
    set("nodes", `${state.nodes?.nodes?.length || this.nodeGraph.nodes.size} nodes`);
    set("bridge", state.bridge?.blender?.connected ? "Connected" : state.bridge?.blender?.status || "Offline");
    set("footer", stateSummary(state));
    const orb = this.hub.querySelector("[data-field='bridge-orb']");
    if (orb) orb.dataset.connected = state.bridge?.blender?.connected ? "true" : "false";
    const log = this.hub.querySelector("[data-field='log']");
    if (log && change.type) log.textContent = `[${new Date().toLocaleTimeString()}] ${change.label || change.type}\nSun ${state.sun?.elevation}° / ${state.sun?.azimuth}°\n${state.render?.width}×${state.render?.height} ${state.render?.format} ${state.render?.bitDepth}-bit`;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [control, commit] of this.controlListeners) {
      control.removeEventListener("input", commit);
      control.removeEventListener("change", commit);
    }
    this.controlListeners.clear();
    this.controlBindings.clear();
    this.keyboardOwner?.removeEventListener("keydown", this.keyboardHandler);
    this.keyboardOwner = null;
    this.keyboardHandler = null;
    for (const [documentRef, sync] of this.sunControlDocuments) {
      documentRef.removeEventListener("input", sync);
      documentRef.removeEventListener("change", sync);
    }
    this.sunControlDocuments.clear();
    this.unsubscribe?.(); this.observer?.disconnect(); this.splashObserver?.disconnect(); this.hub?.remove(); this.status?.remove(); this.toasts?.remove();
  }
}
