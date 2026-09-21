export class BlenderBridgeClient {
  constructor(store, options = {}) {
    if (!store) throw new Error("BlenderBridgeClient requires a SkyForge store");
    this.store = store;
    this.baseUrl = options.baseUrl || "/api/bridge/blender";
    this.listeners = new Set();
    this.pollHandle = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, detail = {}) {
    for (const listener of this.listeners) {
      try {
        listener({ type, ...detail });
      } catch (error) {
        console.error("SkyForge Blender bridge listener failed", error);
      }
    }
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) {
      throw new Error(payload.error || payload.detail || `Blender bridge request failed (${response.status})`);
    }
    return payload;
  }

  async health() {
    try {
      const payload = await this.request("/health", { method: "GET" });
      this.store.batch("Update Blender bridge status", (draft) => {
        draft.bridge.blender.status = payload.connected ? "connected" : "offline";
        draft.bridge.blender.connected = Boolean(payload.connected);
      }, { transient: true, record: false });
      this.emit("health", payload);
      return payload;
    } catch (error) {
      this.store.batch("Update Blender bridge status", (draft) => {
        draft.bridge.blender.status = "error";
        draft.bridge.blender.connected = false;
      }, { transient: true, record: false });
      this.emit("error", { error });
      throw error;
    }
  }

  async send(options = {}) {
    const snapshot = this.store.snapshot();
    const payload = {
      protocol: "skyforge.blender.world.v1",
      sentAt: new Date().toISOString(),
      project: snapshot.project,
      sun: snapshot.sun,
      atmosphere: snapshot.atmosphere,
      clouds: snapshot.clouds,
      color: snapshot.color,
      render: snapshot.render,
      hdriPath: options.hdriPath || null,
      rotation: Number(options.rotation || 0),
      strength: Number(options.strength ?? snapshot.sun?.intensity ?? 1)
    };
    this.store.set("bridge.blender.status", "syncing", { transient: true, record: false });
    try {
      const result = await this.request("/send", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      this.store.batch("Update Blender bridge sync", (draft) => {
        draft.bridge.blender.status = result.forwarded ? "connected" : "queued";
        draft.bridge.blender.connected = Boolean(result.forwarded);
        draft.bridge.blender.lastSyncAt = result.sentAt || new Date().toISOString();
        draft.bridge.blender.lastPayloadPath = result.spoolFile || null;
      }, { transient: true, record: false });
      this.emit("send", result);
      return result;
    } catch (error) {
      this.store.set("bridge.blender.status", "error", { transient: true, record: false });
      this.emit("error", { error });
      throw error;
    }
  }

  startPolling(intervalMs = 5000) {
    this.stopPolling();
    const run = async () => {
      try {
        await this.health();
      } catch {
        // Health polling is best effort.
      }
      this.pollHandle = setTimeout(run, Math.max(1000, Number(intervalMs)));
    };
    run();
  }

  stopPolling() {
    clearTimeout(this.pollHandle);
    this.pollHandle = null;
  }
}
