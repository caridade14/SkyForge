(function bootstrapSkyForgeNaturalLightDashboard(factory) {
  const root = typeof window !== "undefined" ? window : null;
  const api = factory(root);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.SkyForgeNaturalLightDashboard = api;
    if (root.document?.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", api.install, { once: true });
    } else {
      api.install();
    }
  }
})(function createSkyForgeNaturalLightDashboard(root) {
  "use strict";

  const DASHBOARD_VERSION = "0.2.0";
  const STORAGE_KEY = "skyforge.naturalLightLab.v2";
  const LEGACY_STORAGE_KEY = "skyforge.naturalLightLab.v1";

  const GROUND_PRESETS = Object.freeze({
    asphalt: Object.freeze({ label: "Asphalt", albedo: 0.08 }),
    soil: Object.freeze({ label: "Dry soil", albedo: 0.17 }),
    vegetation: Object.freeze({ label: "Vegetation", albedo: 0.22 }),
    concrete: Object.freeze({ label: "Concrete", albedo: 0.35 }),
    sand: Object.freeze({ label: "Sand", albedo: 0.45 }),
    snow: Object.freeze({ label: "Snow", albedo: 0.82 })
  });

  const QUALITY_PRESETS = Object.freeze({
    realtime: Object.freeze({ label: "Realtime", orders: 2 }),
    production: Object.freeze({ label: "Production", orders: 4 }),
    reference: Object.freeze({ label: "Reference", orders: 8 })
  });

  const DEFAULTS = Object.freeze({
    groundAlbedo: 0.2,
    groundPreset: "custom",
    aerosolSingleScatteringAlbedo: 0.92,
    multipleScatteringOrders: 4,
    qualityPreset: "production",
    overlayOpacity: 0.72,
    visualizationMode: "sky"
  });

  const state = {
    installed: false,
    menu: null,
    panel: null,
    pollTimer: null,
    settings: { ...DEFAULTS },
    lastResult: null,
    onDocumentClick: null,
    onDocumentKeydown: null
  };

  function clamp(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, numeric));
  }

  function finiteOr(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function formatNumber(value, digits = 2, fallback = "—") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(digits) : fallback;
  }

  function getGroundPresetValue(name, fallback = DEFAULTS.groundAlbedo) {
    return GROUND_PRESETS[name]?.albedo ?? fallback;
  }

  function getQualityOrders(name, fallback = DEFAULTS.multipleScatteringOrders) {
    return QUALITY_PRESETS[name]?.orders ?? fallback;
  }

  function inferGroundPreset(albedo) {
    const value = Number(albedo);
    if (!Number.isFinite(value)) return "custom";
    const match = Object.entries(GROUND_PRESETS)
      .find(([, preset]) => Math.abs(preset.albedo - value) < 0.005);
    return match?.[0] || "custom";
  }

  function inferQualityPreset(orders) {
    const value = Math.round(Number(orders));
    const match = Object.entries(QUALITY_PRESETS)
      .find(([, preset]) => preset.orders === value);
    return match?.[0] || "custom";
  }

  function classifyConvergence(lastOrderFraction) {
    const residual = Math.max(0, finiteOr(lastOrderFraction, 0));
    if (residual <= 0.005) {
      return { id: "converged", label: "CONVERGED", tone: "good" };
    }
    if (residual <= 0.02) {
      return { id: "acceptable", label: "ACCEPTABLE", tone: "warn" };
    }
    return { id: "refine", label: "REFINE", tone: "bad" };
  }

  function readStoredObject(key) {
    try {
      const value = root?.localStorage?.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function readSettings() {
    const parsed = readStoredObject(STORAGE_KEY) || readStoredObject(LEGACY_STORAGE_KEY);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULTS };

    const groundAlbedo = clamp(
      finiteOr(parsed.groundAlbedo, DEFAULTS.groundAlbedo),
      0,
      1
    );
    const multipleScatteringOrders = Math.round(clamp(
      finiteOr(parsed.multipleScatteringOrders, DEFAULTS.multipleScatteringOrders),
      1,
      8
    ));

    return {
      groundAlbedo,
      groundPreset: GROUND_PRESETS[parsed.groundPreset]
        ? parsed.groundPreset
        : inferGroundPreset(groundAlbedo),
      aerosolSingleScatteringAlbedo: clamp(
        finiteOr(
          parsed.aerosolSingleScatteringAlbedo,
          DEFAULTS.aerosolSingleScatteringAlbedo
        ),
        0,
        1
      ),
      multipleScatteringOrders,
      qualityPreset: QUALITY_PRESETS[parsed.qualityPreset]
        ? parsed.qualityPreset
        : inferQualityPreset(multipleScatteringOrders),
      overlayOpacity: clamp(
        finiteOr(parsed.overlayOpacity, DEFAULTS.overlayOpacity),
        0,
        1
      ),
      visualizationMode: ["sky", "transmittance", "multiple-scattering"]
        .includes(parsed.visualizationMode)
        ? parsed.visualizationMode
        : DEFAULTS.visualizationMode
    };
  }

  function writeSettings() {
    try {
      root?.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch {
      // Browser storage is optional.
    }
  }

  function previewApi() {
    return root?.SkyForgeNaturalLightPreview || null;
  }

  function createStyle(documentRef) {
    if (documentRef.getElementById("sf-natural-light-lab-style")) return;
    const style = documentRef.createElement("style");
    style.id = "sf-natural-light-lab-style";
    style.textContent = `
      #sf-natural-light-menu{position:relative;gap:5px}
      #sf-natural-light-menu .sf-nll-menu-label{display:inline-flex;align-items:center;gap:5px;pointer-events:none}
      #sf-natural-light-menu .sf-nll-menu-badge{
        padding:1px 4px;border:1px solid rgba(62,207,126,.28);border-radius:2px;
        background:rgba(62,207,126,.08);color:var(--gn,#3ecf7e);
        font:7.5px/1.2 var(--fm,monospace);letter-spacing:.04em
      }
      #sf-natural-light-menu .sf-nll-status-dot{
        width:5px;height:5px;border-radius:50%;background:#f5c842;
        box-shadow:0 0 7px rgba(245,200,66,.58);pointer-events:none
      }
      #sf-natural-light-menu.sf-nll-live .sf-nll-status-dot{background:#3ecf7e;box-shadow:0 0 7px rgba(62,207,126,.62)}
      #sf-natural-light-menu.sf-nll-error .sf-nll-status-dot{background:#ef5555;box-shadow:0 0 7px rgba(239,85,85,.62)}
      #sf-natural-light-menu>.sf-nll-dropdown{
        left:auto;right:0;width:354px;min-width:354px;max-height:calc(100vh - 42px);
        overflow-y:auto;padding:0;gap:0;border-radius:2px;background:var(--bg2,#171718);
        border-color:var(--b2,rgba(255,255,255,.1));user-select:none
      }
      #sf-natural-light-menu .sf-nll-head{
        display:flex;align-items:center;justify-content:space-between;padding:9px 10px;
        border-bottom:1px solid var(--b1,rgba(255,255,255,.06));background:var(--bg3,#1d1d1f)
      }
      #sf-natural-light-menu .sf-nll-title{display:flex;align-items:center;gap:7px;color:var(--t0,#fff);font:600 10px var(--fd,sans-serif);letter-spacing:.08em}
      #sf-natural-light-menu .sf-nll-phase{color:var(--gn,#3ecf7e);font:8px var(--fm,monospace)}
      #sf-natural-light-menu .sf-nll-head-actions{display:flex;align-items:center;gap:4px}
      #sf-natural-light-menu .sf-nll-icon-btn{
        height:22px;min-width:25px;padding:0 6px;border:1px solid var(--b1,rgba(255,255,255,.06));
        border-radius:2px;background:var(--bg4,#242426);color:var(--t2,#aeaeb8);
        font:9px var(--fm,monospace);cursor:pointer
      }
      #sf-natural-light-menu .sf-nll-icon-btn:hover{color:var(--acc,#e8812a);border-color:rgba(232,129,42,.38)}
      #sf-natural-light-menu .sf-nll-body{padding:9px 10px 10px;cursor:default}
      #sf-natural-light-menu .sf-nll-section-label{
        margin:9px 0 5px;color:var(--t3,#6e6e7a);font:700 7.5px var(--fd,sans-serif);
        letter-spacing:.1em;text-transform:uppercase
      }
      #sf-natural-light-menu .sf-nll-section-label:first-child{margin-top:0}
      #sf-natural-light-menu .sf-nll-modes,
      #sf-natural-light-menu .sf-nll-quality{display:grid;grid-template-columns:repeat(3,1fr);gap:3px}
      #sf-natural-light-menu .sf-nll-mode,
      #sf-natural-light-menu .sf-nll-quality-btn{
        height:25px;border:1px solid var(--b1,rgba(255,255,255,.06));border-radius:2px;
        background:var(--bg3,#1d1d1f);color:var(--t3,#6e6e7a);
        font:8.5px var(--fm,monospace);cursor:pointer
      }
      #sf-natural-light-menu .sf-nll-mode:hover,
      #sf-natural-light-menu .sf-nll-quality-btn:hover{color:var(--t1,#e8e8ea);border-color:var(--b2,rgba(255,255,255,.1))}
      #sf-natural-light-menu .sf-nll-mode.active,
      #sf-natural-light-menu .sf-nll-quality-btn.active{
        color:var(--gn,#3ecf7e);border-color:rgba(62,207,126,.34);background:rgba(62,207,126,.1)
      }
      #sf-natural-light-menu .sf-nll-select-row{
        display:grid;grid-template-columns:104px 1fr;gap:7px;align-items:center;margin:6px 0
      }
      #sf-natural-light-menu .sf-nll-select-row label,
      #sf-natural-light-menu .sf-nll-control label{color:var(--t2,#aeaeb8);font-size:9.5px}
      #sf-natural-light-menu .sf-nll-select{
        width:100%;height:25px;border:1px solid var(--b1,rgba(255,255,255,.06));border-radius:2px;
        background:var(--bg4,#242426);color:var(--t1,#e8e8ea);font:9px var(--fm,monospace);padding:0 6px
      }
      #sf-natural-light-menu .sf-nll-control{
        display:grid;grid-template-columns:104px 1fr 38px;align-items:center;gap:7px;margin:7px 0
      }
      #sf-natural-light-menu .sf-nll-control input[type=range]{width:100%;height:2px;accent-color:var(--acc,#e8812a)}
      #sf-natural-light-menu .sf-nll-value{text-align:right;color:var(--t0,#fff);font:9px var(--fm,monospace);font-variant-numeric:tabular-nums}
      #sf-natural-light-menu .sf-nll-sep{height:1px;background:var(--b1,rgba(255,255,255,.06));margin:9px 0}
      #sf-natural-light-menu .sf-nll-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px}
      #sf-natural-light-menu .sf-nll-metric{
        min-width:0;padding:6px;border:1px solid var(--b1,rgba(255,255,255,.06));border-radius:2px;
        background:var(--bg3,#1d1d1f)
      }
      #sf-natural-light-menu .sf-nll-k{display:block;color:var(--t3,#6e6e7a);font:7px var(--fd,sans-serif);letter-spacing:.06em;text-transform:uppercase}
      #sf-natural-light-menu .sf-nll-v{display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t0,#fff);font:9px var(--fm,monospace);font-variant-numeric:tabular-nums}
      #sf-natural-light-menu .sf-nll-convergence{
        display:grid;grid-template-columns:auto 1fr auto;gap:7px;align-items:center;margin-top:8px;
        padding:6px 7px;border:1px solid var(--b1,rgba(255,255,255,.06));border-radius:2px;background:rgba(255,255,255,.02)
      }
      #sf-natural-light-menu .sf-nll-convergence-label{color:var(--t3,#6e6e7a);font:7.5px var(--fd,sans-serif);letter-spacing:.06em;text-transform:uppercase}
      #sf-natural-light-menu .sf-nll-convergence-bar{height:2px;background:var(--bg5,#2c2c2f);overflow:hidden}
      #sf-natural-light-menu .sf-nll-convergence-fill{height:100%;width:0;background:var(--gn,#3ecf7e);transition:width .18s ease,background .18s ease}
      #sf-natural-light-menu .sf-nll-convergence-state{font:8px var(--fm,monospace);color:var(--gn,#3ecf7e)}
      #sf-natural-light-menu .sf-nll-convergence.warn .sf-nll-convergence-fill{background:var(--yw,#f5c842)}
      #sf-natural-light-menu .sf-nll-convergence.warn .sf-nll-convergence-state{color:var(--yw,#f5c842)}
      #sf-natural-light-menu .sf-nll-convergence.bad .sf-nll-convergence-fill{background:var(--rd,#ef5555)}
      #sf-natural-light-menu .sf-nll-convergence.bad .sf-nll-convergence-state{color:var(--rd,#ef5555)}
      #sf-natural-light-menu .sf-nll-foot{
        display:flex;justify-content:space-between;align-items:center;margin-top:8px;color:var(--t3,#6e6e7a);font:8px var(--fm,monospace)
      }
      #sf-natural-light-menu .sf-nll-status{color:var(--gn,#3ecf7e)}
      #sf-natural-light-menu .sf-nll-status.warn{color:var(--yw,#f5c842)}
      #sf-natural-light-menu .sf-nll-status.bad{color:var(--rd,#ef5555)}
      @media (max-width:1100px){#sf-natural-light-menu>.sf-nll-dropdown{right:-90px;width:328px;min-width:328px}}
    `;
    documentRef.head.appendChild(style);
  }

  function groundOptionsMarkup() {
    const presets = Object.entries(GROUND_PRESETS)
      .map(([key, preset]) => `<option value="${key}">${preset.label} · ${preset.albedo.toFixed(2)}</option>`)
      .join("");
    return `<option value="custom">Custom</option>${presets}`;
  }

  function panelMarkup() {
    return `
      <div class="sf-nll-head">
        <div class="sf-nll-title">NATURAL LIGHT LAB <span class="sf-nll-phase">PHASE 4</span></div>
        <div class="sf-nll-head-actions">
          <button class="sf-nll-icon-btn" data-action="refresh" type="button" title="Recalculate physical lighting">↻</button>
          <button class="sf-nll-icon-btn" data-action="reset" type="button" title="Reset Natural Light Lab">RESET</button>
        </div>
      </div>
      <div class="sf-nll-body">
        <div class="sf-nll-section-label">Viewport diagnostic</div>
        <div class="sf-nll-modes">
          <button class="sf-nll-mode" data-mode="sky" type="button">SKY</button>
          <button class="sf-nll-mode" data-mode="transmittance" type="button">TRANS</button>
          <button class="sf-nll-mode" data-mode="multiple-scattering" type="button">MULTI</button>
        </div>

        <div class="sf-nll-section-label">Solver quality</div>
        <div class="sf-nll-quality">
          <button class="sf-nll-quality-btn" data-quality="realtime" type="button">REALTIME · 2</button>
          <button class="sf-nll-quality-btn" data-quality="production" type="button">PRODUCTION · 4</button>
          <button class="sf-nll-quality-btn" data-quality="reference" type="button">REFERENCE · 8</button>
        </div>

        <div class="sf-nll-section-label">Surface and atmosphere</div>
        <div class="sf-nll-select-row">
          <label for="sf-nll-ground-preset">Ground material</label>
          <select class="sf-nll-select" id="sf-nll-ground-preset">${groundOptionsMarkup()}</select>
        </div>
        <div class="sf-nll-control">
          <label for="sf-nll-albedo">Ground albedo</label>
          <input id="sf-nll-albedo" type="range" min="0" max="1" step="0.01">
          <span class="sf-nll-value" data-value="groundAlbedo"></span>
        </div>
        <div class="sf-nll-control">
          <label for="sf-nll-ssa">Aerosol SSA</label>
          <input id="sf-nll-ssa" type="range" min="0" max="1" step="0.01">
          <span class="sf-nll-value" data-value="aerosolSingleScatteringAlbedo"></span>
        </div>
        <div class="sf-nll-control">
          <label for="sf-nll-orders">MS orders</label>
          <input id="sf-nll-orders" type="range" min="1" max="8" step="1">
          <span class="sf-nll-value" data-value="multipleScatteringOrders"></span>
        </div>
        <div class="sf-nll-control">
          <label for="sf-nll-opacity">Sky opacity</label>
          <input id="sf-nll-opacity" type="range" min="0" max="1" step="0.01">
          <span class="sf-nll-value" data-value="overlayOpacity"></span>
        </div>

        <div class="sf-nll-sep"></div>
        <div class="sf-nll-grid">
          <div class="sf-nll-metric"><span class="sf-nll-k">DNI</span><span class="sf-nll-v" data-metric="dni">—</span></div>
          <div class="sf-nll-metric"><span class="sf-nll-k">Diffuse</span><span class="sf-nll-v" data-metric="dhi">—</span></div>
          <div class="sf-nll-metric"><span class="sf-nll-k">Global</span><span class="sf-nll-v" data-metric="ghi">—</span></div>
          <div class="sf-nll-metric"><span class="sf-nll-k">Indirect</span><span class="sf-nll-v" data-metric="ratio">—</span></div>
          <div class="sf-nll-metric"><span class="sf-nll-k">Ground</span><span class="sf-nll-v" data-metric="ground">—</span></div>
          <div class="sf-nll-metric"><span class="sf-nll-k">Sun elev.</span><span class="sf-nll-v" data-metric="elevation">—</span></div>
        </div>
        <div class="sf-nll-convergence">
          <span class="sf-nll-convergence-label">Convergence</span>
          <span class="sf-nll-convergence-bar"><span class="sf-nll-convergence-fill"></span></span>
          <span class="sf-nll-convergence-state">WAITING</span>
        </div>
        <div class="sf-nll-foot"><span data-model>Waiting for solver…</span><span class="sf-nll-status" data-status>CONNECTING</span></div>
      </div>
    `;
  }

  function helpMenuElement(host) {
    return Array.from(host?.children || []).find((element) => {
      const directText = String(element.firstChild?.textContent || "").trim();
      return directText === "Help";
    }) || null;
  }

  function setMenuOpen(open) {
    const menu = state.menu;
    if (!menu) return false;
    if (open) {
      menu.ownerDocument.querySelectorAll(".mb-m.open").forEach((element) => {
        if (element !== menu) element.classList.remove("open");
      });
    }
    menu.classList.toggle("open", Boolean(open));
    menu.setAttribute("aria-expanded", String(Boolean(open)));
    return menu.classList.contains("open");
  }

  function toggleMenuOpen() {
    return setMenuOpen(!state.menu?.classList.contains("open"));
  }

  function createMenu(documentRef) {
    const host = documentRef.getElementById("mb-menus") || documentRef.querySelector(".mb-menus");
    if (!host) return null;

    documentRef.getElementById("sf-natural-light-lab")?.remove();

    let menu = documentRef.getElementById("sf-natural-light-menu");
    if (!menu) {
      menu = documentRef.createElement("div");
      menu.id = "sf-natural-light-menu";
      menu.className = "mb-m sf-natural-light-menu";
      menu.tabIndex = 0;
      menu.setAttribute("role", "button");
      menu.setAttribute("aria-haspopup", "true");
      menu.setAttribute("aria-expanded", "false");
      menu.innerHTML = `
        <span class="sf-nll-menu-label">Natural Light <span class="sf-nll-menu-badge">P4</span></span>
        <span class="sf-nll-status-dot" aria-hidden="true"></span>
        <div class="mb-dd sf-nll-dropdown" role="dialog" aria-label="Natural Light Lab">${panelMarkup()}</div>
      `;
      const helpMenu = helpMenuElement(host);
      host.insertBefore(menu, helpMenu);
    }

    state.menu = menu;
    state.panel = menu.querySelector(".sf-nll-dropdown");

    menu.addEventListener("click", (event) => {
      if (event.target.closest(".sf-nll-dropdown")) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toggleMenuOpen();
    });

    menu.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleMenuOpen();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
      }
    });

    return menu;
  }

  function setText(selector, value) {
    const element = state.panel?.querySelector(selector);
    if (element) element.textContent = value;
  }

  function setMenuTone(tone) {
    const menu = state.menu;
    if (!menu) return;
    menu.classList.toggle("sf-nll-live", tone === "live");
    menu.classList.toggle("sf-nll-error", tone === "error");
  }

  function syncControls() {
    const panel = state.panel;
    if (!panel) return;

    const assignments = [
      ["#sf-nll-albedo", state.settings.groundAlbedo],
      ["#sf-nll-ssa", state.settings.aerosolSingleScatteringAlbedo],
      ["#sf-nll-orders", state.settings.multipleScatteringOrders],
      ["#sf-nll-opacity", state.settings.overlayOpacity]
    ];
    for (const [selector, value] of assignments) {
      const input = panel.querySelector(selector);
      if (input) input.value = String(value);
    }

    const groundPreset = panel.querySelector("#sf-nll-ground-preset");
    if (groundPreset) groundPreset.value = state.settings.groundPreset;

    setText('[data-value="groundAlbedo"]', formatNumber(state.settings.groundAlbedo, 2));
    setText(
      '[data-value="aerosolSingleScatteringAlbedo"]',
      formatNumber(state.settings.aerosolSingleScatteringAlbedo, 2)
    );
    setText('[data-value="multipleScatteringOrders"]', String(state.settings.multipleScatteringOrders));
    setText('[data-value="overlayOpacity"]', formatNumber(state.settings.overlayOpacity, 2));

    panel.querySelectorAll(".sf-nll-mode").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === state.settings.visualizationMode);
    });
    panel.querySelectorAll(".sf-nll-quality-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.quality === state.settings.qualityPreset);
    });
  }

  function applySettings(options = {}) {
    const preview = previewApi();
    if (!preview) return false;
    preview.setOverrides?.({
      groundAlbedo: state.settings.groundAlbedo,
      aerosolSingleScatteringAlbedo: state.settings.aerosolSingleScatteringAlbedo,
      multipleScatteringOrders: state.settings.multipleScatteringOrders
    }, { refresh: options.refresh !== false, delay: options.delay ?? 80 });
    preview.setOverlayOpacity?.(state.settings.overlayOpacity);
    preview.setVisualizationMode?.(state.settings.visualizationMode);
    return true;
  }

  function updateConvergence(lastOrderFraction) {
    const panel = state.panel;
    const container = panel?.querySelector(".sf-nll-convergence");
    const fill = panel?.querySelector(".sf-nll-convergence-fill");
    if (!container || !fill) return;

    const residual = Math.max(0, finiteOr(lastOrderFraction, 0));
    const classification = classifyConvergence(residual);
    const score = clamp(1 - residual / 0.05, 0, 1);
    fill.style.width = `${Math.round(score * 100)}%`;
    container.classList.toggle("warn", classification.tone === "warn");
    container.classList.toggle("bad", classification.tone === "bad");
    setText(".sf-nll-convergence-state", `${classification.label} · ${formatNumber(residual * 100, 2)}%`);
  }

  function updateMetrics(result) {
    if (!result || !state.panel) return;
    state.lastResult = result;
    const evaluation = result.evaluation || {};
    const irradiance = evaluation.irradiance || {};
    const metrics = evaluation.multipleScattering?.metrics || {};
    const solar = evaluation.solarPosition || {};
    const orders = evaluation.multipleScattering?.model?.orders
      ?? result.input?.multipleScatteringOrders;

    setText('[data-metric="dni"]', `${Math.round(finiteOr(irradiance.directNormalWm2, 0))} W/m²`);
    setText('[data-metric="dhi"]', `${Math.round(finiteOr(irradiance.diffuseHorizontalEstimatedWm2, 0))} W/m²`);
    setText('[data-metric="ghi"]', `${Math.round(finiteOr(irradiance.globalHorizontalEstimatedWm2, 0))} W/m²`);
    setText('[data-metric="ratio"]', `${formatNumber(finiteOr(metrics.multipleToSingleRatio, 0) * 100, 1)}%`);
    setText('[data-metric="ground"]', formatNumber(metrics.groundBounceBroadband, 4));
    setText('[data-metric="elevation"]', `${formatNumber(solar.apparentElevationDeg, 1)}°`);
    setText("[data-model]", `Phase 4 · ${orders || "—"} orders`);
    setText("[data-status]", "LIVE");
    state.panel.querySelector("[data-status]")?.classList.remove("warn", "bad");
    setMenuTone("live");
    updateConvergence(metrics.lastOrderFraction);
  }

  function setLoadingStatus() {
    setText("[data-status]", "SOLVING");
    const status = state.panel?.querySelector("[data-status]");
    status?.classList.add("warn");
    status?.classList.remove("bad");
    setMenuTone("loading");
  }

  function setErrorStatus(message) {
    setText("[data-status]", "OFFLINE");
    setText("[data-model]", message || "Natural Light API unavailable");
    const status = state.panel?.querySelector("[data-status]");
    status?.classList.add("bad");
    status?.classList.remove("warn");
    setMenuTone("error");
  }

  function resetSettings() {
    state.settings = { ...DEFAULTS };
    syncControls();
    writeSettings();
    setLoadingStatus();
    applySettings({ refresh: true, delay: 0 });
  }

  function bindControls() {
    const panel = state.panel;
    if (!panel) return;

    panel.querySelector('[data-action="refresh"]')?.addEventListener("click", () => {
      setLoadingStatus();
      previewApi()?.refresh?.();
    });

    panel.querySelector('[data-action="reset"]')?.addEventListener("click", () => {
      resetSettings();
    });

    panel.querySelectorAll(".sf-nll-mode").forEach((button) => {
      button.addEventListener("click", () => {
        state.settings.visualizationMode = button.dataset.mode || "sky";
        previewApi()?.setVisualizationMode?.(state.settings.visualizationMode);
        syncControls();
        writeSettings();
      });
    });

    panel.querySelectorAll(".sf-nll-quality-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const quality = button.dataset.quality;
        state.settings.qualityPreset = QUALITY_PRESETS[quality] ? quality : "custom";
        state.settings.multipleScatteringOrders = getQualityOrders(
          quality,
          state.settings.multipleScatteringOrders
        );
        syncControls();
        writeSettings();
        setLoadingStatus();
        applySettings({ refresh: true, delay: 30 });
      });
    });

    panel.querySelector("#sf-nll-ground-preset")?.addEventListener("change", (event) => {
      const preset = event.target.value;
      state.settings.groundPreset = GROUND_PRESETS[preset] ? preset : "custom";
      if (state.settings.groundPreset !== "custom") {
        state.settings.groundAlbedo = getGroundPresetValue(
          state.settings.groundPreset,
          state.settings.groundAlbedo
        );
      }
      syncControls();
      writeSettings();
      setLoadingStatus();
      applySettings({ refresh: true, delay: 40 });
    });

    const bindings = [
      ["#sf-nll-albedo", "groundAlbedo", 0, 1, false],
      ["#sf-nll-ssa", "aerosolSingleScatteringAlbedo", 0, 1, false],
      ["#sf-nll-orders", "multipleScatteringOrders", 1, 8, true],
      ["#sf-nll-opacity", "overlayOpacity", 0, 1, false]
    ];

    for (const [selector, key, min, max, integer] of bindings) {
      const input = panel.querySelector(selector);
      input?.addEventListener("input", () => {
        const value = clamp(finiteOr(input.value, state.settings[key]), min, max);
        state.settings[key] = integer ? Math.round(value) : value;
        if (key === "groundAlbedo") {
          state.settings.groundPreset = inferGroundPreset(state.settings.groundAlbedo);
        }
        if (key === "multipleScatteringOrders") {
          state.settings.qualityPreset = inferQualityPreset(state.settings.multipleScatteringOrders);
        }
        syncControls();
        writeSettings();
        if (key === "overlayOpacity") {
          previewApi()?.setOverlayOpacity?.(state.settings.overlayOpacity);
        } else {
          setLoadingStatus();
          applySettings({ refresh: true, delay: 160 });
        }
      });
    }
  }

  function onUpdated(event) {
    updateMetrics(event?.detail);
  }

  function onStatus(event) {
    const detail = event?.detail || {};
    const status = String(detail.status || "unknown").toLowerCase();
    if (status === "loading" || status === "enabled" || status === "installed") {
      setLoadingStatus();
      return;
    }
    if (status === "error") {
      setErrorStatus(detail.error);
      return;
    }
    if (status === "disabled") {
      setText("[data-status]", "DISABLED");
      setMenuTone("loading");
    }
  }

  function pollPreview() {
    const preview = previewApi();
    if (!preview) {
      setText("[data-status]", "WAITING");
      setMenuTone("loading");
      return;
    }
    const snapshot = preview.getState?.();
    if (snapshot?.evaluation) {
      updateMetrics({
        evaluation: snapshot.evaluation,
        input: snapshot.input,
        skyViewLut: snapshot.skyViewLut,
        transmittanceLut: snapshot.transmittanceLut,
        multipleScatteringLut: snapshot.multipleScatteringLut
      });
    }
  }

  function bindGlobalInteractions(documentRef) {
    state.onDocumentClick = (event) => {
      if (!state.menu?.contains(event.target)) setMenuOpen(false);
    };

    state.onDocumentKeydown = (event) => {
      const target = event.target;
      const editing = target?.matches?.("input,select,textarea,[contenteditable=true]");
      if (!editing && event.shiftKey && String(event.key).toLowerCase() === "l") {
        event.preventDefault();
        toggleMenuOpen();
        if (state.menu?.classList.contains("open")) {
          state.menu.focus({ preventScroll: true });
        }
      }
      if (event.key === "Escape") setMenuOpen(false);
    };

    documentRef.addEventListener("click", state.onDocumentClick);
    documentRef.addEventListener("keydown", state.onDocumentKeydown);
  }

  function install() {
    if (state.installed || !root?.document) return;
    state.installed = true;
    state.settings = readSettings();
    createStyle(root.document);
    createMenu(root.document);
    syncControls();
    bindControls();
    bindGlobalInteractions(root.document);
    root.addEventListener("skyforge:natural-light-updated", onUpdated);
    root.addEventListener("skyforge:natural-light-status", onStatus);

    const tryApply = () => applySettings({ refresh: true, delay: 20 });
    if (!tryApply()) root.setTimeout(tryApply, 500);
    state.pollTimer = root.setInterval(pollPreview, 1200);
  }

  function destroy() {
    root?.clearInterval(state.pollTimer);
    root?.removeEventListener("skyforge:natural-light-updated", onUpdated);
    root?.removeEventListener("skyforge:natural-light-status", onStatus);
    if (state.onDocumentClick) {
      root?.document?.removeEventListener("click", state.onDocumentClick);
    }
    if (state.onDocumentKeydown) {
      root?.document?.removeEventListener("keydown", state.onDocumentKeydown);
    }
    state.menu?.remove();
    state.installed = false;
  }

  return {
    DASHBOARD_VERSION,
    DEFAULTS,
    GROUND_PRESETS,
    QUALITY_PRESETS,
    formatNumber,
    getGroundPresetValue,
    getQualityOrders,
    inferGroundPreset,
    inferQualityPreset,
    classifyConvergence,
    readSettings,
    install,
    destroy,
    open: () => setMenuOpen(true),
    close: () => setMenuOpen(false),
    toggle: toggleMenuOpen,
    getState: () => ({
      installed: state.installed,
      open: Boolean(state.menu?.classList.contains("open")),
      settings: { ...state.settings },
      lastResult: state.lastResult
    })
  };
});
