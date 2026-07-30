(function bootstrapSkyForgeFunctionalController(factory) {
  const root = typeof window !== "undefined" ? window : null;
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.SkyForgeFunctionalScene = api;
    if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", api.install, { once: true });
    else api.install();
  }
})(function createSkyForgeFunctionalController(root) {
  "use strict";

  const VERSION = "0.7.0";
  const state = {
    installed: false,
    wrappersInstalled: false,
    colorHooksInstalled: false,
    auroraHooksInstalled: false,
    weatherTimer: null,
    selectedCityKey: "",
    lastWeather: null,
    color: {
      exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0,
      hueShift: 0, lift: 0, gamma: 1, gain: 1, highlightRolloff: 0.65,
      gamutCompression: 0.35, look: "Neutral ACES", enabled: true
    }
  };

  function renderer() { return root?.SkyForgePhase7Renderer || root?.SkyForgePhase6Renderer || null; }
  function clamp(value, min, max) { const n = Number(value); return Math.min(max, Math.max(min, Number.isFinite(n) ? n : 0)); }
  function finiteOr(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function toast(message) { if (typeof root?.triToast === "function") root.triToast(message); }
  function emit(name, detail) { if (root?.dispatchEvent && typeof root.CustomEvent === "function") root.dispatchEvent(new root.CustomEvent(name, { detail })); }
  function wrap(name, after) {
    const original = root?.[name];
    if (typeof original !== "function" || original.__sfPhase7FunctionalWrapped) return false;
    function wrapped(...args) {
      const result = original.apply(this, args);
      if (result && typeof result.then === "function") return result.then((value) => { try { after(args, value); } catch (error) { console.warn(name, error); } return value; });
      try { after(args, result); } catch (error) { console.warn(name, error); }
      return result;
    }
    wrapped.__sfPhase7FunctionalWrapped = true; wrapped.__sfPhase7Original = original; root[name] = wrapped; return true;
  }

  function installRequestRouting() {
    const original = root.sfRequest;
    if (typeof original !== "function" || original.__sfPhase7RequestWrapped) return;
    function routed(path, options) {
      const text = String(path || "");
      if (text.startsWith("/weather?")) return original.call(this, text.replace("/weather?", "/api/phase7/weather?"), options);
      if (text.startsWith("/geo/search?")) return original.call(this, text.replace("/geo/search?", "/api/phase7/geo/search?"), options);
      return original.call(this, path, options);
    }
    routed.__sfPhase7RequestWrapped = true; routed.__sfPhase7Original = original; root.sfRequest = routed;
  }

  function precipitationType(data) {
    if (data.precipitationType) return data.precipitationType;
    const code = Number(data.weatherCode) || 0;
    if (finiteOr(data.snowfall, 0) > 0 || (code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if (finiteOr(data.precipitation, 0) > 0 || code >= 51) return "rain";
    return "none";
  }
  function weatherToRenderer(data) {
    if (data?.renderState) return data.renderState;
    const cover = clamp(finiteOr(data.cloudCover, 0) / 100, 0, 1);
    const humidity = clamp(finiteOr(data.humidity, 50) / 100, 0, 1);
    const visibility = Math.max(50, finiteOr(data.visibility, 50000));
    const visibilityFactor = clamp(Math.log10(visibility / 50) / 3, 0, 1);
    return {
      enabled: true,
      live: String(data.source || "").includes("live"),
      label: data.weather || "Live weather",
      isDay: data.isDay !== false,
      weatherCode: Number(data.weatherCode) || 0,
      cloudCoverage: cover,
      cloudDensity: clamp(0.18 + cover * 0.9 + humidity * 0.2, 0.08, 1.35),
      cloudLow: clamp(finiteOr(data.cloudLow, cover * 50) / 100, 0, 1),
      cloudMid: clamp(finiteOr(data.cloudMid, cover * 32) / 100, 0, 1),
      cloudHigh: clamp(finiteOr(data.cloudHigh, cover * 18) / 100, 0, 1),
      humidity,
      visibilityFactor,
      fogDensity: clamp((1 - visibilityFactor) * 1.25 + humidity * 0.12, 0, 1.4),
      precipitation: clamp(finiteOr(data.precipitation, 0) / 4, 0, 1),
      precipitationType: precipitationType(data),
      storm: Number(data.weatherCode) >= 95 ? 1 : 0,
      windSpeed: clamp(finiteOr(data.windSpeed, 0) / 80, 0, 1.5),
      windDirection: finiteOr(data.windDirection, 270) * Math.PI / 180,
      temperature: finiteOr(data.temperature, 15),
      latitude: finiteOr(data.latitude, 0), longitude: finiteOr(data.longitude, 0),
      localTime: data.localTime || null, timezone: data.timezone || "UTC",
      sunrise: data.sunrise || null, sunset: data.sunset || null, fetchedAt: data.fetchedAt || new Date().toISOString()
    };
  }
  function moonState(dateLike, latitude, longitude) {
    const date = new Date(dateLike || Date.now()); const valid = Number.isNaN(date.getTime()) ? new Date() : date;
    const jd = valid.getTime() / 86400000 + 2440587.5, synodic = 29.53058867, age = ((jd - 2451550.1) % synodic + synodic) % synodic, phase = age / synodic;
    const hours = valid.getUTCHours() + valid.getUTCMinutes() / 60 + finiteOr(longitude, 0) / 15;
    return {
      enabled: true, phase, illumination: 0.5 - 0.5 * Math.cos(phase * Math.PI * 2),
      azimuth: ((hours / 24) * Math.PI * 2 + phase * Math.PI * 2 + Math.PI) % (Math.PI * 2),
      elevation: clamp(Math.sin((hours / 24 + phase) * Math.PI * 2) * (0.72 - Math.abs(finiteOr(latitude, 0)) / 180), -1.2, 1.2),
      size: clamp(finiteOr(root.sfNumericText?.("v-moon-size", 64), 64) / 64, 0.4, 2.2)
    };
  }
  function applyLiveWeather(data, cityName) {
    if (!data) return;
    state.lastWeather = data;
    const weather = weatherToRenderer(data);
    const moon = moonState(data.localTime, data.latitude, data.longitude);
    renderer()?.setSettings?.({ mode: renderer()?.getState?.()?.settings?.galaxy?.enabled ? "hybrid" : "atmosphere", weather, moon });
    updateLivePanel(data, cityName); emit("skyforge:functional-weather", { data, weather, moon });
  }

  function installWeatherHooks() {
    installRequestRouting();
    wrap("sfApplyLocationTelemetry", (args) => applyLiveWeather(args[0], args[1]));
    wrap("sfSyncCityTelemetry", (args, result) => { if (result) applyLiveWeather(result, root.TRI_CITIES?.[args[0]]?.name || ""); });
    wrap("sfSelectCityKey", (args) => { state.selectedCityKey = String(args[0] || ""); });
    wrap("sfSelectCityRecord", (args) => { state.selectedCityKey = String(args[0]?.key || ""); });
    state.weatherTimer = root.setInterval(() => {
      const key = typeof root.sfLocationSelectedKey === "function" ? root.sfLocationSelectedKey() : state.selectedCityKey;
      if (key && typeof root.sfSyncCityTelemetry === "function") root.sfSyncCityTelemetry(key, { syncClock: true });
    }, 10 * 60 * 1000);
  }

  function selectedAuroraEnabled() {
    const fxToggle = Array.from(root.document.querySelectorAll("#sec-fx .tog-row")).find((row) => /aurora borealis/i.test(row.textContent || ""))?.querySelector(".tog");
    const object = typeof root.sfFindObjectByName === "function" ? root.sfFindObjectByName("Aurora Curtain") : null;
    const eye = object?.querySelector?.(".tri-eye");
    return Boolean(fxToggle?.classList.contains("on") || (object && (!eye || eye.classList.contains("on"))));
  }
  function readAurora() {
    const cfg = typeof root.sfReadAuroraControls === "function" ? root.sfReadAuroraControls() : {};
    return { enabled: selectedAuroraEnabled() || Boolean(cfg.enabled), ...cfg };
  }
  function syncAurora(forceEnabled) {
    const config = readAurora(); if (forceEnabled !== undefined) config.enabled = Boolean(forceEnabled);
    renderer()?.setAurora?.(config); updateAuroraCompositeLabel(config.enabled); emit("skyforge:functional-aurora", config); return config;
  }
  function installAuroraHooks() {
    wrap("sfAuroraControlChanged", () => syncAurora());
    wrap("sfApplyAuroraMenu", () => syncAurora(true));
    wrap("sfApplyAuroraPreset", () => syncAurora(true));
    const row = Array.from(root.document.querySelectorAll("#sec-fx .tog-row")).find((entry) => /aurora borealis/i.test(entry.textContent || ""));
    if (row && row.dataset.phase7Aurora !== "1") { row.dataset.phase7Aurora = "1"; row.addEventListener("click", () => root.setTimeout(() => syncAurora(), 0)); }
    root.document.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-weather-preset],#wx-strip .wx-btn");
      const title = String(button?.dataset?.weatherPreset || button?.title || "").toLowerCase();
      if (!button || !title.includes("aurora")) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const fxToggle = row?.querySelector(".tog"); if (fxToggle && !fxToggle.classList.contains("on")) root.togClick?.(fxToggle);
      syncAurora(true); toast("Aurora added as a non-destructive sky layer");
    }, true);
    state.auroraHooksInstalled = true;
  }

  function lookAdjustments(name) {
    const key = String(name || "").toLowerCase();
    if (key.includes("kodak")) return { contrast: 1.16, saturation: 1.08, temperature: 0.14, tint: 0.02, highlightRolloff: 0.92 };
    if (key.includes("fuji")) return { contrast: 1.1, saturation: 1.14, temperature: -0.04, tint: 0.08, highlightRolloff: 0.82 };
    if (key.includes("agx")) return { contrast: 1.04, saturation: 0.96, temperature: 0, tint: 0, highlightRolloff: 1.18 };
    if (key.includes("arri")) return { contrast: 1.07, saturation: 1.03, temperature: 0.04, tint: -0.02, highlightRolloff: 1.04 };
    return { contrast: 1, saturation: 1, temperature: 0, tint: 0, highlightRolloff: 0.72 };
  }
  function collectSpaceColor() {
    const host = typeof root.sfSpaceColorCurrent === "function" ? root.sfSpaceColorCurrent() : {};
    const look = host.look || state.color.look || "Neutral ACES"; const preset = lookAdjustments(look);
    const contrastValue = finiteOr(host.contrast, 0.22), saturationValue = finiteOr(host.saturation, 0.68), rolloffValue = finiteOr(host.highlightRolloff, 0.74);
    return {
      ...state.color,
      enabled: host.enabled !== false,
      contrast: clamp(preset.contrast * (0.72 + contrastValue * 1.35), 0.35, 2.5),
      saturation: clamp(preset.saturation * (0.5 + saturationValue * 0.92), 0, 2.5),
      temperature: clamp(state.color.temperature + preset.temperature, -1, 1),
      tint: clamp(state.color.tint + preset.tint, -1, 1),
      highlightRolloff: clamp((rolloffValue * 1.25 + preset.highlightRolloff * 0.35), 0, 2),
      look
    };
  }
  function syncColorGrade() {
    const grade = collectSpaceColor(); renderer()?.setColorGrade?.(grade); updateColorReadouts(grade); drawWheelHandles(); emit("skyforge:functional-color-grade", grade); return grade;
  }
  function wheelPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect(); const x = clamp((event.clientX - rect.left) / Math.max(rect.width, 1) * 2 - 1, -1, 1); const y = clamp(1 - (event.clientY - rect.top) / Math.max(rect.height, 1) * 2, -1, 1); return { x, y, radius: Math.min(1, Math.hypot(x, y)), angle: Math.atan2(y, x) };
  }
  function updateWheel(kind, point) {
    if (kind === "main") { state.color.hueShift = point.angle; state.color.saturation = clamp(0.25 + point.radius * 1.75, 0, 2.5); }
    if (kind === "balance") { state.color.tint = point.x; state.color.temperature = point.y; }
    if (kind === "gamut") { state.color.contrast = clamp(1 + point.x * 0.75, 0.35, 2.5); state.color.gamutCompression = clamp((point.y + 1) * 0.75, 0, 1.5); }
    syncColorGrade();
  }
  function bindWheel(id, kind) {
    const canvas = root.document.getElementById(id); if (!canvas || canvas.dataset.phase7Interactive === "1") return;
    canvas.dataset.phase7Interactive = "1"; canvas.style.cursor = "crosshair"; let active = false;
    const move = (event) => { if (!active) return; event.preventDefault(); updateWheel(kind, wheelPoint(canvas, event)); };
    canvas.addEventListener("pointerdown", (event) => { active = true; canvas.setPointerCapture?.(event.pointerId); updateWheel(kind, wheelPoint(canvas, event)); });
    canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", () => { active = false; }); canvas.addEventListener("pointercancel", () => { active = false; });
  }
  function drawHandle(canvas, x, y) {
    if (!canvas?.getContext) return; const context = canvas.getContext("2d"), px = (x * 0.5 + 0.5) * canvas.width, py = (0.5 - y * 0.5) * canvas.height;
    context.save(); context.beginPath(); context.arc(px, py, 7, 0, Math.PI * 2); context.fillStyle = "rgba(8,10,15,.82)"; context.fill(); context.lineWidth = 2; context.strokeStyle = "#ffffff"; context.stroke(); context.beginPath(); context.arc(px, py, 2.2, 0, Math.PI * 2); context.fillStyle = "#ff9f43"; context.fill(); context.restore();
  }
  function drawWheelHandles() {
    const main = root.document.getElementById("sf-sc-wheel-main"), balance = root.document.getElementById("sf-sc-wheel-balance"), gamut = root.document.getElementById("sf-sc-wheel-gamut");
    drawHandle(main, Math.cos(state.color.hueShift) * clamp((state.color.saturation - 0.25) / 1.75, 0, 1), Math.sin(state.color.hueShift) * clamp((state.color.saturation - 0.25) / 1.75, 0, 1));
    drawHandle(balance, state.color.tint, state.color.temperature); drawHandle(gamut, clamp((state.color.contrast - 1) / 0.75, -1, 1), clamp(state.color.gamutCompression / 0.75 - 1, -1, 1));
  }
  function updateColorReadouts(grade) {
    const set = (id, value) => { const el = root.document.getElementById(id); if (el) el.textContent = value; };
    set("sf-sc-read-main", `Hue ${(grade.hueShift * 180 / Math.PI).toFixed(0)}° · Sat ${grade.saturation.toFixed(2)}`);
    set("sf-sc-read-balance", `Temp ${grade.temperature.toFixed(2)} · Tint ${grade.tint.toFixed(2)}`);
    set("sf-sc-read-gamut", `Contrast ${grade.contrast.toFixed(2)} · Compress ${grade.gamutCompression.toFixed(2)}`);
  }
  function addColorReset() {
    const head = root.document.querySelector("#sf-space-color-console .sf-sc-head"); if (!head || root.document.getElementById("sf-sc-reset")) return;
    const button = root.document.createElement("button"); button.id = "sf-sc-reset"; button.textContent = "Reset wheels"; button.addEventListener("click", () => { state.color = { exposure:0,contrast:1,saturation:1,temperature:0,tint:0,hueShift:0,lift:0,gamma:1,gain:1,highlightRolloff:.65,gamutCompression:.35,look:"Neutral ACES",enabled:true }; root.sfDrawSpaceColorConsole?.(); syncColorGrade(); }); head.appendChild(button);
  }
  function installColorHooks() {
    root.sfInjectSpaceColorConsole?.(); bindWheel("sf-sc-wheel-main", "main"); bindWheel("sf-sc-wheel-balance", "balance"); bindWheel("sf-sc-wheel-gamut", "gamut"); addColorReset();
    const draw = root.sfDrawSpaceColorConsole; if (typeof draw === "function" && !draw.__sfPhase7WheelWrapped) { function wrapped(...args) { const result = draw.apply(this, args); drawWheelHandles(); return result; } wrapped.__sfPhase7WheelWrapped = true; wrapped.__sfPhase7Original = draw; root.sfDrawSpaceColorConsole = wrapped; }
    wrap("sfSpaceColorLiveUpdate", () => syncColorGrade()); wrap("sfApplySpaceColorState", () => syncColorGrade()); wrap("sfSpaceColorApplyPreset", () => syncColorGrade()); wrap("sfApplyLookDevelopmentMenu", () => syncColorGrade()); wrap("sfSetNamedLook", () => syncColorGrade());
    syncColorGrade(); state.colorHooksInstalled = true;
  }

  function updateLivePanel(data, cityName) {
    let panel = root.document.getElementById("sf-phase7-live-panel"); const body = root.document.querySelector("#sec-scene-location .s-body-inner"); if (!body) return;
    if (!panel) { panel = root.document.createElement("div"); panel.id = "sf-phase7-live-panel"; panel.className = "sf-phase7-live-panel"; body.appendChild(panel); }
    const precip = precipitationType(data); panel.innerHTML = `<div class="sf-p7-head"><b>Live Scene Engine</b><span>${data.source || "manual"}</span></div><div class="sf-p7-grid"><div><span>City</span><b>${cityName || "Selected city"}</b></div><div><span>Local time</span><b>${String(data.localTime || "--").slice(11,16) || "--"}</b></div><div><span>Condition</span><b>${data.weather || "--"}</b></div><div><span>Clouds</span><b>${Math.round(finiteOr(data.cloudCover,0))}%</b></div><div><span>Precipitation</span><b>${precip}</b></div><div><span>Visibility</span><b>${Math.round(finiteOr(data.visibility,0)/1000)} km</b></div></div>`;
  }
  function updateAuroraCompositeLabel(enabled) {
    let badge = root.document.getElementById("sf-aurora-composite-badge"); const section = root.document.querySelector("#sec-aurora .s-hdr"); if (!section) return;
    if (!badge) { badge = root.document.createElement("span"); badge.id = "sf-aurora-composite-badge"; badge.className = "sf-aurora-composite-badge"; section.insertBefore(badge, section.lastElementChild); }
    badge.textContent = enabled ? "COMPOSITE ON" : "OFF"; badge.classList.toggle("on", enabled);
  }
  function createEngineBadge() {
    const tabbar = root.document.querySelector(".tab-r"); if (!tabbar || root.document.getElementById("sf-functional-badge")) return;
    const badge = root.document.createElement("div"); badge.id = "sf-functional-badge"; badge.className = "mseg-btn sf-functional-badge"; badge.textContent = "Functional Scene"; badge.title = "Weather, atmosphere, aurora and color controls are connected to the GPU renderer"; tabbar.prepend(badge);
  }

  function installWrappers() { installWeatherHooks(); installAuroraHooks(); installColorHooks(); state.wrappersInstalled = true; }
  function install() {
    if (state.installed || !root?.document) return; state.installed = true; createEngineBadge();
    const attempt = () => {
      if (!renderer()?.getState?.()?.installed) { root.setTimeout(attempt, 100); return; }
      installWrappers();
      const key = typeof root.sfLocationSelectedKey === "function" ? root.sfLocationSelectedKey() : "";
      if (key && typeof root.sfSyncCityTelemetry === "function") root.sfSyncCityTelemetry(key, { syncClock: true });
      else renderer()?.setSettings?.({ mode: "atmosphere", galaxy: { enabled: false } });
      emit("skyforge:functional-ready", { version: VERSION });
    };
    attempt();
  }
  function destroy() { if (state.weatherTimer) root.clearInterval(state.weatherTimer); state.installed = false; }
  function getState() { return { version: VERSION, installed: state.installed, lastWeather: state.lastWeather, color: { ...state.color }, renderer: renderer()?.getState?.() || null }; }
  return { VERSION, install, destroy, getState, applyLiveWeather, syncAurora, syncColorGrade };
});
