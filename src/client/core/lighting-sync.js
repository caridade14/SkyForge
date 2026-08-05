const LIGHTING_ROOTS = new Set(["sun", "atmosphere", "clouds", "camera", "color"]);

function buildDateTime(state) {
  const explicit = state.time?.dateTime;
  const date = state.time?.date;
  const timeOfDay = state.time?.timeOfDay || "12:00";
  if (date) {
    const local = new Date(`${date}T${timeOfDay}:00`);
    if (!Number.isNaN(local.getTime())) return local.toISOString();
  }
  if (explicit && !Number.isNaN(new Date(explicit).getTime())) return explicit;
  return new Date().toISOString();
}

function buildLightingPayload(state) {
  const atmosphere = state.atmosphere || {};
  const turbidityFallback = Number(atmosphere.turbidity);
  return {
    input: {
      latitude: Number(state.location?.latitude ?? 48.85),
      longitude: Number(state.location?.longitude ?? 2.35),
      dateTime: buildDateTime(state),
      timezoneOffsetMinutes: Number(state.time?.timezoneOffsetMinutes ?? -new Date().getTimezoneOffset()),
      altitudeMeters: Number(state.location?.altitudeMeters ?? 0),
      pressureHpa: Number(atmosphere.pressureHpa ?? 1013.25),
      temperatureC: Number(atmosphere.temperatureC ?? 15),
      aerosolOpticalDepth550: Math.max(0, Math.min(5, Number(
        atmosphere.aerosolOpticalDepth550 ?? (Number.isFinite(turbidityFallback) ? turbidityFallback / 24 : 0.1)
      ))),
      angstromExponent: Number(atmosphere.angstromExponent ?? 1.3),
      mieAsymmetry: Math.max(-0.99, Math.min(0.99, Number(atmosphere.mieDirectionalG ?? 0.76))),
      aerosolSingleScatteringAlbedo: Number(atmosphere.aerosolSingleScatteringAlbedo ?? 0.92),
      groundAlbedo: Number(atmosphere.groundAlbedo ?? 0.2),
      ozoneDobsonUnits: Number(atmosphere.ozoneDobsonUnits ?? 300),
      precipitableWaterCm: Number(atmosphere.precipitableWaterCm ?? 1.5),
      multipleScatteringOrders: Number(atmosphere.multipleScatteringOrders ?? 4)
    },
    lut: { width: 48, height: 24 },
    transmittanceLut: { width: 24, height: 12, maxAltitudeMeters: 20000 },
    multipleScatteringLut: { width: 12, height: 6, maxAltitudeMeters: 20000 }
  };
}

function hostPreview() {
  const preview = globalThis.SkyForgeNaturalLightPreview;
  if (!preview || typeof preview.getState !== "function") return null;
  const state = preview.getState();
  return state?.installed && state?.enabled !== false ? preview : null;
}

export class LightingSync {
  constructor(store, options = {}) {
    if (!store) throw new Error("LightingSync requires a SkyForge store");
    this.store = store;
    this.endpoint = options.endpoint || "/api/lighting/preview";
    this.delay = Math.max(80, Number(options.delay || 220));
    this.timer = null;
    this.controller = null;
    this.latest = null;

    this.onHostUpdated = (event) => {
      this.latest = event.detail || null;
      this.setStatus("ready", null, true);
    };
    this.onHostStatus = (event) => {
      const status = event.detail?.status;
      if (status === "loading") this.setStatus("evaluating", null, false);
      if (status === "error") this.setStatus("error", event.detail?.error || "Natural Light preview failed", false);
      if (status === "disabled") this.setStatus("idle", null, false);
    };
    globalThis.addEventListener?.("skyforge:natural-light-updated", this.onHostUpdated);
    globalThis.addEventListener?.("skyforge:natural-light-status", this.onHostStatus);

    this.unsubscribe = store.subscribe((state, change) => {
      const root = String(change?.path || "").split(".")[0];
      if (LIGHTING_ROOTS.has(root)) this.schedule(state);
    });
  }

  setStatus(status, error = null, completed = false) {
    this.store.batch("Update lighting engine status", (draft) => {
      draft.engine.lighting.status = status;
      draft.engine.lighting.error = error;
      if (completed) draft.engine.lighting.lastEvaluationAt = new Date().toISOString();
    }, { transient: true, record: false });
  }

  schedule(state = this.store.snapshot()) {
    clearTimeout(this.timer);
    if (hostPreview()) return;
    this.timer = setTimeout(() => this.evaluate(state), this.delay);
  }

  async evaluate(state = this.store.snapshot()) {
    const preview = hostPreview();
    if (preview && typeof preview.refresh === "function") {
      this.setStatus("evaluating", null, false);
      try {
        const payload = await preview.refresh();
        if (payload) {
          this.latest = payload;
          this.setStatus("ready", null, true);
        }
        return payload;
      } catch (error) {
        this.setStatus("error", error.message || "Natural Light preview failed", false);
        return null;
      }
    }

    this.controller?.abort();
    this.controller = new AbortController();
    this.setStatus("evaluating", null, false);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildLightingPayload(state)),
        signal: this.controller.signal
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Lighting preview failed (${response.status})`);
      this.latest = payload;
      this.setStatus("ready", null, true);
      if (typeof globalThis.dispatchEvent === "function" && typeof globalThis.CustomEvent === "function") {
        globalThis.dispatchEvent(new CustomEvent("skyforge:lighting-preview", { detail: payload }));
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") return null;
      this.setStatus("error", error.message, false);
      return null;
    }
  }

  dispose() {
    clearTimeout(this.timer);
    this.controller?.abort();
    this.unsubscribe?.();
    globalThis.removeEventListener?.("skyforge:natural-light-updated", this.onHostUpdated);
    globalThis.removeEventListener?.("skyforge:natural-light-status", this.onHostStatus);
  }
}
