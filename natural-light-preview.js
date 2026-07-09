(function bootstrapSkyForgeNaturalLight(factory) {
  const root = typeof window !== "undefined" ? window : null;
  const api = factory(root);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.SkyForgeNaturalLightPreview = api;
    if (root.document?.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", api.install, { once: true });
    } else {
      api.install();
    }
  }
})(function createSkyForgeNaturalLightPreview(root) {
  "use strict";

  const API_ENDPOINT = "/api/lighting/preview";
  const CLIENT_VERSION = "0.2.0";
  const LUT_WIDTH = 96;
  const LUT_HEIGHT = 48;
  const RELEVANT_IDS = new Set([
    "scene-date",
    "scene-time",
    "city-lat",
    "city-lon",
    "city-tz",
    "city-temp",
    "v-haze",
    "v-oz",
    "v-mie",
    "v-turb"
  ]);

  const state = {
    installed: false,
    enabled: true,
    requestSerial: 0,
    abortController: null,
    refreshTimer: null,
    lastInputKey: "",
    lastResult: null,
    restoredInput: null,
    overlayCanvas: null,
    overlayContext: null,
    lutCanvas: null,
    statusBadge: null,
    resizeObserver: null,
    hookTimer: null
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finiteOr(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function parseFirstNumber(value, fallback = 0) {
    const match = String(value ?? "").replace(",", ".").match(/[+-]?(?:\d+\.?\d*|\.\d+)/);
    return match ? finiteOr(match[0], fallback) : fallback;
  }

  function pad2(value) {
    return String(Math.trunc(Math.abs(value))).padStart(2, "0");
  }

  function formatOffset(offsetMinutes) {
    const minutes = Math.round(finiteOr(offsetMinutes, 0));
    const sign = minutes < 0 ? "-" : "+";
    const absolute = Math.abs(minutes);
    return `${sign}${pad2(absolute / 60)}:${pad2(absolute % 60)}`;
  }

  function parseOffsetText(value) {
    const text = String(value || "").trim();
    const match = text.match(/(?:UTC|GMT)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i);
    if (!match) return null;
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
  }

  function offsetForTimeZone(dateString, timeString, timeZone) {
    if (!timeZone || !String(timeZone).includes("/") || typeof Intl === "undefined") {
      return null;
    }

    try {
      const [year, month, day] = String(dateString).split("-").map(Number);
      const [hour, minute] = String(timeString).split(":").map(Number);
      const utcGuess = new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0));
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      });
      const parts = Object.fromEntries(
        formatter.formatToParts(utcGuess)
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, Number(part.value)])
      );
      const representedUtc = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
      );
      return Math.round((representedUtc - utcGuess.getTime()) / 60_000);
    } catch {
      return null;
    }
  }

  function resolveTimezoneOffsetMinutes(dateString, timeString, timezoneLabel, browserOffsetMinutes = 0) {
    const parsed = parseOffsetText(timezoneLabel);
    if (parsed !== null) return parsed;

    const ianaMatch = String(timezoneLabel || "").match(/[A-Za-z_]+\/[A-Za-z0-9_+\-/]+/);
    const ianaOffset = offsetForTimeZone(dateString, timeString, ianaMatch?.[0]);
    if (ianaOffset !== null) return ianaOffset;

    return finiteOr(browserOffsetMinutes, 0);
  }

  function linearToDisplayChannel(value) {
    const linear = Math.max(0, finiteOr(value, 0));
    const toneMapped = 1 - Math.exp(-linear * 1.45);
    const srgb = toneMapped <= 0.0031308
      ? 12.92 * toneMapped
      : 1.055 * Math.pow(toneMapped, 1 / 2.4) - 0.055;
    return Math.round(clamp(srgb, 0, 1) * 255);
  }

  function sampleLutPixel(lut, x, y) {
    const width = Number(lut?.layout?.width) || 0;
    const height = Number(lut?.layout?.height) || 0;
    if (!width || !height || !Array.isArray(lut?.pixels)) return [0, 0, 0];
    const px = clamp(Math.trunc(x), 0, width - 1);
    const py = clamp(Math.trunc(y), 0, height - 1);
    const offset = (py * width + px) * 3;
    return [
      finiteOr(lut.pixels[offset], 0),
      finiteOr(lut.pixels[offset + 1], 0),
      finiteOr(lut.pixels[offset + 2], 0)
    ];
  }

  function elementValue(documentRef, id, fallback = "") {
    const element = documentRef?.getElementById(id);
    if (!element) return fallback;
    return element.value !== undefined ? element.value : element.textContent || fallback;
  }

  function buildInputFromDocument(documentRef, windowRef = root) {
    const now = new Date();
    const dateString = elementValue(documentRef, "scene-date", now.toISOString().slice(0, 10));
    const timeString = elementValue(
      documentRef,
      "scene-time",
      `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
    );
    const timezoneLabel = elementValue(documentRef, "city-tz", "");
    const browserOffsetMinutes = -(now.getTimezoneOffset?.() || 0);
    const timezoneOffsetMinutes = resolveTimezoneOffsetMinutes(
      dateString,
      timeString,
      timezoneLabel,
      browserOffsetMinutes
    );

    const haze = parseFirstNumber(elementValue(documentRef, "v-haze", "0.30"), 0.3);
    const ozoneControl = parseFirstNumber(elementValue(documentRef, "v-oz", "0.60"), 0.6);
    const mieControl = parseFirstNumber(elementValue(documentRef, "v-mie", "0.35"), 0.35);
    const temperatureC = parseFirstNumber(elementValue(documentRef, "city-temp", "15"), 15);

    const restored = state.restoredInput || {};
    return {
      latitude: clamp(parseFirstNumber(elementValue(documentRef, "city-lat", restored.latitude ?? 48.8566), 48.8566), -90, 90),
      longitude: clamp(parseFirstNumber(elementValue(documentRef, "city-lon", restored.longitude ?? 2.3522), 2.3522), -180, 180),
      dateTime: `${dateString}T${timeString || "12:00"}:00${formatOffset(timezoneOffsetMinutes)}`,
      timezoneOffsetMinutes,
      altitudeMeters: clamp(finiteOr(restored.altitudeMeters, 35), -500, 20_000),
      pressureHpa: clamp(finiteOr(restored.pressureHpa, 1013.25), 100, 1100),
      temperatureC: clamp(temperatureC, -100, 80),
      aerosolOpticalDepth550: clamp(haze, 0, 5),
      angstromExponent: clamp(finiteOr(restored.angstromExponent, 1.3), 0, 4),
      mieAsymmetry: clamp(0.65 + mieControl * 0.3, -0.99, 0.99),
      groundAlbedo: clamp(finiteOr(restored.groundAlbedo, 0.2), 0, 1),
      ozoneDobsonUnits: clamp(200 + ozoneControl * 200, 100, 700),
      precipitableWaterCm: clamp(finiteOr(restored.precipitableWaterCm, 1.5), 0, 12)
    };
  }

  function resultInputKey(input) {
    return JSON.stringify(input);
  }

  function createStyle(documentRef) {
    if (documentRef.getElementById("sf-physical-light-style")) return;
    const style = documentRef.createElement("style");
    style.id = "sf-physical-light-style";
    style.textContent = `
      #sf-physical-sky-canvas{
        position:absolute;inset:0;width:100%;height:100%;pointer-events:none;
        z-index:3;opacity:.82;transition:opacity .18s ease;
      }
      #sf-physical-sky-canvas.sf-disabled{opacity:0}
      .sf-physical-light-badge{
        display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border-radius:5px;
        border:1px solid rgba(75,210,135,.34);background:rgba(34,123,78,.18);
        color:#75e2a7;font:9px/1.2 var(--fm,monospace);cursor:pointer;user-select:none;
      }
      .sf-physical-light-badge::before{content:"";width:6px;height:6px;border-radius:50%;background:#30d158;box-shadow:0 0 8px rgba(48,209,88,.72)}
      .sf-physical-light-badge.sf-loading{color:#ffd06f;border-color:rgba(255,208,111,.36);background:rgba(132,93,24,.19)}
      .sf-physical-light-badge.sf-loading::before{background:#ffd60a;box-shadow:0 0 8px rgba(255,214,10,.68)}
      .sf-physical-light-badge.sf-error{color:#ff8b82;border-color:rgba(255,69,58,.38);background:rgba(130,38,34,.2)}
      .sf-physical-light-badge.sf-error::before{background:#ff453a;box-shadow:0 0 8px rgba(255,69,58,.68)}
      .sf-physical-light-badge.sf-off{color:#9aa1ae;border-color:rgba(255,255,255,.13);background:rgba(255,255,255,.05)}
      .sf-physical-light-badge.sf-off::before{background:#68707d;box-shadow:none}
    `;
    documentRef.head.appendChild(style);
  }

  function createOverlay(documentRef) {
    const viewport = documentRef.getElementById("vp");
    if (!viewport) return null;

    let canvas = documentRef.getElementById("sf-physical-sky-canvas");
    if (!canvas) {
      canvas = documentRef.createElement("canvas");
      canvas.id = "sf-physical-sky-canvas";
      canvas.setAttribute("aria-hidden", "true");
      const anchor = documentRef.getElementById("ab-canvas") || viewport.firstChild;
      viewport.insertBefore(canvas, anchor);
    }

    state.overlayCanvas = canvas;
    state.overlayContext = canvas.getContext("2d", { alpha: true });
    syncOverlaySize();

    if (typeof root?.ResizeObserver === "function") {
      state.resizeObserver?.disconnect();
      state.resizeObserver = new root.ResizeObserver(() => {
        syncOverlaySize();
        renderPhysicalPreview();
      });
      state.resizeObserver.observe(viewport);
    }
    return canvas;
  }

  function createStatusBadge(documentRef) {
    if (state.statusBadge?.isConnected) return state.statusBadge;
    const host = documentRef.querySelector(".vp-bar .vp-r") || documentRef.querySelector(".vp-r");
    if (!host) return null;

    const badge = documentRef.createElement("button");
    badge.type = "button";
    badge.className = "sf-physical-light-badge sf-loading";
    badge.textContent = "PHYS · CONNECTING";
    badge.title = "Toggle the SkyForge physical Natural Light preview";
    badge.addEventListener("click", () => setEnabled(!state.enabled));
    host.prepend(badge);
    state.statusBadge = badge;
    return badge;
  }

  function setBadge(status, text, title) {
    const badge = state.statusBadge;
    if (!badge) return;
    badge.classList.remove("sf-loading", "sf-error", "sf-off");
    if (status === "loading") badge.classList.add("sf-loading");
    if (status === "error") badge.classList.add("sf-error");
    if (status === "off") badge.classList.add("sf-off");
    badge.textContent = text;
    if (title) badge.title = title;
  }

  function syncOverlaySize() {
    const canvas = state.overlayCanvas;
    const viewport = canvas?.parentElement;
    if (!canvas || !viewport) return;
    const rect = viewport.getBoundingClientRect();
    const dpr = clamp(finiteOr(root?.devicePixelRatio, 1), 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function buildLutCanvas(lut) {
    const width = Number(lut?.layout?.width) || 0;
    const height = Number(lut?.layout?.height) || 0;
    if (!width || !height || !Array.isArray(lut?.pixels)) return null;

    const documentRef = root?.document;
    const canvas = state.lutCanvas || documentRef.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const image = context.createImageData(width, height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const source = sampleLutPixel(lut, x, y);
        const destinationOffset = (y * width + x) * 4;
        image.data[destinationOffset] = linearToDisplayChannel(source[0]);
        image.data[destinationOffset + 1] = linearToDisplayChannel(source[1]);
        image.data[destinationOffset + 2] = linearToDisplayChannel(source[2]);
        image.data[destinationOffset + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
    state.lutCanvas = canvas;
    return canvas;
  }

  function drawSolarDisc(context, width, height, solarPosition) {
    if (!solarPosition?.isAboveHorizon) return;
    const azimuth = ((finiteOr(solarPosition.azimuthDeg, 0) % 360) + 360) % 360;
    const elevation = clamp(finiteOr(solarPosition.apparentElevationDeg, 0), 0, 90);
    const x = (azimuth / 360) * width;
    const y = (1 - elevation / 90) * height;
    const coreRadius = Math.max(1.5, width * (0.53 / 360) * 0.5);
    const haloRadius = Math.max(12, coreRadius * 12);

    context.save();
    context.globalCompositeOperation = "screen";
    for (const wrappedX of [x - width, x, x + width]) {
      const gradient = context.createRadialGradient(
        wrappedX,
        y,
        coreRadius * 0.2,
        wrappedX,
        y,
        haloRadius
      );
      gradient.addColorStop(0, "rgba(255,255,245,1)");
      gradient.addColorStop(0.08, "rgba(255,246,208,.98)");
      gradient.addColorStop(0.26, "rgba(255,188,90,.42)");
      gradient.addColorStop(1, "rgba(255,130,30,0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(wrappedX, y, haloRadius, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "rgba(255,255,245,.98)";
      context.beginPath();
      context.arc(wrappedX, y, coreRadius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function renderPhysicalPreview() {
    const canvas = state.overlayCanvas;
    const context = state.overlayContext;
    const result = state.lastResult;
    if (!canvas || !context) return;

    syncOverlaySize();
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.toggle("sf-disabled", !state.enabled);
    if (!state.enabled || !result?.skyViewLut) return;

    const lutCanvas = buildLutCanvas(result.skyViewLut);
    if (!lutCanvas) return;

    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.globalAlpha = 0.93;
    context.drawImage(lutCanvas, 0, 0, canvas.width, canvas.height);

    const horizonFade = context.createLinearGradient(0, canvas.height * 0.72, 0, canvas.height);
    horizonFade.addColorStop(0, "rgba(255,255,255,0)");
    horizonFade.addColorStop(1, "rgba(245,174,105,.12)");
    context.fillStyle = horizonFade;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();

    drawSolarDisc(
      context,
      canvas.width,
      canvas.height,
      result.evaluation?.solarPosition || result.skyViewLut?.solarPosition
    );
  }

  function setText(documentRef, id, value) {
    const element = documentRef.getElementById(id);
    if (element) element.textContent = value;
  }

  function updateUi(result) {
    const documentRef = root?.document;
    const evaluation = result?.evaluation;
    const solar = evaluation?.solarPosition;
    if (!documentRef || !solar) return;

    const azimuth = finiteOr(solar.azimuthDeg, 0);
    const elevation = finiteOr(solar.apparentElevationDeg, 0);
    const cct = Math.round(finiteOr(evaluation.color?.directSunCctEstimatedK, 6500));
    const dni = Math.round(finiteOr(evaluation.irradiance?.directNormalWm2, 0));
    const sunText = `${azimuth.toFixed(1)}° / ${elevation.toFixed(1)}°`;

    setText(documentRef, "v-az", `${azimuth.toFixed(1)}°`);
    setText(documentRef, "v-elev", `${elevation.toFixed(1)}°`);
    setText(documentRef, "rp-sun", sunText);
    setText(documentRef, "ai-sun", sunText);
    setText(documentRef, "rp-temp", `${cct} K`);
    setText(documentRef, "ai-temp", `${cct} K`);
    setText(documentRef, "ai-intensity", `${dni} W/m²`);

    const temperatureInput = documentRef.getElementById("sun-temp-k");
    if (temperatureInput && Number.isFinite(cct)) temperatureInput.value = String(cct);

    const physicalSegment = Array.from(documentRef.querySelectorAll(".mseg-btn"))
      .find((element) => /physical/i.test(element.textContent || ""));
    if (physicalSegment && state.enabled) {
      physicalSegment.closest(".mseg")?.querySelectorAll(".mseg-btn")
        .forEach((element) => element.classList.toggle("active", element === physicalSegment));
    }

    const modelStatus = Array.from(documentRef.querySelectorAll(".statusbar .st"))
      .find((element) => /Hosek|Nishita|Physical|Spectral/i.test(element.textContent || ""));
    if (modelStatus) modelStatus.textContent = "Spectral Physical · LUT";
  }

  function sceneInputFromState(sceneState) {
    if (!sceneState?.location || !sceneState?.time || !sceneState?.atmosphere) return null;
    return {
      ...sceneState.location,
      ...sceneState.time,
      ...sceneState.atmosphere
    };
  }

  function applySceneStateToControls(sceneState) {
    const documentRef = root?.document;
    const input = sceneInputFromState(sceneState);
    if (!documentRef || !input) return;
    state.restoredInput = input;

    const dateMatch = String(input.dateTime || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    const assignments = {
      "city-lat": input.latitude,
      "city-lon": input.longitude,
      "scene-date": dateMatch?.[1],
      "scene-time": dateMatch?.[2]
    };
    for (const [id, value] of Object.entries(assignments)) {
      const element = documentRef.getElementById(id);
      if (element && value !== undefined && value !== null) element.value = String(value);
    }
  }

  async function requestPreview(force = false) {
    if (!root?.document || !state.enabled) return null;
    const input = buildInputFromDocument(root.document, root);
    const key = resultInputKey(input);
    if (!force && key === state.lastInputKey && state.lastResult) {
      renderPhysicalPreview();
      return state.lastResult;
    }

    const serial = ++state.requestSerial;
    state.abortController?.abort();
    state.abortController = typeof root.AbortController === "function"
      ? new root.AbortController()
      : null;
    setBadge("loading", "PHYS · SOLVING", "Computing physical sunlight and Sky-View LUT");

    try {
      const response = await root.fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          lut: { width: LUT_WIDTH, height: LUT_HEIGHT }
        }),
        signal: state.abortController?.signal
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Lighting API returned ${response.status}`);
      if (serial !== state.requestSerial) return null;

      state.lastInputKey = key;
      state.lastResult = payload;
      state.restoredInput = payload.input || input;
      renderPhysicalPreview();
      updateUi(payload);
      setBadge(
        "live",
        "PHYS · LIVE",
        `Natural Light ${payload.evaluation?.model?.version || ""} · Sky LUT ${payload.skyViewLut?.model?.version || ""}`
      );
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") return null;
      setBadge("error", "PHYS · OFFLINE", error?.message || "Natural Light API unavailable");
      return null;
    }
  }

  function scheduleRefresh(delay = 180, force = false) {
    if (!state.enabled) return;
    root?.clearTimeout(state.refreshTimer);
    state.refreshTimer = root?.setTimeout(() => requestPreview(force), delay);
  }

  function wrapAfter(name, callback) {
    const current = root?.[name];
    if (typeof current !== "function" || current.__sfPhysicalWrapped) return false;
    function wrappedFunction(...args) {
      const result = current.apply(this, args);
      try {
        callback(args, result);
      } catch {
        // Integration hooks must never break the host application.
      }
      return result;
    }
    wrappedFunction.__sfPhysicalWrapped = true;
    wrappedFunction.__sfPhysicalOriginal = current;
    root[name] = wrappedFunction;
    return true;
  }

  function installFunctionHooks() {
    wrapAfter("drawSky", () => {
      renderPhysicalPreview();
      scheduleRefresh(220, false);
    });

    [
      "sfSelectCityKey",
      "quickCity",
      "sfSyncCityTelemetry",
      "sfApplySceneTimeRealtime",
      "sfLocationClockUseCityTime",
      "syncLocationLook",
      "sfApplySunAtmosphereMenu"
    ].forEach((name) => wrapAfter(name, () => scheduleRefresh(160, true)));

    wrapAfter("setSeg", (args) => {
      const label = String(args[0]?.textContent || "").toLowerCase();
      if (label.includes("physical")) setEnabled(true);
      if (label.includes("procedural")) setEnabled(false);
      if (label.includes("hybrid")) {
        state.enabled = true;
        if (state.overlayCanvas) state.overlayCanvas.style.opacity = ".56";
        scheduleRefresh(0, true);
      }
    });

    const collectScene = root?.sfCollectScene;
    if (typeof collectScene === "function" && !collectScene.__sfPhysicalWrapped) {
      function collectSceneWithPhysicalLight(...args) {
        const scene = collectScene.apply(this, args) || {};
        if (state.lastResult?.sceneState) {
          scene.lighting = scene.lighting && typeof scene.lighting === "object" ? scene.lighting : {};
          scene.lighting.naturalLight = state.lastResult.sceneState;
        }
        return scene;
      }
      collectSceneWithPhysicalLight.__sfPhysicalWrapped = true;
      collectSceneWithPhysicalLight.__sfPhysicalOriginal = collectScene;
      root.sfCollectScene = collectSceneWithPhysicalLight;
    }

    ["sfNormalizeSkyForgeScene", "sfApplyScene", "sfApplySkyForgeScene"].forEach((name) => {
      const current = root?.[name];
      if (typeof current !== "function" || current.__sfPhysicalWrapped) return;
      function wrappedSceneFunction(...args) {
        const result = current.apply(this, args);
        const candidate = result && typeof result === "object" ? result : args[0];
        const naturalLight = candidate?.lighting?.naturalLight;
        if (naturalLight) {
          applySceneStateToControls(naturalLight);
          scheduleRefresh(40, true);
        }
        return result;
      }
      wrappedSceneFunction.__sfPhysicalWrapped = true;
      wrappedSceneFunction.__sfPhysicalOriginal = current;
      root[name] = wrappedSceneFunction;
    });
  }

  function setEnabled(enabled) {
    state.enabled = Boolean(enabled);
    if (state.overlayCanvas) {
      state.overlayCanvas.classList.toggle("sf-disabled", !state.enabled);
      state.overlayCanvas.style.opacity = "";
    }
    if (!state.enabled) {
      state.abortController?.abort();
      setBadge("off", "PHYS · OFF", "Physical preview disabled; procedural SkyForge preview remains active");
    } else {
      setBadge("loading", "PHYS · SOLVING", "Physical preview enabled");
      scheduleRefresh(0, true);
    }
    return state.enabled;
  }

  function onControlEvent(event) {
    const target = event.target;
    if (!target) return;
    if (
      RELEVANT_IDS.has(target.id) ||
      target.closest?.("#sec-scene-location") ||
      target.closest?.("#sec-sun")
    ) {
      scheduleRefresh(event.type === "input" ? 260 : 80, true);
    }
  }

  function install() {
    if (state.installed || !root?.document) return;
    state.installed = true;
    createStyle(root.document);
    createOverlay(root.document);
    createStatusBadge(root.document);
    installFunctionHooks();

    root.document.addEventListener("input", onControlEvent, true);
    root.document.addEventListener("change", onControlEvent, true);
    state.hookTimer = root.setInterval(installFunctionHooks, 1000);
    root.setTimeout(() => requestPreview(true), 350);
  }

  function getState() {
    return {
      installed: state.installed,
      enabled: state.enabled,
      input: state.lastResult?.input || null,
      sceneState: state.lastResult?.sceneState || null,
      evaluation: state.lastResult?.evaluation || null,
      skyViewLut: state.lastResult?.skyViewLut || null,
      clientVersion: CLIENT_VERSION
    };
  }

  return {
    CLIENT_VERSION,
    parseFirstNumber,
    parseOffsetText,
    formatOffset,
    resolveTimezoneOffsetMinutes,
    linearToDisplayChannel,
    sampleLutPixel,
    buildInputFromDocument,
    install,
    refresh: () => requestPreview(true),
    render: renderPhysicalPreview,
    setEnabled,
    getState
  };
});
