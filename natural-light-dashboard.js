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

  const DASHBOARD_VERSION = "0.1.0";
  const STORAGE_KEY = "skyforge.naturalLightLab.v1";
  const DEFAULTS = Object.freeze({
    groundAlbedo: 0.2,
    aerosolSingleScatteringAlbedo: 0.92,
    multipleScatteringOrders: 4,
    overlayOpacity: 0.72,
    visualizationMode: "sky",
    collapsed: false
  });

  const state = {
    installed: false,
    panel: null,
    pollTimer: null,
    settings: { ...DEFAULTS },
    lastResult: null
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value)));
  }

  function finiteOr(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function formatNumber(value, digits = 2, fallback = "—") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(digits) : fallback;
  }

  function readSettings() {
    try {
      const parsed = JSON.parse(root?.localStorage?.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return { ...DEFAULTS };
      return {
        groundAlbedo: clamp(finiteOr(parsed.groundAlbedo, DEFAULTS.groundAlbedo), 0, 1),
        aerosolSingleScatteringAlbedo: clamp(
          finiteOr(parsed.aerosolSingleScatteringAlbedo, DEFAULTS.aerosolSingleScatteringAlbedo),
          0,
          1
        ),
        multipleScatteringOrders: Math.round(clamp(
          finiteOr(parsed.multipleScatteringOrders, DEFAULTS.multipleScatteringOrders),
          1,
          8
        )),
        overlayOpacity: clamp(finiteOr(parsed.overlayOpacity, DEFAULTS.overlayOpacity), 0, 1),
        visualizationMode: ["sky", "transmittance", "multiple-scattering"].includes(parsed.visualizationMode)
          ? parsed.visualizationMode
          : DEFAULTS.visualizationMode,
        collapsed: Boolean(parsed.collapsed)
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function writeSettings() {
    try {
      root?.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch {
      // Storage is optional.
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
      #sf-natural-light-lab{
        position:absolute;left:12px;bottom:44px;width:292px;z-index:80;
        border:1px solid rgba(133,165,255,.22);border-radius:10px;
        background:linear-gradient(180deg,rgba(17,23,36,.94),rgba(8,12,20,.91));
        box-shadow:0 12px 36px rgba(0,0,0,.38);backdrop-filter:blur(14px);
        color:#dbe5ff;font:10px/1.35 var(--fm,ui-monospace,SFMono-Regular,Consolas,monospace);
        overflow:hidden;user-select:none;
      }
      #sf-natural-light-lab *{box-sizing:border-box}
      #sf-natural-light-lab .sf-nll-head{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.07)}
      #sf-natural-light-lab .sf-nll-title{display:flex;align-items:center;gap:7px;font-weight:700;letter-spacing:.06em;color:#f2f6ff}
      #sf-natural-light-lab .sf-nll-pulse{width:7px;height:7px;border-radius:50%;background:#59e99a;box-shadow:0 0 10px rgba(89,233,154,.8)}
      #sf-natural-light-lab .sf-nll-version{color:#8190ad;font-size:8px;margin-left:3px}
      #sf-natural-light-lab .sf-nll-collapse{width:24px;height:22px;border:0;border-radius:5px;background:rgba(255,255,255,.06);color:#aebbd6;cursor:pointer}
      #sf-natural-light-lab .sf-nll-body{padding:9px 10px 10px}
      #sf-natural-light-lab.sf-collapsed .sf-nll-body{display:none}
      #sf-natural-light-lab .sf-nll-modes{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:9px}
      #sf-natural-light-lab .sf-nll-mode{border:1px solid rgba(255,255,255,.09);border-radius:6px;background:rgba(255,255,255,.035);color:#8f9cb7;padding:5px 4px;font:inherit;cursor:pointer}
      #sf-natural-light-lab .sf-nll-mode.active{color:#dffff0;border-color:rgba(67,214,135,.38);background:rgba(42,137,86,.22)}
      #sf-natural-light-lab .sf-nll-control{display:grid;grid-template-columns:94px 1fr 42px;align-items:center;gap:7px;margin:7px 0}
      #sf-natural-light-lab .sf-nll-control label{color:#9eabc5}
      #sf-natural-light-lab .sf-nll-control input[type=range]{width:100%;accent-color:#59d98e}
      #sf-natural-light-lab .sf-nll-value{text-align:right;color:#e4edff;font-variant-numeric:tabular-nums}
      #sf-natural-light-lab .sf-nll-sep{height:1px;background:rgba(255,255,255,.065);margin:9px 0}
      #sf-natural-light-lab .sf-nll-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}
      #sf-natural-light-lab .sf-nll-metric{padding:6px 7px;border-radius:6px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.055)}
      #sf-natural-light-lab .sf-nll-k{display:block;color:#7886a2;font-size:8px;text-transform:uppercase;letter-spacing:.04em}
      #sf-natural-light-lab .sf-nll-v{display:block;margin-top:2px;color:#f1f5ff;font-size:11px;font-variant-numeric:tabular-nums}
      #sf-natural-light-lab .sf-nll-foot{display:flex;justify-content:space-between;align-items:center;margin-top:8px;color:#6f7e9a;font-size:8px}
      #sf-natural-light-lab .sf-nll-status{color:#72dda3}
      @media (max-width:900px){#sf-natural-light-lab{width:250px;left:7px;bottom:38px}}
    `;
    documentRef.head.appendChild(style);
  }

  function panelMarkup() {
    return `
      <div class="sf-nll-head">
        <div class="sf-nll-title"><span class="sf-nll-pulse"></span>NATURAL LIGHT LAB <span class="sf-nll-version">v${DASHBOARD_VERSION}</span></div>
        <button class="sf-nll-collapse" type="button" aria-label="Collapse Natural Light Lab">−</button>
      </div>
      <div class="sf-nll-body">
        <div class="sf-nll-modes">
          <button class="sf-nll-mode" data-mode="sky" type="button">SKY</button>
          <button class="sf-nll-mode" data-mode="transmittance" type="button">TRANS</button>
          <button class="sf-nll-mode" data-mode="multiple-scattering" type="button">MULTI</button>
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
          <div class="sf-nll-metric"><span class="sf-nll-k">Indirect ratio</span><span class="sf-nll-v" data-metric="ratio">—</span></div>
          <div class="sf-nll-metric"><span class="sf-nll-k">Ground bounce</span><span class="sf-nll-v" data-metric="ground">—</span></div>
          <div class="sf-nll-metric"><span class="sf-nll-k">Last order</span><span class="sf-nll-v" data-metric="residual">—</span></div>
          <div class="sf-nll-metric"><span class="sf-nll-k">Sun elevation</span><span class="sf-nll-v" data-metric="elevation">—</span></div>
        </div>
        <div class="sf-nll-foot"><span data-model>Waiting for solver…</span><span class="sf-nll-status" data-status>CONNECTING</span></div>
      </div>
    `;
  }

  function createPanel(documentRef) {
    const viewport = documentRef.getElementById("vp") || documentRef.body;
    if (!viewport) return null;
    let panel = documentRef.getElementById("sf-natural-light-lab");
    if (!panel) {
      panel = documentRef.createElement("section");
      panel.id = "sf-natural-light-lab";
      panel.setAttribute("aria-label", "SkyForge Natural Light Lab");
      panel.innerHTML = panelMarkup();
      viewport.appendChild(panel);
    }
    state.panel = panel;
    return panel;
  }

  function setText(selector, value) {
    const element = state.panel?.querySelector(selector);
    if (element) element.textContent = value;
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
    setText('[data-value="groundAlbedo"]', formatNumber(state.settings.groundAlbedo, 2));
    setText('[data-value="aerosolSingleScatteringAlbedo"]', formatNumber(state.settings.aerosolSingleScatteringAlbedo, 2));
    setText('[data-value="multipleScatteringOrders"]', String(state.settings.multipleScatteringOrders));
    setText('[data-value="overlayOpacity"]', formatNumber(state.settings.overlayOpacity, 2));
    panel.classList.toggle("sf-collapsed", state.settings.collapsed);
    const collapse = panel.querySelector(".sf-nll-collapse");
    if (collapse) collapse.textContent = state.settings.collapsed ? "+" : "−";
    panel.querySelectorAll(".sf-nll-mode").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === state.settings.visualizationMode);
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

  function updateMetrics(result) {
    if (!result || !state.panel) return;
    state.lastResult = result;
    const evaluation = result.evaluation || {};
    const irradiance = evaluation.irradiance || {};
    const metrics = evaluation.multipleScattering?.metrics || {};
    const solar = evaluation.solarPosition || {};
    const orders = evaluation.multipleScattering?.model?.orders ?? result.input?.multipleScatteringOrders;

    setText('[data-metric="dni"]', `${Math.round(finiteOr(irradiance.directNormalWm2, 0))} W/m²`);
    setText('[data-metric="dhi"]', `${Math.round(finiteOr(irradiance.diffuseHorizontalEstimatedWm2, 0))} W/m²`);
    setText('[data-metric="ratio"]', `${formatNumber(finiteOr(metrics.multipleToSingleRatio, 0) * 100, 1)}%`);
    setText('[data-metric="ground"]', formatNumber(metrics.groundBounceBroadband, 4));
    setText('[data-metric="residual"]', `${formatNumber(finiteOr(metrics.lastOrderFraction, 0) * 100, 2)}%`);
    setText('[data-metric="elevation"]', `${formatNumber(solar.apparentElevationDeg, 1)}°`);
    setText("[data-model]", `Phase 4 · ${orders || "—"} orders`);
    setText("[data-status]", "LIVE");
  }

  function bindControls() {
    const panel = state.panel;
    if (!panel) return;

    panel.querySelector(".sf-nll-collapse")?.addEventListener("click", () => {
      state.settings.collapsed = !state.settings.collapsed;
      syncControls();
      writeSettings();
    });

    panel.querySelectorAll(".sf-nll-mode").forEach((button) => {
      button.addEventListener("click", () => {
        state.settings.visualizationMode = button.dataset.mode || "sky";
        previewApi()?.setVisualizationMode?.(state.settings.visualizationMode);
        syncControls();
        writeSettings();
      });
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
        syncControls();
        writeSettings();
        if (key === "overlayOpacity") {
          previewApi()?.setOverlayOpacity?.(state.settings.overlayOpacity);
        } else {
          applySettings({ refresh: true, delay: 160 });
        }
      });
    }
  }

  function onUpdated(event) {
    updateMetrics(event?.detail);
  }

  function onStatus(event) {
    const status = event?.detail?.status || "UNKNOWN";
    setText("[data-status]", String(status).toUpperCase());
  }

  function pollPreview() {
    const preview = previewApi();
    if (!preview) {
      setText("[data-status]", "WAITING");
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

  function install() {
    if (state.installed || !root?.document) return;
    state.installed = true;
    state.settings = readSettings();
    createStyle(root.document);
    createPanel(root.document);
    syncControls();
    bindControls();
    root.addEventListener("skyforge:natural-light-updated", onUpdated);
    root.addEventListener("skyforge:natural-light-status", onStatus);

    const tryApply = () => {
      if (applySettings({ refresh: true, delay: 20 })) return true;
      return false;
    };
    if (!tryApply()) root.setTimeout(tryApply, 500);
    state.pollTimer = root.setInterval(pollPreview, 1200);
  }

  function destroy() {
    root?.clearInterval(state.pollTimer);
    root?.removeEventListener("skyforge:natural-light-updated", onUpdated);
    root?.removeEventListener("skyforge:natural-light-status", onStatus);
    state.panel?.remove();
    state.installed = false;
  }

  return {
    DASHBOARD_VERSION,
    DEFAULTS,
    formatNumber,
    readSettings,
    install,
    destroy,
    getState: () => ({
      installed: state.installed,
      settings: { ...state.settings },
      lastResult: state.lastResult
    })
  };
});
