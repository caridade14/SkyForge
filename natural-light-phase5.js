(function bootstrapSkyForgePhase5(factory) {
  const root = typeof window !== "undefined" ? window : null;
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.SkyForgeNaturalLightPhase5 = api;
    if (root.document?.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", api.install, { once: true });
    } else {
      api.install();
    }
  }
})(function createSkyForgePhase5(root) {
  "use strict";

  const CLIENT_VERSION = "0.5.0";
  const PIPELINE_ENDPOINT = "/api/lighting/phase5/pipeline";
  const state = {
    installed: false,
    enabled: true,
    payload: null,
    pipeline: null,
    canvas: null,
    context: null,
    workCanvas: null,
    workContext: null,
    resizeObserver: null,
    abortController: null,
    animationFrame: null,
    lastFrameTime: 0,
    currentExposureEv: null,
    cameraOverrides: {},
    cloudOverrides: {},
    qualityOverrides: { preset: "production" },
    visualizationMode: "sky",
    hookTimer: null
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finiteOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function fract(value) {
    return value - Math.floor(value);
  }

  function lerp(a, b, t) {
    return a * (1 - t) + b * t;
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / Math.max(Math.abs(edge1 - edge0), 1e-6), 0, 1);
    const shaped = t * t * (3 - 2 * t);
    return edge1 >= edge0 ? shaped : 1 - shaped;
  }

  function hash2(x, y, seed) {
    return fract(Math.sin(x * 127.1 + y * 311.7 + seed * 0.013) * 43758.5453123);
  }

  function valueNoise2(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smoothstep(0, 1, fract(x));
    const fy = smoothstep(0, 1, fract(y));
    const a = hash2(ix, iy, seed);
    const b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed);
    const d = hash2(ix + 1, iy + 1, seed);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  }

  function fbm2(x, y, octaves, seed) {
    let amplitude = 0.5;
    let frequency = 1;
    let total = 0;
    let normalization = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      total += valueNoise2(x * frequency, y * frequency, seed + octave * 101) * amplitude;
      normalization += amplitude;
      amplitude *= 0.5;
      frequency *= 2.03;
    }
    return total / Math.max(normalization, 1e-6);
  }

  function acesChannel(value) {
    const x = Math.max(0, value);
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1);
  }

  function linearToSrgb(value) {
    const x = Math.max(0, value);
    return clamp(x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055, 0, 1);
  }

  function displayChannel(value, exposure, whiteBalance) {
    return Math.round(linearToSrgb(acesChannel(Math.max(0, value) * exposure * whiteBalance)) * 255);
  }

  function adaptExposure(currentEv, targetEv, deltaSeconds, camera) {
    if (!Number.isFinite(currentEv)) return targetEv;
    const speed = targetEv < currentEv
      ? finiteOr(camera?.adaptationSpeedUp, 3)
      : finiteOr(camera?.adaptationSpeedDown, 1.5);
    return currentEv + (targetEv - currentEv) * (1 - Math.exp(-speed * clamp(deltaSeconds, 0, 1)));
  }

  function lutChannelCount(lut) {
    const width = Number(lut?.layout?.width) || 0;
    const height = Number(lut?.layout?.height) || 0;
    const declared = Array.isArray(lut?.layout?.channels) ? lut.layout.channels.length : 0;
    if (declared >= 3) return declared;
    return width && height && Array.isArray(lut?.pixels)
      ? Math.max(3, Math.floor(lut.pixels.length / (width * height)))
      : 3;
  }

  function sampleLut(lut, u, v) {
    const width = Number(lut?.layout?.width) || 0;
    const height = Number(lut?.layout?.height) || 0;
    if (!width || !height || !Array.isArray(lut?.pixels)) return [0, 0, 0];
    const stride = lutChannelCount(lut);
    const x = clamp(u, 0, 1) * (width - 1);
    const y = clamp(v, 0, 1) * (height - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const read = (px, py, channel) => finiteOr(lut.pixels[(py * width + px) * stride + channel], 0);
    const channels = [];
    for (let channel = 0; channel < 3; channel += 1) {
      channels[channel] = lerp(
        lerp(read(x0, y0, channel), read(x1, y0, channel), tx),
        lerp(read(x0, y1, channel), read(x1, y1, channel), tx),
        ty
      );
    }
    return channels;
  }

  function ensureCanvas() {
    const documentRef = root?.document;
    const viewport = documentRef?.getElementById("vp");
    if (!documentRef || !viewport) return null;
    if (root.getComputedStyle?.(viewport).position === "static") viewport.style.position = "relative";

    let canvas = documentRef.getElementById("sf-phase5-natural-light-canvas");
    if (!canvas) {
      canvas = documentRef.createElement("canvas");
      canvas.id = "sf-phase5-natural-light-canvas";
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.cssText = [
        "position:absolute",
        "inset:0",
        "width:100%",
        "height:100%",
        "pointer-events:none",
        "z-index:0",
        "opacity:1",
        "transition:opacity .18s ease"
      ].join(";");
      const legacyCanvas = documentRef.getElementById("sf-physical-sky-canvas");
      viewport.insertBefore(canvas, legacyCanvas?.nextSibling || viewport.firstChild);
    }
    state.canvas = canvas;
    state.context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    state.workCanvas ||= documentRef.createElement("canvas");
    state.workContext ||= state.workCanvas.getContext("2d", { alpha: true });
    syncCanvasSize();
    return canvas;
  }

  function syncCanvasSize() {
    const canvas = state.canvas;
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

  function resolveCloudControls(documentRef) {
    const read = (ids, fallback) => {
      for (const id of ids) {
        const element = documentRef?.getElementById(id);
        if (!element) continue;
        const match = String(element.value ?? element.textContent ?? "").replace(",", ".").match(/[+-]?(?:\d+\.?\d*|\.\d+)/);
        if (match) return finiteOr(match[0], fallback);
      }
      return fallback;
    };
    return {
      coverage: clamp(read(["v-cov", "cloud-coverage", "cloudCoverage"], 0.32), 0, 1),
      density: clamp(read(["v-dens", "cloud-density", "cloudDensity"], 0.55), 0, 2)
    };
  }

  function cloudDensityAt(u, v, timeSeconds, clouds) {
    if (!clouds?.enabled || v > 0.82) return 0;
    const direction = finiteOr(clouds.windDirectionDeg, 245) * Math.PI / 180;
    const speed = finiteOr(clouds.windSpeedMetersPerSecond, 12) * 0.000055;
    const ox = Math.sin(direction) * timeSeconds * speed;
    const oy = Math.cos(direction) * timeSeconds * speed;
    const horizonStretch = 0.65 + (1 - v) * 1.35;
    const x = (u * 5.2 + ox) * horizonStretch;
    const y = v * 6.5 + oy;
    const macro = fbm2(x, y, 5, clouds.seed || 1337);
    const detail = fbm2(x * 3.7, y * 3.7, 3, (clouds.seed || 1337) + 991);
    const threshold = 1 - clamp(finiteOr(clouds.coverage, 0.32), 0, 1);
    const eroded = macro - (1 - detail) * finiteOr(clouds.erosion, 0.42) * finiteOr(clouds.detailStrength, 0.34);
    const vertical = smoothstep(0.82, 0.22, v) * smoothstep(0.02, 0.18, v);
    return clamp((eroded - threshold) * 2.4, 0, 1) * vertical * finiteOr(clouds.density, 0.55);
  }

  function henyeyGreenstein(cosTheta, asymmetry) {
    const g = clamp(finiteOr(asymmetry, 0.72), -0.95, 0.95);
    return (1 - g * g) / (4 * Math.PI * Math.pow(Math.max(1 + g * g - 2 * g * clamp(cosTheta, -1, 1), 1e-6), 1.5));
  }

  function renderFrame(timestamp) {
    state.animationFrame = null;
    if (!state.enabled || state.visualizationMode !== "sky" || !state.payload || !state.pipeline) return;
    const canvas = state.canvas;
    const context = state.context;
    const workCanvas = state.workCanvas;
    const workContext = state.workContext;
    if (!canvas || !context || !workCanvas || !workContext) return;

    syncCanvasSize();
    const deltaSeconds = state.lastFrameTime ? (timestamp - state.lastFrameTime) / 1000 : 1 / 60;
    state.lastFrameTime = timestamp;
    const camera = state.pipeline.camera || {};
    state.currentExposureEv = adaptExposure(
      state.currentExposureEv,
      finiteOr(camera.targetExposureEv, 10),
      deltaSeconds,
      camera
    );
    const exposure = Math.pow(2, -finiteOr(state.currentExposureEv, 10));
    const whiteBalance = camera.whiteBalanceMultipliers || { r: 1, g: 1, b: 1 };
    const quality = state.pipeline.quality?.preset || "production";
    const workWidth = quality === "reference" ? 384 : quality === "realtime" ? 192 : 288;
    const workHeight = Math.max(96, Math.round(workWidth * canvas.height / Math.max(canvas.width, 1)));
    if (workCanvas.width !== workWidth || workCanvas.height !== workHeight) {
      workCanvas.width = workWidth;
      workCanvas.height = workHeight;
    }

    const image = workContext.createImageData(workWidth, workHeight);
    const lut = state.payload.skyViewLut;
    const clouds = state.pipeline.clouds || {};
    const sun = state.pipeline.sun || {};
    const sunU = ((finiteOr(sun.azimuthDeg, 0) % 360) + 360) % 360 / 360;
    const sunV = 1 - clamp(finiteOr(sun.apparentElevationDeg, 0), 0, 90) / 90;
    const nowSeconds = timestamp / 1000;

    for (let y = 0; y < workHeight; y += 1) {
      const v = y / Math.max(workHeight - 1, 1);
      for (let x = 0; x < workWidth; x += 1) {
        const u = x / Math.max(workWidth - 1, 1);
        const sky = sampleLut(lut, u, v);
        const density = cloudDensityAt(u, v, nowSeconds, clouds);
        let red = sky[0];
        let green = sky[1];
        let blue = sky[2];

        if (density > 0.001) {
          const wrappedDu = Math.min(Math.abs(u - sunU), 1 - Math.abs(u - sunU));
          const dv = Math.abs(v - sunV);
          const angularDistance = Math.hypot(wrappedDu * 2, dv);
          const cosTheta = clamp(1 - angularDistance * 3.2, -1, 1);
          const phase = henyeyGreenstein(cosTheta, clouds.phaseAsymmetry);
          const extinction = finiteOr(clouds.extinctionCoefficient, 0.00085);
          const pathLength = 900 + v * 2400;
          const transmittance = Math.exp(-density * extinction * pathLength);
          const silverLining = clamp(phase * 9, 0, 1.6) * (1 - transmittance);
          const multiple = finiteOr(clouds.multiScatteringFactor, 0.35) * (1 - transmittance);
          const horizonWarmth = clamp(1 - Math.abs(v - 0.72) * 4, 0, 1);
          const cloudLight = [
            0.62 + silverLining * 1.25 + horizonWarmth * 0.13,
            0.66 + silverLining * 1.08 + horizonWarmth * 0.07,
            0.72 + silverLining * 0.82
          ];
          red = red * transmittance + cloudLight[0] * (1 - transmittance) * (0.74 + multiple);
          green = green * transmittance + cloudLight[1] * (1 - transmittance) * (0.74 + multiple);
          blue = blue * transmittance + cloudLight[2] * (1 - transmittance) * (0.74 + multiple);
        }

        const horizonHaze = smoothstep(0.62, 1, v) * 0.08;
        red += horizonHaze * 0.72;
        green += horizonHaze * 0.48;
        blue += horizonHaze * 0.27;

        const offset = (y * workWidth + x) * 4;
        image.data[offset] = displayChannel(red, exposure, whiteBalance.r);
        image.data[offset + 1] = displayChannel(green, exposure, whiteBalance.g);
        image.data[offset + 2] = displayChannel(blue, exposure, whiteBalance.b);
        image.data[offset + 3] = 255;
      }
    }

    workContext.putImageData(image, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(workCanvas, 0, 0, canvas.width, canvas.height);
    drawSunDisc(context, canvas.width, canvas.height, sun);

    if (clouds.enabled) scheduleAnimation();
  }

  function drawSunDisc(context, width, height, sun) {
    if (finiteOr(sun.apparentElevationDeg, -90) <= 0) return;
    const x = (((finiteOr(sun.azimuthDeg, 0) % 360) + 360) % 360 / 360) * width;
    const y = (1 - clamp(finiteOr(sun.apparentElevationDeg, 0), 0, 90) / 90) * height;
    const angularDiameter = finiteOr(sun.angularDiameterDeg, 0.533);
    const radius = Math.max(1.2, width * (angularDiameter / 360) * 0.5);
    const haloRadius = Math.max(18, radius * 26);
    const brightness = clamp(Math.pow(2, 10 - finiteOr(state.currentExposureEv, 10)) * 0.2, 0.08, 1);
    context.save();
    context.globalCompositeOperation = "screen";
    for (const wrappedX of [x - width, x, x + width]) {
      const gradient = context.createRadialGradient(wrappedX, y, radius * 0.1, wrappedX, y, haloRadius);
      gradient.addColorStop(0, `rgba(255,255,247,${brightness})`);
      gradient.addColorStop(0.08, `rgba(255,244,199,${brightness * 0.9})`);
      gradient.addColorStop(0.32, `rgba(255,176,72,${brightness * 0.25})`);
      gradient.addColorStop(1, "rgba(255,135,30,0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(wrappedX, y, haloRadius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = `rgba(255,255,249,${clamp(brightness * 1.5, 0, 1)})`;
      context.beginPath();
      context.arc(wrappedX, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function scheduleAnimation() {
    if (state.animationFrame || !root?.requestAnimationFrame) return;
    state.animationFrame = root.requestAnimationFrame(renderFrame);
  }

  async function requestPipeline(payload) {
    if (!root?.fetch || !payload?.input) return null;
    state.abortController?.abort();
    state.abortController = typeof root.AbortController === "function" ? new root.AbortController() : null;
    const liveCloudControls = resolveCloudControls(root.document);
    const external = root.SkyForgePhase5Overrides || {};
    const body = {
      input: payload.input,
      camera: { ...state.cameraOverrides, ...(external.camera || {}) },
      clouds: {
        ...liveCloudControls,
        ...state.cloudOverrides,
        ...(external.clouds || {})
      },
      render: { ...state.qualityOverrides, ...(external.render || {}) }
    };
    const response = await root.fetch(PIPELINE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: state.abortController?.signal
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Phase 5 API returned ${response.status}`);
    state.pipeline = result.renderState;
    state.currentExposureEv ??= state.pipeline.camera?.targetExposureEv ?? 10;
    scheduleAnimation();
    emit("skyforge:natural-light-phase5-updated", getState());
    return result;
  }

  function handleNaturalLightUpdated(event) {
    state.payload = event.detail;
    requestPipeline(state.payload).catch((error) => {
      emit("skyforge:natural-light-phase5-status", { status: "error", error: error.message });
    });
  }

  function handleNaturalLightControls(event) {
    const mode = event.detail?.visualizationMode || "sky";
    state.visualizationMode = mode;
    syncLegacyCanvas();
    if (mode === "sky") scheduleAnimation();
  }

  function syncLegacyCanvas() {
    const legacyCanvas = root?.document?.getElementById("sf-physical-sky-canvas");
    const active = state.enabled && state.visualizationMode === "sky";
    if (state.canvas) state.canvas.style.opacity = active ? "1" : "0";
    if (legacyCanvas) legacyCanvas.style.opacity = active ? "0" : "";
  }

  function emit(name, detail) {
    if (!root?.dispatchEvent || typeof root.CustomEvent !== "function") return;
    root.dispatchEvent(new root.CustomEvent(name, { detail }));
  }

  function wrapAfter(name, callback) {
    const current = root?.[name];
    if (typeof current !== "function" || current.__sfPhase5Wrapped) return false;
    function wrapped(...args) {
      const result = current.apply(this, args);
      try { callback(args, result); } catch {}
      return result;
    }
    wrapped.__sfPhase5Wrapped = true;
    wrapped.__sfPhase5Original = current;
    root[name] = wrapped;
    return true;
  }

  function installHostHooks() {
    const collectScene = root?.sfCollectScene;
    if (typeof collectScene === "function" && !collectScene.__sfPhase5Wrapped) {
      function collectSceneWithPhase5(...args) {
        const scene = collectScene.apply(this, args) || {};
        scene.rendering = scene.rendering && typeof scene.rendering === "object" ? scene.rendering : {};
        scene.rendering.naturalLightPhase5 = {
          schema: { id: "skyforge.natural-light.phase5", version: 1 },
          camera: { ...state.cameraOverrides },
          clouds: { ...state.cloudOverrides },
          quality: { ...state.qualityOverrides }
        };
        return scene;
      }
      collectSceneWithPhase5.__sfPhase5Wrapped = true;
      collectSceneWithPhase5.__sfPhase5Original = collectScene;
      root.sfCollectScene = collectSceneWithPhase5;
    }

    ["sfNormalizeSkyForgeScene", "sfApplyScene", "sfApplySkyForgeScene"].forEach((name) => {
      wrapAfter(name, (args, result) => {
        const scene = result && typeof result === "object" ? result : args[0];
        const saved = scene?.rendering?.naturalLightPhase5;
        if (!saved) return;
        state.cameraOverrides = { ...(saved.camera || {}) };
        state.cloudOverrides = { ...(saved.clouds || {}) };
        state.qualityOverrides = { preset: "production", ...(saved.quality || {}) };
        if (state.payload) requestPipeline(state.payload).catch(() => {});
      });
    });
  }

  function install() {
    if (state.installed || !root?.document) return;
    state.installed = true;
    ensureCanvas();
    syncLegacyCanvas();
    installHostHooks();
    root.addEventListener("skyforge:natural-light-updated", handleNaturalLightUpdated);
    root.addEventListener("skyforge:natural-light-controls", handleNaturalLightControls);
    state.hookTimer = root.setInterval(installHostHooks, 1000);
    if (typeof root.ResizeObserver === "function" && state.canvas?.parentElement) {
      state.resizeObserver = new root.ResizeObserver(() => {
        syncCanvasSize();
        scheduleAnimation();
      });
      state.resizeObserver.observe(state.canvas.parentElement);
    }
    const current = root.SkyForgeNaturalLightPreview?.getState?.();
    if (current?.evaluation) {
      state.payload = {
        input: current.input,
        evaluation: current.evaluation,
        skyViewLut: current.skyViewLut,
        transmittanceLut: current.transmittanceLut,
        multipleScatteringLut: current.multipleScatteringLut
      };
      requestPipeline(state.payload).catch(() => {});
    }
    emit("skyforge:natural-light-phase5-status", { status: "installed", clientVersion: CLIENT_VERSION });
  }

  function destroy() {
    state.abortController?.abort();
    state.resizeObserver?.disconnect();
    root?.clearInterval(state.hookTimer);
    if (state.animationFrame) root?.cancelAnimationFrame?.(state.animationFrame);
    root?.removeEventListener("skyforge:natural-light-updated", handleNaturalLightUpdated);
    root?.removeEventListener("skyforge:natural-light-controls", handleNaturalLightControls);
    state.canvas?.remove();
    state.installed = false;
    const legacyCanvas = root?.document?.getElementById("sf-physical-sky-canvas");
    if (legacyCanvas) legacyCanvas.style.opacity = "";
  }

  function setCamera(overrides = {}) {
    state.cameraOverrides = { ...state.cameraOverrides, ...overrides };
    if (state.payload) requestPipeline(state.payload).catch(() => {});
    return { ...state.cameraOverrides };
  }

  function setClouds(overrides = {}) {
    state.cloudOverrides = { ...state.cloudOverrides, ...overrides };
    if (state.payload) requestPipeline(state.payload).catch(() => {});
    return { ...state.cloudOverrides };
  }

  function setQuality(presetOrOverrides) {
    state.qualityOverrides = typeof presetOrOverrides === "string"
      ? { preset: presetOrOverrides }
      : { ...state.qualityOverrides, ...(presetOrOverrides || {}) };
    if (state.payload) requestPipeline(state.payload).catch(() => {});
    return { ...state.qualityOverrides };
  }

  function setEnabled(enabled) {
    state.enabled = Boolean(enabled);
    syncLegacyCanvas();
    if (state.enabled) scheduleAnimation();
    return state.enabled;
  }

  function getState() {
    return {
      installed: state.installed,
      enabled: state.enabled,
      clientVersion: CLIENT_VERSION,
      pipeline: state.pipeline,
      currentExposureEv: state.currentExposureEv,
      cameraOverrides: { ...state.cameraOverrides },
      cloudOverrides: { ...state.cloudOverrides },
      qualityOverrides: { ...state.qualityOverrides },
      visualizationMode: state.visualizationMode
    };
  }

  return {
    CLIENT_VERSION,
    install,
    destroy,
    setCamera,
    setClouds,
    setQuality,
    setEnabled,
    getState,
    requestPipeline
  };
});
