import { cloneValue } from "./state-store.js";

function requestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(callback);
  return globalThis.setTimeout(() => callback(Date.now()), 16);
}

function cancelFrame(handle) {
  if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle);
  else globalThis.clearTimeout(handle);
}

function interpolateValue(a, b, t, interpolation = "linear") {
  if (interpolation === "step") return cloneValue(t < 1 ? a : b);
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.map((value, index) => interpolateValue(value, b[index], t, interpolation));
  }
  return cloneValue(t < 0.5 ? a : b);
}

export class TimelineEngine {
  constructor(store, options = {}) {
    if (!store) throw new Error("TimelineEngine requires a SkyForge store");
    this.store = store;
    this.fps = Number(options.fps || store.get("timeline.fps") || 24);
    this.startFrame = Number(options.startFrame || store.get("timeline.startFrame") || 1);
    this.endFrame = Number(options.endFrame || store.get("timeline.endFrame") || 240);
    this.currentFrame = Number(options.currentFrame || store.get("timeline.currentFrame") || this.startFrame);
    this.loop = options.loop ?? store.get("timeline.loop") ?? true;
    this.playing = false;
    this.keyframes = new Map();
    this.listeners = new Set();
    this.frameHandle = null;
    this.lastTimestamp = null;
    this.accumulator = 0;
    this.loadKeyframes(store.get("timeline.keyframes") || {});
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, detail = {}) {
    const event = { type, ...detail, currentFrame: this.currentFrame, playing: this.playing };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("SkyForge timeline listener failed", error);
      }
    }
  }

  setRange(startFrame, endFrame) {
    const start = Math.max(0, Math.floor(Number(startFrame)));
    const end = Math.max(start, Math.floor(Number(endFrame)));
    this.startFrame = start;
    this.endFrame = end;
    this.store.batch("Change timeline range", (draft) => {
      draft.timeline.startFrame = start;
      draft.timeline.endFrame = end;
      draft.timeline.currentFrame = Math.min(Math.max(draft.timeline.currentFrame, start), end);
    });
    this.seek(this.currentFrame, { apply: true, record: false });
  }

  setFps(fps) {
    const nextFps = Math.min(240, Math.max(1, Number(fps) || 24));
    this.fps = nextFps;
    this.store.set("timeline.fps", nextFps, { label: "Change timeline FPS" });
    this.emit("fps", { fps: nextFps });
  }

  addKeyframe(path, frame = this.currentFrame, value = undefined, options = {}) {
    const normalizedFrame = Math.floor(Number(frame));
    const keyframeValue = value === undefined ? this.store.get(path) : cloneValue(value);
    const list = this.keyframes.get(path) || [];
    const existingIndex = list.findIndex((keyframe) => keyframe.frame === normalizedFrame);
    const keyframe = {
      frame: normalizedFrame,
      value: keyframeValue,
      interpolation: options.interpolation || "linear"
    };
    if (existingIndex >= 0) list[existingIndex] = keyframe;
    else list.push(keyframe);
    list.sort((a, b) => a.frame - b.frame);
    this.keyframes.set(path, list);
    this.syncKeyframesToStore();
    this.emit("keyframe:add", { path, keyframe: cloneValue(keyframe) });
    return cloneValue(keyframe);
  }

  removeKeyframe(path, frame) {
    const list = this.keyframes.get(path);
    if (!list) return false;
    const next = list.filter((keyframe) => keyframe.frame !== Number(frame));
    if (next.length === list.length) return false;
    if (next.length) this.keyframes.set(path, next);
    else this.keyframes.delete(path);
    this.syncKeyframesToStore();
    this.emit("keyframe:remove", { path, frame: Number(frame) });
    return true;
  }

  sample(path, frame = this.currentFrame) {
    const list = this.keyframes.get(path);
    if (!list?.length) return this.store.get(path);
    if (frame <= list[0].frame) return cloneValue(list[0].value);
    if (frame >= list.at(-1).frame) return cloneValue(list.at(-1).value);
    for (let index = 0; index < list.length - 1; index += 1) {
      const left = list[index];
      const right = list[index + 1];
      if (frame < left.frame || frame > right.frame) continue;
      const span = Math.max(1, right.frame - left.frame);
      const t = (frame - left.frame) / span;
      return interpolateValue(left.value, right.value, t, right.interpolation || left.interpolation);
    }
    return cloneValue(list.at(-1).value);
  }

  applyFrame(frame = this.currentFrame) {
    for (const path of this.keyframes.keys()) {
      this.store.set(path, this.sample(path, frame), {
        label: `Animate ${path}`,
        transient: true,
        record: false
      });
    }
  }

  seek(frame, options = {}) {
    const nextFrame = Math.min(this.endFrame, Math.max(this.startFrame, Number(frame) || this.startFrame));
    this.currentFrame = nextFrame;
    this.store.set("timeline.currentFrame", nextFrame, {
      label: "Scrub timeline",
      transient: options.record === false,
      record: options.record !== false
    });
    if (options.apply !== false) this.applyFrame(nextFrame);
    this.emit("seek", { frame: nextFrame });
    return nextFrame;
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this.lastTimestamp = null;
    this.accumulator = 0;
    this.store.set("timeline.playing", true, { transient: true, record: false });
    this.emit("play");
    this.frameHandle = requestFrame((timestamp) => this.tick(timestamp));
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    if (this.frameHandle != null) cancelFrame(this.frameHandle);
    this.frameHandle = null;
    this.lastTimestamp = null;
    this.store.set("timeline.playing", false, { transient: true, record: false });
    this.emit("pause");
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  tick(timestamp) {
    if (!this.playing) return;
    if (this.lastTimestamp == null) this.lastTimestamp = timestamp;
    const delta = Math.max(0, timestamp - this.lastTimestamp);
    this.lastTimestamp = timestamp;
    this.accumulator += delta;
    const frameDuration = 1000 / this.fps;
    while (this.accumulator >= frameDuration && this.playing) {
      this.accumulator -= frameDuration;
      let nextFrame = this.currentFrame + 1;
      if (nextFrame > this.endFrame) {
        if (this.loop) nextFrame = this.startFrame;
        else {
          this.seek(this.endFrame, { record: false });
          this.pause();
          this.emit("ended");
          break;
        }
      }
      this.seek(nextFrame, { record: false });
    }
    if (this.playing) this.frameHandle = requestFrame((nextTimestamp) => this.tick(nextTimestamp));
  }

  serializeKeyframes() {
    return Object.fromEntries(
      [...this.keyframes.entries()].map(([path, keyframes]) => [path, cloneValue(keyframes)])
    );
  }

  loadKeyframes(serialized = {}) {
    this.keyframes.clear();
    for (const [path, keyframes] of Object.entries(serialized || {})) {
      if (!Array.isArray(keyframes)) continue;
      this.keyframes.set(
        path,
        keyframes
          .filter((keyframe) => Number.isFinite(Number(keyframe.frame)))
          .map((keyframe) => ({
            frame: Number(keyframe.frame),
            value: cloneValue(keyframe.value),
            interpolation: keyframe.interpolation || "linear"
          }))
          .sort((a, b) => a.frame - b.frame)
      );
    }
  }

  syncKeyframesToStore() {
    this.store.set("timeline.keyframes", this.serializeKeyframes(), {
      label: "Edit timeline keyframes"
    });
  }

  dispose() {
    this.pause();
    this.listeners.clear();
  }
}

export { interpolateValue };
