import { cloneValue } from "../core/state-store.js";

const ROOTS = ["sun", "atmosphere", "clouds", "color"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rootsOf = (state) => Object.fromEntries(ROOTS.map((root) => [root, cloneValue(state[root])]));

/** Authority: direct controls OR graph base, followed by the timeline overlay. */
export class Composition {
  constructor(api) {
    this.api = api;
    this.store = api.store;
    this.graph = api.nodeGraph;
    this.timeline = api.timeline;
    this.applying = false;
    this.error = null;
    this.listeners = new Set();
  }
  init() {
    this.previousRoots = rootsOf(this.store.snapshot());
    this.graphSignature = JSON.stringify(this.store.get("nodes"));
    this.unsubscribeGraph = this.graph.subscribe((_event, serialized) => {
      if (this.applying) return;
      this.store.set("nodes", serialized, { label: "Edit node graph" });
    });
    this.unsubscribeStore = this.store.subscribe((_state, change) => {
      if (this.applying) return;
      // Nested service notifications can precede this listener: read current state.
      const state = this.store.snapshot();
      const signature = JSON.stringify(state.nodes);
      const graphChanged = signature !== this.graphSignature;
      this.graphSignature = signature;
      if (graphChanged && state.nodes?.nodes) {
        try { this.graph.load(state.nodes, { silent: true }); this.setError(null); }
        catch (error) { this.setError(error.message); }
      }
      const currentRoots = rootsOf(state);
      const changedRoots = !same(currentRoots, this.previousRoots);
      this.previousRoots = currentRoots;
      const animation = ["Scrub timeline", "Evaluate animation preview", "Update timeline transport"].includes(change?.label);
      const restoring = ["undo", "redo", "restore", "reset"].includes(change?.type) || (!change?.path && change?.type === "set");
      const gestureCommit = this.directGesturePath && change?.path === this.directGesturePath && change?.transient === false;
      const directEdit = (changedRoots || gestureCommit) && !animation && !restoring && !graphChanged && !["saved", "cancel"].includes(change?.type);
      if (change?.type === "cancel" || restoring || gestureCommit) this.directGesturePath = null;
      if (directEdit && this.authority === "graph") {
        // A provisional direct gesture can be cancelled without changing mode.
        // Its commit chooses Direct; until then the preview stays visible.
        if (change?.transient && this.store.activeEdit) { this.directGesturePath = change.path; return; }
        // Mode follows a direct gesture without creating a second Undo entry.
        this.applying = true;
        try {
          this.store.set("scene.authority", "direct", { transient: true, record: false });
          const entry = this.store.history.at(-1);
          if (!change.transient && entry === change && entry.path) {
            // A companion scope preserves the authority in this same history
            // item, without taking a full snapshot of unrelated runtime state.
            entry.related = [...(entry.related || []), { path: "scene.authority", before: "graph", after: "direct" }];
          } else if (!change.transient && entry === change && entry.type === "batch") {
            entry.after.scene ||= {};
            entry.after.scene.authority = "direct";
          }
        }
        finally { this.applying = false; }
      }
      const tracksChanged = change?.path === "timeline.keyframes" || change?.path?.startsWith("timeline.keyframes.");
      if (this.authority === "graph" && (graphChanged || tracksChanged || restoring || change?.path === "scene.authority" || change?.label === "Change scene authority" || change?.type === "cancel")) this.evaluate();
    });
    if (this.authority === "graph") this.evaluate();
    return this;
  }
  get authority() { return this.store.get("scene.authority") === "graph" ? "graph" : "direct"; }
  setAuthority(value) {
    const next = value === "graph" ? "graph" : "direct";
    if (next === this.authority) return;
    this.store.batch("Change scene authority", (draft) => {
      draft.scene ||= {};
      if (next === "graph") draft.scene.directState = rootsOf(draft);
      else if (draft.scene.directState) for (const root of ROOTS) if (draft.scene.directState[root]) draft[root] = cloneValue(draft.scene.directState[root]);
      draft.scene.authority = next;
      this.timeline?.applyToDraft(draft, this.timeline.currentFrame);
    });
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  setError(message) {
    this.error = message;
    for (const listener of this.listeners) listener({ error: message, authority: this.authority });
  }
  evaluate() {
    if (this.applying || this.authority !== "graph") return null;
    this.applying = true;
    try {
      const state = this.store.snapshot(), base = state.scene?.directState || rootsOf(state);
      const output = this.graph.evaluateOutput({ state: { ...state, ...base } });
      if (!output || typeof output !== "object" || !["sun", "atmosphere", "clouds"].some((root) => Object.prototype.hasOwnProperty.call(output, root))) throw new Error("Output needs a scene input. Connect SkyScene through ColorGrade to Output.");
      this.store.batch("Evaluate graph preview", (draft) => {
        for (const root of ROOTS) draft[root] = { ...(base[root] || draft[root]), ...(output[root] && typeof output[root] === "object" ? cloneValue(output[root]) : {}) };
        this.timeline?.applyToDraft(draft, this.timeline.currentFrame);
      }, { transient: true, record: false });
      this.previousRoots = rootsOf(this.store.snapshot());
      this.setError(null);
      return output;
    } catch (error) { this.setError(error.message); return null; }
    finally { this.applying = false; }
  }
  copySceneToGraph() {
    const state = this.store.snapshot();
    const serialized = this.graph.serialize();
    for (const node of serialized.nodes) {
      const root = { Sun: "sun", Atmosphere: "atmosphere", Clouds: "clouds", ColorGrade: "color" }[node.type];
      if (root) for (const key of Object.keys(this.graph.registry.get(node.type).defaults)) if (state[root]?.[key] !== undefined) node.params[key] = cloneValue(state[root][key]);
    }
    this.store.set("nodes", serialized, { label: "Copy scene controls to graph" });
  }
  dispose() { this.unsubscribeGraph?.(); this.unsubscribeStore?.(); this.listeners.clear(); }
}
