import { cloneValue, getAtPath, setAtPath } from "./state-store.js";

function requestFrame(callback) {
  return typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame(callback) : globalThis.setTimeout(() => callback(Date.now()), 16);
}
function cancelFrame(handle) {
  if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle);
  else globalThis.clearTimeout(handle);
}
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function interpolateValue(a, b, t, interpolation = "linear") {
  if (interpolation === "step" || interpolation === "constant") return cloneValue(t < 1 ? a : b);
  const amount = interpolation === "smooth" ? t * t * (3 - 2 * t) : t;
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * amount;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((value, index) => interpolateValue(value, b[index], amount));
  return cloneValue(t < 0.5 ? a : b);
}

// Scene paths stay explicit: loaded projects cannot animate project/engine metadata.
export function isAnimatablePath(path) {
  if (typeof path !== "string" || path.split(".").some((key) => ["__proto__", "prototype", "constructor"].includes(key))) return false;
  return /^(sun|clouds|atmosphere|camera|color)\.[\w]+$/.test(path) || /^scene\.referenceObjects\.[\w-]+\.(position|rotation|scale)$/.test(path);
}

export function sampleKeyframes(list, frame) {
  if (!list?.length) return undefined;
  if (frame <= list[0].frame) return cloneValue(list[0].value);
  if (frame >= list.at(-1).frame) return cloneValue(list.at(-1).value);
  for (let i = 0; i < list.length - 1; i++) {
    const left = list[i], right = list[i + 1];
    if (frame >= left.frame && frame <= right.frame) return interpolateValue(left.value, right.value, (frame - left.frame) / Math.max(1, right.frame - left.frame), left.interpolation);
  }
}

// Evaluate a detached committed document without changing services or history.
export function applyTimelineSnapshot(state) {
  const frame = finite(state.timeline?.currentFrame, 1);
  for (const [path, keys] of Object.entries(state.timeline?.keyframes || {})) {
    if (!isAnimatablePath(path) || !Array.isArray(keys)) continue;
    if (path.startsWith("scene.referenceObjects.") && !getAtPath(state, path.split(".").slice(0, 3))) continue;
    const list = keys.filter((key) => Number.isFinite(Number(key.frame)) && key.value !== undefined).sort((a, b) => a.frame - b.frame);
    if (list.length) setAtPath(state, path, sampleKeyframes(list, frame));
  }
  return state;
}

export class TimelineEngine {
  constructor(store, options = {}) {
    if (!store) throw new Error("TimelineEngine requires a SkyForge store");
    this.store = store;
    this.listeners = new Set();
    this.keyframes = new Map();
    this.playing = false;
    this.frameHandle = null;
    this.lastTimestamp = null;
    this.accumulator = 0;
    this.applying = false;
    this.syncState(store.snapshot(), false);
    if (options.startFrame !== undefined || options.endFrame !== undefined || options.fps !== undefined || options.currentFrame !== undefined) {
      this.startFrame = finite(options.startFrame, this.startFrame);
      this.endFrame = Math.max(this.startFrame, finite(options.endFrame, this.endFrame));
      this.fps = clamp(finite(options.fps, this.fps), 1, 240);
      this.currentFrame = clamp(finite(options.currentFrame, this.currentFrame), this.startFrame, this.endFrame);
    }
    if (options.loop !== undefined) this.loop = Boolean(options.loop);
    if (["startFrame", "endFrame", "fps", "currentFrame", "loop"].some((key) => options[key] !== undefined)) {
      this.store.batch("Initialize timeline options", (draft) => {
        draft.timeline = { ...draft.timeline, startFrame: this.startFrame, endFrame: this.endFrame, fps: this.fps, currentFrame: this.currentFrame, loop: this.loop };
      }, { transient: true, record: false });
    }
    this.unsubscribe = store.subscribe((state, change) => {
      if (this.applying) return;
      const path = change?.path || "";
      if (path && path !== "timeline" && !path.startsWith("timeline.")) return;
      const previous = JSON.stringify(this.serializeKeyframes());
      this.syncState(state);
      const replaced = ["reset", "restore"].includes(change?.type) || (change?.type === "set" && !path);
      if (replaced) this.pause();
      if (previous !== JSON.stringify(this.serializeKeyframes()) || replaced) this.applyFrame(this.currentFrame);
      this.emit("sync");
    });
    this.onVisibility = () => { if (globalThis.document?.hidden) this.pause(); };
    globalThis.document?.addEventListener("visibilitychange", this.onVisibility);
    // An autosave made during playback opens paused, with its saved frame intact.
    this.pause();
    // Reconstruct the current pose from committed tracks after autosave restore.
    // Saved derived values may come from an interrupted keyframe preview.
    this.applyFrame(this.currentFrame);
  }

  syncState(state, emit = true) {
    const data = state.timeline || {};
    this.startFrame = Math.max(0, Math.floor(finite(data.startFrame, 1)));
    this.endFrame = Math.max(this.startFrame, Math.floor(finite(data.endFrame, 240)));
    this.fps = clamp(finite(data.fps, 24), 1, 240);
    this.currentFrame = clamp(finite(data.currentFrame, this.startFrame), this.startFrame, this.endFrame);
    this.loop = data.loop !== false;
    this.loadKeyframes(data.keyframes || {}, { emit: false });
    if (emit) this.emit("settings");
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(type, detail = {}) {
    for (const listener of this.listeners) {
      try { listener({ type, ...detail, currentFrame: this.currentFrame, playing: this.playing }); }
      catch (error) { console.error("SkyForge timeline listener failed", error); }
    }
  }
  setRange(startFrame, endFrame) {
    const start = Math.max(0, Math.floor(finite(startFrame, 1))), end = Math.max(start, Math.floor(finite(endFrame, start)));
    this.store.batch("Change timeline range", (draft) => {
      draft.timeline.startFrame = start; draft.timeline.endFrame = end;
      draft.timeline.currentFrame = clamp(finite(draft.timeline.currentFrame, start), start, end);
    });
    this.seek(this.currentFrame, { record: false });
  }
  setFps(fps) { this.store.set("timeline.fps", clamp(finite(fps, 24), 1, 240), { label: "Change timeline FPS" }); }
  setLoop(loop) { this.store.set("timeline.loop", Boolean(loop), { label: "Change timeline loop" }); }
  addKeyframe(path, frame = this.currentFrame, value = undefined, options = {}) {
    if (!isAnimatablePath(path)) throw new Error("Choose an animatable scene property");
    const normalizedFrame = Math.round(clamp(finite(frame, this.currentFrame), this.startFrame, this.endFrame));
    const list = cloneValue(this.keyframes.get(path) || []).filter((key) => key.frame !== normalizedFrame);
    const keyframe = { frame: normalizedFrame, value: value === undefined ? this.store.get(path) : cloneValue(value), interpolation: ["linear", "step", "smooth"].includes(options.interpolation) ? options.interpolation : "linear" };
    if (keyframe.value === undefined) throw new Error("The selected scene property is unavailable");
    list.push(keyframe); list.sort((a, b) => a.frame - b.frame);
    const serialized = this.serializeKeyframes(); serialized[path] = list;
    this.store.set("timeline.keyframes", serialized, { label: "Add animation keyframe" });
    this.emit("keyframe:add", { path, keyframe });
    return cloneValue(keyframe);
  }
  removeKeyframe(path, frame) {
    const serialized = this.serializeKeyframes(), list = serialized[path];
    if (!list?.some((key) => key.frame === Number(frame))) return false;
    serialized[path] = list.filter((key) => key.frame !== Number(frame));
    if (!serialized[path].length) delete serialized[path];
    this.store.set("timeline.keyframes", serialized, { label: "Delete animation keyframe" });
    this.emit("keyframe:remove", { path, frame: Number(frame) }); return true;
  }
  sample(path, frame = this.currentFrame) {
    const list = this.keyframes.get(path);
    if (!list?.length) return this.store.get(path);
    return sampleKeyframes(list, frame);
  }
  applyToDraft(draft, frame = this.currentFrame) {
    for (const path of this.keyframes.keys()) {
      // Deleted objects stay deleted, even when old animation tracks remain.
      if (path.startsWith("scene.referenceObjects.") && !getAtPath(draft, path.split(".").slice(0, 3))) continue;
      setAtPath(draft, path, this.sample(path, frame));
    }
  }
  applyFrame(frame = this.currentFrame) {
    this.applying = true;
    try { this.store.batch("Evaluate animation preview", (draft) => this.applyToDraft(draft, frame), { transient: true, record: false }); }
    finally { this.applying = false; }
  }
  seek(frame, options = {}) {
    const next = clamp(finite(frame, this.startFrame), this.startFrame, this.endFrame);
    this.currentFrame = next;
    this.applying = true;
    try {
      this.store.batch("Scrub timeline", (draft) => {
        draft.timeline.currentFrame = next;
        if (options.apply !== false) this.applyToDraft(draft, next);
      }, { transient: options.record !== true, record: options.record === true });
    } finally { this.applying = false; }
    this.emit("seek", { frame: next }); return next;
  }
  play() {
    if (this.playing || globalThis.document?.hidden) return;
    this.playing = true; this.lastTimestamp = null; this.accumulator = 0;
    this.store.set("timeline.playing", true, { transient: true, record: false });
    this.emit("play"); this.frameHandle = requestFrame((timestamp) => this.tick(timestamp));
  }
  pause() {
    const wasPlaying = this.playing;
    this.playing = false;
    if (this.frameHandle != null) cancelFrame(this.frameHandle);
    this.frameHandle = null; this.lastTimestamp = null;
    this.store.set("timeline.playing", false, { transient: true, record: false });
    if (wasPlaying) this.emit("pause");
  }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  tick(timestamp) {
    if (!this.playing) return;
    if (globalThis.document?.hidden) { this.pause(); return; }
    if (this.lastTimestamp == null) this.lastTimestamp = timestamp;
    this.accumulator += clamp(timestamp - this.lastTimestamp, 0, 250);
    this.lastTimestamp = timestamp;
    const duration = 1000 / this.fps, steps = Math.floor(this.accumulator / duration);
    if (steps) {
      this.accumulator -= steps * duration;
      let next = this.currentFrame + steps;
      if (next > this.endFrame) {
        if (this.loop) next = this.startFrame + ((next - this.startFrame) % (this.endFrame - this.startFrame + 1));
        else { next = this.endFrame; this.seek(next); this.pause(); this.emit("ended"); return; }
      }
      this.seek(next); // One batch per display frame, regardless of elapsed steps.
    }
    if (this.playing) this.frameHandle = requestFrame((next) => this.tick(next));
  }
  serializeKeyframes() { return Object.fromEntries([...this.keyframes].map(([path, keys]) => [path, cloneValue(keys)])); }
  loadKeyframes(serialized = {}, options = {}) {
    this.keyframes.clear();
    for (const [path, keys] of Object.entries(serialized || {})) {
      if (!isAnimatablePath(path) || !Array.isArray(keys)) continue;
      const byFrame = new Map();
      for (const key of keys) if (Number.isFinite(Number(key.frame)) && key.value !== undefined) byFrame.set(Number(key.frame), { frame: Number(key.frame), value: cloneValue(key.value), interpolation: ["step", "constant", "smooth"].includes(key.interpolation) ? key.interpolation : "linear" });
      if (byFrame.size) this.keyframes.set(path, [...byFrame.values()].sort((a, b) => a.frame - b.frame));
    }
    if (options.emit !== false) this.emit("keyframes:load");
  }
  syncKeyframesToStore() { this.store.set("timeline.keyframes", this.serializeKeyframes(), { label: "Edit timeline keyframes" }); }
  dispose() { this.pause(); this.unsubscribe?.(); globalThis.document?.removeEventListener("visibilitychange", this.onVisibility); this.listeners.clear(); }
}
