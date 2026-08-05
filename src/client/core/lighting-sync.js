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
  return {
    input: {
      latitude: Number(state.location?.latitude ?? 48.85),
      longitude: Number(state.location?.longitude ?? 2.35),
      dateTime: buildDateTime(state),
      timezoneOffsetMinutes: Number(state.time?.timezoneOffsetMinutes ?? -new Date().getTimezoneOffset()),
      altitudeMeters: Number(state.location?.altitudeMeters ?? 0),
      pressureHpa: Number(atmosphere.pressureHpa ?? 1013.25),
      temperatureC: Number(atmosphere.temperatureC ?? 15),
      aerosolOpticalDepth550: Math.max(0, Math.min(5, Number(atmosphere.aerosolOpticalDepth550 ?? atmosphere.turbidity / 24 ?? 0.1))),
      angstromExponent: Number(atmosphere.angstromExponent ?? 1.3),
      mieAsymmetry: Math.max(-0.99, Math.min(0.99, Number(atmosphere.mieDirectionalG ?? 0.76))),
      aerosolSingleScatteringAlbedo: Number(atmosphere.aerosolSingleScatteringAlbedo ?? 0.92),
      groundAlbedo: Number(atmosphere.groundAlbedo ?? 0.2),
      ozoneDobsonUnits: Number(atmosphere.ozoneDobsonUnits ?? 300),
      precipitableWaterCm: Number(atmosphere.precipitableWaterCm ?? 1.5),
      multipleScatteringOrders: Number(atmosphere.multipleScatteringOrders ?? 4)
    },
    lut: { width: 64, height: 32 },
    transmittanceLut: { width: 32, height: 16, maxAltitudeMeters: 20000 },
    multipleScatteringLut: { width: 16, height: 8, maxAltitudeMeters: 20000 }
  };
}

export class LightingSync {
  constructor(store, options = {}) {
    if (!store) throw new Error("LightingSync requires a SkyForge store");
    this.store = store;
    this.endpoint = options.endpoint || "/api/lighting/preview";
    this.delay = Math.max(40, Number(options.delay || 140));
    this.timer = null;
    this.controller = null;
    this.latest = null;
    this.unsubscribe = store.subscribe((state, change) => {
      const root = String(change?.path || "").split(".")[0];
      if (LIGHTING_ROOTS.has(root)) this.schedule(state);
    });
  }

  schedule(state = this.store.snapshot()) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.evaluate(state), this.delay);
  }

  async evaluate(state = this.store.snapshot()) {
    this.controller?.abort();
    this.controller = new AbortController();
    this.store.set("engine.lighting.status", "evaluating", { transient: true, record: false });
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
      this.store.batch("Update lighting engine", (draft) => {
        draft.engine.lighting.status = "ready";
        draft.engine.lighting.lastEvaluationAt = new Date().toISOString();
        draft.engine.lighting.error = null;
      }, { transient: true, record: false });
      if (typeof globalThis.dispatchEvent === "function" && typeof globalThis.CustomEvent === "function") {
        globalThis.dispatchEvent(new CustomEvent("skyforge:lighting-preview", { detail: payload }));
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") return null;
      this.store.batch("Update lighting engine error", (draft) => {
        draft.engine.lighting.status = "error";
        draft.engine.lighting.error = error.message;
      }, { transient: true, record: false });
      return null;
    }
  }

  dispose() {
    clearTimeout(this.timer);
    this.controller?.abort();
    this.unsubscribe?.();
  }
}
