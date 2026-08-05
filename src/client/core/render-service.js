export class RenderService {
  constructor(store, options = {}) {
    if (!store) throw new Error("RenderService requires a SkyForge store");
    this.store = store;
    this.baseUrl = options.baseUrl || "/api";
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
    if (!response.ok) throw new Error(payload.error || `Render request failed (${response.status})`);
    return payload;
  }

  async preview() {
    const state = this.store.snapshot();
    return this.request("/preview", {
      method: "POST",
      body: JSON.stringify({ scene: state, settings: state.render })
    });
  }

  async queue(options = {}) {
    const state = this.store.snapshot();
    this.store.batch("Start render", (draft) => {
      draft.render.status = "queued";
      draft.render.progress = 0;
    }, { transient: true, record: false });
    try {
      const payload = await this.request("/renders", {
        method: "POST",
        body: JSON.stringify({
          projectId: state.project?.id || "default",
          name: options.name || `${state.project?.name || "SkyForge"} Render`,
          scene: state,
          settings: { ...state.render, ...(options.settings || {}) }
        })
      });
      return payload;
    } catch (error) {
      this.store.set("render.status", "error", { transient: true, record: false });
      throw error;
    }
  }

  status(id) {
    return this.request(`/renders/${encodeURIComponent(id)}`, { method: "GET" });
  }

  cancel(id) {
    return this.request(`/renders/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  }
}
