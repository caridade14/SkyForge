const CONTROL_BINDINGS = {
  "time of day": ["time.timeOfDay", 1], date: ["time.date", 1], latitude: ["location.latitude", 1], longitude: ["location.longitude", 1], location: ["location.name", 1],
  elevation: ["sun.elevation", 1], azimuth: ["sun.azimuth", 1], "sun intensity": ["sun.intensity", 0.1], "color temp (k)": ["sun.temperature", 1],
  turbidity: ["atmosphere.turbidity", 0.1], haze: ["atmosphere.haze", 0.1], "ozone layer": ["atmosphere.ozone", 0.1], "mie scattering": ["atmosphere.mieCoefficient", 0.001],
  coverage: ["clouds.coverage", 0.01], altitude: ["clouds.altitude", 1], thickness: ["clouds.thickness", 1], density: ["clouds.density", 0.01], erosion: ["clouds.erosion", 0.01], detail: ["clouds.detail", 0.01],
  "wind speed": ["clouds.windSpeed", 1], "wind direction": ["clouds.windDirection", 1], precipitation: ["clouds.precipitation", 0.01], exposure: ["camera.exposure", 0.1], saturation: ["color.saturation", 0.01], contrast: ["color.contrast", 0.01]
};

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (match) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[match]));
const normalize = (value) => String(value || "").replace(/\s+/g, " ").replace(/[:：]$/, "").trim().toLowerCase();
const editable = (target) => Boolean(target?.closest?.("input,textarea,select,[contenteditable='true']"));

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
    const hide = () => document.getElementById("sf-startup-ov")?.classList.remove("show");
    hide();
    globalThis.sfCloseStartupSplash = hide;
    globalThis.sfShowStartupSplash = (force) => { hide(); if (force) this.openHub(); };
    const splash = document.getElementById("sf-startup-ov");
    if (splash) new MutationObserver(hide).observe(splash, { attributes: true, attributeFilter: ["class"] });
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
          <section data-panel="pipeline"><div class="sf-core-pipeline"><article><span>01</span><b>Physical Atmosphere</b><small>Rayleigh, Mie, ozone and multiple scattering</small></article><article><span>02</span><b>Procedural Clouds</b><small>Coverage, density, altitude, erosion and wind</small></article><article><span>03</span><b>ACES Color</b><small>Linear HDR working pipeline</small></article><article><span>04</span><b>HDRI Output</b><small>Queue, preview, passes and metadata</small></article></div><div class="sf-core-row"><button data-action="preview">Generate Preview</button><button class="primary" data-action="render">Queue HDRI Render</button></div></section>
          <section data-panel="bridge"><div class="sf-core-bridge"><i data-field="bridge-orb"></i><div><small>BLENDER LOCAL BRIDGE</small><h2 data-field="bridge">Checking…</h2><p>Local port 8765 with queued payload fallback.</p></div></div><div class="sf-core-row"><button data-action="bridge-health">Test Connection</button><button class="primary" data-action="bridge-send">Send World to Blender</button></div><p class="sf-core-help">Install <code>integrations/blender/skyforge_bridge_addon.py</code>, enable it, then press Start Bridge in Blender.</p></section>
        </main>
        <footer><span>CORE11 • Schema 3 • ACEScg</span><span data-field="footer">Ready</span></footer>
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
    this.hub.querySelectorAll("[data-section]").forEach((item) => item.classList.toggle("active", item.dataset.section === section));
    this.hub.querySelectorAll("[data-panel]").forEach((item) => item.classList.toggle("active", item.dataset.panel === section));
  }

  openHub(section = "project") { this.setSection(section); this.hub.hidden = false; document.body.classList.add("sf-core-hub-open"); }
  closeHub() { this.hub.hidden = true; document.body.classList.remove("sf-core-hub-open"); }

  async action(action) {
    try {
      if (action === "close") return this.closeHub();
      if (action === "new") { this.projects.newProject(); return this.toast("New project created", "success"); }
      if (action === "open") { await this.projects.openPicker(); return this.toast("Project opened", "success"); }
      if (action === "save") { this.projects.download(); return this.toast("Project exported", "success"); }
      if (action === "undo") return this.store.undo() ? this.toast("Undo") : this.toast("Nothing to undo", "warning");
      if (action === "redo") return this.store.redo() ? this.toast("Redo") : this.toast("Nothing to redo", "warning");
      if (action === "reset-layout") { document.body.classList.remove("sf-hide-left", "sf-hide-right", "sf-hide-timeline", "sf-hide-status"); return this.toast("Workspace restored", "success"); }
      if (action === "evaluate") { const result = await this.lighting.evaluate(); return this.toast(result ? "Physical sky evaluated" : "Lighting evaluation failed", result ? "success" : "error"); }
      if (action === "timeline") return this.timeline.toggle();
      if (action === "graph") { this.nodeGraph.createDefaultGraph(); this.store.set("nodes", this.nodeGraph.serialize(), { label: "Create default node graph" }); return this.toast("Default node graph created", "success"); }
      if (action === "preview") { await this.render.preview(); return this.toast("Preview generated", "success"); }
      if (action === "render") { await this.render.queue(); return this.toast("HDRI render queued", "success"); }
      if (action === "bridge-health") { const result = await this.blender.health(); return this.toast(result.connected ? "Blender connected" : "Blender is offline", result.connected ? "success" : "warning"); }
      if (action === "bridge-send") { const result = await this.blender.send(); return this.toast(result.forwarded ? "World sent to Blender" : "World queued for Blender", result.forwarded ? "success" : "warning"); }
    } catch (error) { this.toast(error.message || "Operation failed", "error"); }
  }

  bindControls(root) {
    root.querySelectorAll?.("input,select").forEach((control) => {
      if (this.bound.has(control)) return;
      const [path, scale] = CONTROL_BINDINGS[controlLabel(control)] || [];
      if (!path) return;
      this.bound.add(control);
      control.dataset.sfCorePath = path;
      const commit = () => {
        const numeric = Number(control.value);
        const value = control.type === "checkbox" ? control.checked : Number.isFinite(numeric) ? numeric * scale : control.value;
        this.store.set(path, value, { label: `Change ${controlLabel(control)}` });
      };
      control.addEventListener("input", commit);
      control.addEventListener("change", commit);
      const value = this.store.get(path);
      if (value !== undefined) control.type === "checkbox" ? control.checked = Boolean(value) : control.value = typeof value === "number" ? value / scale : value;
    });
  }

  observe() {
    this.observer = new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => { if (node.nodeType === 1) this.bindControls(node); })));
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  bindKeyboard() {
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.hub.hidden) { event.preventDefault(); return this.closeHub(); }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === "h") { event.preventDefault(); return this.openHub(); }
      if (mod && event.key.toLowerCase() === "s") { event.preventDefault(); this.projects.download(); return; }
      if (mod && event.key.toLowerCase() === "o") { event.preventDefault(); this.projects.openPicker().catch((error) => this.toast(error.message, "error")); return; }
      if (mod && event.key.toLowerCase() === "n") { event.preventDefault(); this.projects.newProject(); return; }
      if (mod && event.shiftKey && event.key.toLowerCase() === "z") { event.preventDefault(); this.store.redo(); return; }
      if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); this.store.undo(); return; }
      if (event.code === "Space" && !editable(event.target)) { event.preventDefault(); this.timeline.toggle(); }
    });
  }

  refresh(state, change = {}) {
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

  dispose() { this.unsubscribe?.(); this.observer?.disconnect(); this.hub?.remove(); this.status?.remove(); this.toasts?.remove(); }
}
