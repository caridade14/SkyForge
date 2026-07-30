(function bootstrapSkyForgeGalaxyBuilder(factory) {
  const root = typeof window !== "undefined" ? window : null;
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.SkyForgeGalaxyBuilder = api;
    if (root.document?.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", api.install, { once: true });
    } else {
      api.install();
    }
  }
})(function createSkyForgeGalaxyBuilder(root) {
  "use strict";

  const VERSION = "0.6.0";
  const state = {
    installed: false,
    menu: null,
    panel: null,
    open: false,
    activeTab: "structure",
    observer: null,
    rendererReadyListener: null
  };

  const PRESETS = Object.freeze([
    { id: "milkyWay", name: "Milky Way", type: "Barred spiral", note: "Four dusty arms and a warm central bar" },
    { id: "andromeda", name: "Andromeda", type: "Spiral", note: "Large bright core and inclined disk" },
    { id: "sombrero", name: "Sombrero", type: "Edge-on spiral", note: "Strong dust lane and massive bulge" },
    { id: "whirlpool", name: "Whirlpool", type: "Grand-design spiral", note: "Two luminous blue arms" },
    { id: "starburst", name: "Starburst", type: "Irregular", note: "Nebula-rich, hot young stars" },
    { id: "elliptical", name: "Elliptical", type: "Elliptical", note: "Smooth old stellar population" },
    { id: "ring", name: "Ring Galaxy", type: "Ring", note: "Bright annulus with a sparse center" }
  ]);

  const CONTROL_GROUPS = Object.freeze({
    structure: [
      { path: "type", label: "Galaxy Type", type: "select", options: ["spiral", "barred", "elliptical", "irregular", "ring"] },
      { path: "seed", label: "Seed", type: "number", min: 0, max: 999999, step: 1 },
      { path: "radius", label: "Disk Radius", type: "range", min: 0.2, max: 2.5, step: 0.01 },
      { path: "thickness", label: "Disk Thickness", type: "range", min: 0.03, max: 0.8, step: 0.01 },
      { path: "inclination", label: "Inclination", type: "range", min: -1.45, max: 1.45, step: 0.01 },
      { path: "rotation", label: "Orientation", type: "range", min: -6.283, max: 6.283, step: 0.01 }
    ],
    stars: [
      { path: "starDensity", label: "Star Density", type: "range", min: 0, max: 1.5, step: 0.01 },
      { path: "armCount", label: "Spiral Arms", type: "range", min: 1, max: 8, step: 1 },
      { path: "armTwist", label: "Arm Twist", type: "range", min: 0.2, max: 8, step: 0.01 },
      { path: "coreSize", label: "Core Size", type: "range", min: 0.03, max: 0.8, step: 0.01 },
      { path: "coreIntensity", label: "Core Intensity", type: "range", min: 0, max: 4, step: 0.01 },
      { path: "temperature", label: "Star Temperature", type: "range", min: 1800, max: 18000, step: 50, suffix: " K" }
    ],
    medium: [
      { path: "dust", label: "Dust Lanes", type: "range", min: 0, max: 1.5, step: 0.01 },
      { path: "nebula", label: "Nebula Emission", type: "range", min: 0, max: 1.5, step: 0.01 },
      { path: "blackHole", label: "Black Hole", type: "range", min: 0, max: 1, step: 0.01 },
      { path: "lensing", label: "Lensing Ring", type: "range", min: 0, max: 1, step: 0.01 }
    ],
    dynamics: [
      { path: "animate", label: "Animate Rotation", type: "toggle" },
      { path: "animationSpeed", label: "Rotation Speed", type: "range", min: 0, max: 0.2, step: 0.001 },
      { rootPath: "mode", label: "Composite Mode", type: "select", options: ["atmosphere", "galaxy", "hybrid"] },
      { rootPath: "quality", label: "GPU Quality", type: "select", options: ["realtime", "production", "reference"] },
      { rootPath: "exposure", label: "Exposure", type: "range", min: -8, max: 8, step: 0.1, suffix: " EV" },
      { rootPath: "bloom", label: "Bloom", type: "range", min: 0, max: 2, step: 0.01 },
      { rootPath: "referenceObjects", label: "Reference Objects", type: "toggle" }
    ]
  });

  function renderer() {
    return root?.SkyForgePhase6Renderer || null;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function currentState() {
    const snapshot = renderer()?.getState?.();
    return snapshot?.settings || clone(renderer()?.DEFAULTS || { galaxy: {} });
  }

  function currentGalaxy() {
    return currentState().galaxy || {};
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function titleCase(value) {
    return String(value || "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  function emitUpdate(patch) {
    if (!patch || typeof patch !== "object") return;
    renderer()?.setGalaxy?.(patch);
    if (root?.dispatchEvent && typeof root.CustomEvent === "function") {
      root.dispatchEvent(new root.CustomEvent("skyforge:galaxy-updated", { detail: patch }));
    }
    refreshValues();
  }

  function emitRootUpdate(patch) {
    renderer()?.setSettings?.(patch);
    refreshValues();
  }

  function applyPreset(id) {
    renderer()?.applyPreset?.(id);
    refreshValues();
    toast(`${PRESETS.find((preset) => preset.id === id)?.name || id} galaxy applied`);
  }

  function randomize() {
    const types = ["spiral", "barred", "elliptical", "irregular", "ring"];
    const seed = Math.floor(Math.random() * 999999);
    emitUpdate({
      seed,
      type: types[seed % types.length],
      starDensity: 0.45 + Math.random() * 0.7,
      armCount: 2 + Math.floor(Math.random() * 5),
      armTwist: 1.2 + Math.random() * 5.5,
      radius: 0.7 + Math.random() * 0.8,
      thickness: 0.08 + Math.random() * 0.35,
      coreSize: 0.1 + Math.random() * 0.4,
      coreIntensity: 0.65 + Math.random() * 1.8,
      dust: Math.random() * 1.1,
      nebula: Math.random() * 1.15,
      temperature: 3200 + Math.random() * 9000,
      inclination: -0.85 + Math.random() * 1.7,
      rotation: -Math.PI + Math.random() * Math.PI * 2
    });
    toast("Procedural galaxy randomized");
  }

  function resetGalaxy() {
    const defaults = renderer()?.DEFAULTS?.galaxy;
    if (defaults) emitUpdate(clone(defaults));
    toast("Galaxy reset to default");
  }

  function copyGalaxyJson() {
    const json = JSON.stringify({ schema: "skyforge.galaxy", version: 1, galaxy: currentGalaxy() }, null, 2);
    root?.navigator?.clipboard?.writeText?.(json)
      .then(() => toast("Galaxy JSON copied"))
      .catch(() => {
        const textarea = root.document.createElement("textarea");
        textarea.value = json;
        root.document.body.appendChild(textarea);
        textarea.select();
        root.document.execCommand?.("copy");
        textarea.remove();
        toast("Galaxy JSON copied");
      });
  }

  function toast(message) {
    if (typeof root?.triToast === "function") {
      root.triToast(message);
      return;
    }
    let element = root?.document?.getElementById("sf-galaxy-toast");
    if (!element) {
      element = root.document.createElement("div");
      element.id = "sf-galaxy-toast";
      element.className = "sf-galaxy-toast";
      root.document.body.appendChild(element);
    }
    element.textContent = message;
    element.classList.add("on");
    root.clearTimeout(element.__timer);
    element.__timer = root.setTimeout(() => element.classList.remove("on"), 1800);
  }

  function buildMenu() {
    const documentRef = root?.document;
    const menuHost = documentRef?.querySelector(".mb-menus");
    if (!menuHost) return null;
    let menu = documentRef.getElementById("sf-galaxy-menu");
    if (menu) {
      state.menu = menu;
      return menu;
    }
    menu = documentRef.createElement("div");
    menu.id = "sf-galaxy-menu";
    menu.className = "mb-m sf-galaxy-menu";
    menu.tabIndex = 0;
    menu.innerHTML = `
      <span class="sf-galaxy-menu-label">Galaxy</span>
      <div class="mb-dd sf-galaxy-dropdown">
        <div class="dd-item acc" data-action="open">Galaxy Builder<span class="dd-kbd">Shift G</span></div>
        <div class="dd-sep"></div>
        ${PRESETS.slice(0, 5).map((preset) => `<div class="dd-item" data-preset="${preset.id}">${escapeHtml(preset.name)}<span class="sf-dd-meta">${escapeHtml(preset.type)}</span></div>`).join("")}
        <div class="dd-sep"></div>
        <div class="dd-item" data-action="randomize">Randomize Galaxy</div>
        <div class="dd-item" data-action="toggle">Enable / Disable Galaxy</div>
        <div class="dd-item" data-action="copy">Copy Galaxy JSON</div>
      </div>`;

    const windowMenu = Array.from(menuHost.children).find((child) => /Window/i.test(child.firstChild?.textContent || child.textContent || ""));
    menuHost.insertBefore(menu, windowMenu || null);
    menu.addEventListener("click", (event) => {
      const preset = event.target.closest?.("[data-preset]")?.dataset.preset;
      const action = event.target.closest?.("[data-action]")?.dataset.action;
      if (preset) {
        event.stopPropagation();
        applyPreset(preset);
        menu.classList.remove("open");
        return;
      }
      if (action) {
        event.stopPropagation();
        if (action === "open") open();
        if (action === "randomize") randomize();
        if (action === "toggle") emitUpdate({ enabled: currentGalaxy().enabled === false });
        if (action === "copy") copyGalaxyJson();
        menu.classList.remove("open");
        return;
      }
      event.stopPropagation();
      root.document.querySelectorAll(".mb-m.open").forEach((item) => {
        if (item !== menu) item.classList.remove("open");
      });
      menu.classList.toggle("open");
    });
    state.menu = menu;
    return menu;
  }

  function controlHtml(control) {
    const path = control.rootPath || control.path;
    const rootAttr = control.rootPath ? "1" : "0";
    if (control.type === "select") {
      return `<label class="sf-galaxy-control">
        <span>${escapeHtml(control.label)}</span>
        <select data-galaxy-path="${path}" data-root="${rootAttr}">
          ${control.options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(titleCase(option))}</option>`).join("")}
        </select>
      </label>`;
    }
    if (control.type === "toggle") {
      return `<label class="sf-galaxy-control sf-galaxy-toggle-control">
        <span>${escapeHtml(control.label)}</span>
        <input type="checkbox" data-galaxy-path="${path}" data-root="${rootAttr}">
      </label>`;
    }
    const inputType = control.type === "number" ? "number" : "range";
    return `<label class="sf-galaxy-control">
      <span>${escapeHtml(control.label)}</span>
      <div class="sf-galaxy-control-line">
        <input type="${inputType}" min="${control.min}" max="${control.max}" step="${control.step}" data-galaxy-path="${path}" data-root="${rootAttr}">
        <output data-galaxy-output="${path}" data-root="${rootAttr}" data-suffix="${escapeHtml(control.suffix || "")}">0</output>
      </div>
    </label>`;
  }

  function buildPanel() {
    const documentRef = root?.document;
    const viewport = documentRef?.getElementById("vp");
    if (!documentRef || !viewport) return null;
    let panel = documentRef.getElementById("sf-galaxy-builder");
    if (panel) {
      state.panel = panel;
      return panel;
    }
    panel = documentRef.createElement("aside");
    panel.id = "sf-galaxy-builder";
    panel.className = "sf-galaxy-builder";
    panel.setAttribute("aria-label", "Galaxy Builder");
    panel.innerHTML = `
      <header class="sf-galaxy-header">
        <div>
          <strong>Galaxy Builder</strong>
          <span>PROCEDURAL GPU SYSTEM</span>
        </div>
        <div class="sf-galaxy-header-actions">
          <button type="button" data-action="randomize" title="Randomize">✦</button>
          <button type="button" data-action="close" title="Close">×</button>
        </div>
      </header>
      <div class="sf-galaxy-status">
        <span class="sf-galaxy-live-dot"></span>
        <b data-role="backend">GPU renderer</b>
        <span data-role="fps">0 FPS</span>
      </div>
      <nav class="sf-galaxy-tabs">
        <button data-tab="structure" class="active">Structure</button>
        <button data-tab="stars">Stars</button>
        <button data-tab="medium">Dust & Nebula</button>
        <button data-tab="dynamics">Render</button>
        <button data-tab="presets">Presets</button>
      </nav>
      <div class="sf-galaxy-content">
        ${Object.entries(CONTROL_GROUPS).map(([tab, controls]) => `
          <section data-section="${tab}" class="${tab === "structure" ? "active" : ""}">
            ${controls.map(controlHtml).join("")}
          </section>`).join("")}
        <section data-section="presets">
          <div class="sf-galaxy-preset-grid">
            ${PRESETS.map((preset) => `<button type="button" class="sf-galaxy-preset" data-preset="${preset.id}"><span class="sf-galaxy-preset-thumb ${preset.id}"></span><b>${escapeHtml(preset.name)}</b><small>${escapeHtml(preset.note)}</small></button>`).join("")}
          </div>
        </section>
      </div>
      <footer class="sf-galaxy-footer">
        <button type="button" data-action="reset">Reset</button>
        <button type="button" data-action="copy">Copy JSON</button>
        <button type="button" class="primary" data-action="create">Create Galaxy</button>
      </footer>`;
    viewport.appendChild(panel);
    panel.addEventListener("click", onPanelClick);
    panel.addEventListener("input", onPanelInput);
    panel.addEventListener("change", onPanelInput);
    state.panel = panel;
    refreshValues();
    return panel;
  }

  function onPanelClick(event) {
    const tab = event.target.closest?.("[data-tab]")?.dataset.tab;
    if (tab) {
      state.activeTab = tab;
      state.panel.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
      state.panel.querySelectorAll("[data-section]").forEach((section) => section.classList.toggle("active", section.dataset.section === tab));
      return;
    }
    const preset = event.target.closest?.("[data-preset]")?.dataset.preset;
    if (preset) {
      applyPreset(preset);
      return;
    }
    const action = event.target.closest?.("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "close") close();
    if (action === "randomize") randomize();
    if (action === "reset") resetGalaxy();
    if (action === "copy") copyGalaxyJson();
    if (action === "create") {
      emitUpdate({ enabled: true });
      emitRootUpdate({ mode: currentState().mode === "atmosphere" ? "hybrid" : currentState().mode });
      toast("Galaxy created in the GPU viewport");
    }
  }

  function onPanelInput(event) {
    const input = event.target.closest?.("[data-galaxy-path]");
    if (!input) return;
    const path = input.dataset.galaxyPath;
    const isRoot = input.dataset.root === "1";
    let value;
    if (input.type === "checkbox") value = input.checked;
    else if (input.tagName === "SELECT") value = input.value;
    else value = Number(input.value);
    if (isRoot) emitRootUpdate({ [path]: value });
    else emitUpdate({ [path]: value });
  }

  function formatValue(value, suffix = "") {
    if (typeof value === "boolean") return value ? "ON" : "OFF";
    if (typeof value === "number") {
      const text = Number.isInteger(value) ? String(value) : value.toFixed(Math.abs(value) < 1 ? 3 : 2).replace(/0+$/, "").replace(/\.$/, "");
      return `${text}${suffix}`;
    }
    return titleCase(value);
  }

  function refreshValues() {
    const panel = state.panel;
    if (!panel) return;
    const settings = currentState();
    const galaxy = settings.galaxy || {};
    panel.querySelectorAll("[data-galaxy-path]").forEach((input) => {
      const path = input.dataset.galaxyPath;
      const value = input.dataset.root === "1" ? settings[path] : galaxy[path];
      if (value === undefined) return;
      if (input.type === "checkbox") input.checked = Boolean(value);
      else if (root.document.activeElement !== input) input.value = String(value);
    });
    panel.querySelectorAll("[data-galaxy-output]").forEach((output) => {
      const path = output.dataset.galaxyOutput;
      const value = output.dataset.root === "1" ? settings[path] : galaxy[path];
      output.textContent = formatValue(value, output.dataset.suffix || "");
    });
    const snapshot = renderer()?.getState?.() || {};
    const backend = panel.querySelector('[data-role="backend"]');
    const fps = panel.querySelector('[data-role="fps"]');
    if (backend) backend.textContent = snapshot.backend || "GPU renderer";
    if (fps) fps.textContent = `${Math.round(snapshot.fps || 0)} FPS`;
    panel.classList.toggle("disabled", galaxy.enabled === false);
  }

  function open() {
    buildPanel();
    state.open = true;
    state.panel?.classList.add("open");
    state.menu?.classList.remove("open");
    refreshValues();
    return true;
  }

  function close() {
    state.open = false;
    state.panel?.classList.remove("open");
    return false;
  }

  function toggle() {
    return state.open ? close() : open();
  }

  function keydown(event) {
    if (event.shiftKey && !event.ctrlKey && !event.altKey && String(event.key).toLowerCase() === "g") {
      const target = event.target;
      if (target?.matches?.("input,textarea,select,[contenteditable=true]")) return;
      event.preventDefault();
      toggle();
    }
    if (event.key === "Escape" && state.open) close();
  }

  function install() {
    if (state.installed || !root?.document) return;
    state.installed = true;
    buildMenu();
    buildPanel();
    root.document.addEventListener("keydown", keydown, true);
    root.document.addEventListener("click", (event) => {
      if (!state.menu?.contains(event.target)) state.menu?.classList.remove("open");
    });
    root.addEventListener("skyforge:phase6-settings", refreshValues);
    root.addEventListener("skyforge:phase6-stats", refreshValues);
    root.addEventListener("skyforge:phase6-ready", refreshValues);

    if (typeof root.MutationObserver === "function") {
      state.observer = new root.MutationObserver(() => {
        if (!state.menu?.isConnected) buildMenu();
        if (!state.panel?.isConnected) buildPanel();
      });
      state.observer.observe(root.document.body, { childList: true, subtree: true });
    }
  }

  function destroy() {
    state.observer?.disconnect();
    root?.document?.removeEventListener("keydown", keydown, true);
    state.menu?.remove();
    state.panel?.remove();
    state.installed = false;
  }

  function getState() {
    return {
      installed: state.installed,
      open: state.open,
      activeTab: state.activeTab,
      galaxy: clone(currentGalaxy()),
      renderer: renderer()?.getState?.() || null,
      version: VERSION
    };
  }

  return {
    VERSION,
    PRESETS,
    install,
    destroy,
    open,
    close,
    toggle,
    applyPreset,
    randomize,
    resetGalaxy,
    copyGalaxyJson,
    refreshValues,
    getState
  };
});
