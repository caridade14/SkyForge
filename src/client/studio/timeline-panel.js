import { cloneValue } from "../core/state-store.js";

const TRACKS = [
  ["moon.azimuth", "Moon · azimuth"], ["moon.elevation", "Moon · elevation"], ["moon.phase", "Moon · phase"], ["moon.brightness", "Moon · brightness"],
  ["stars.brightness", "Stars · brightness"], ["stars.rotation", "Stars · rotation"],
  ["aurora.intensity", "Aurora · intensity"], ["aurora.azimuth", "Aurora · azimuth"], ["aurora.speed", "Aurora · speed"],
  ["rainbow.intensity", "Rainbow · intensity"], ["rainbow.rainAmount", "Rainbow · rain amount"],
  ["atmosphere.rayleigh", "Atmosphere · Rayleigh"], ["atmosphere.turbidity", "Atmosphere · turbidity"], ["atmosphere.ozone", "Atmosphere · ozone"],
  ["sun.azimuth", "Sun · azimuth"], ["sun.elevation", "Sun · elevation"], ["sun.intensity", "Sun · intensity"],
  ["camera.exposure", "Preview exposure"], ["clouds.coverage", "Clouds · coverage"], ["clouds.density", "Clouds · density"],
  ["clouds.altitude", "Clouds · altitude"], ["clouds.thickness", "Clouds · thickness"], ["clouds.erosion", "Clouds · erosion"],
  ["clouds.detail", "Clouds · detail"], ["clouds.windSpeed", "Clouds · wind speed"], ["clouds.windDirection", "Clouds · wind direction"]
];
const CSS = `.sf-studio-timeline{height:100%;display:flex;flex-direction:column;min-height:0;outline:none;color:#ccd5df;font:11px system-ui}.sf-studio-timeline .sf-tl-bar{display:flex;align-items:center;gap:7px;padding:7px;flex-wrap:wrap;border-bottom:1px solid #303941;background:#20262d}.sf-studio-timeline button,.sf-studio-timeline input,.sf-studio-timeline select{font:inherit;color:inherit;background:#161d23;border:1px solid #3b454e;border-radius:4px;padding:4px}.sf-studio-timeline button:hover,.sf-studio-timeline button:focus-visible{border-color:#ed963e}.sf-studio-timeline input[type=number]{width:55px}.sf-studio-timeline .sf-tl-scrub{flex:1;min-width:90px}.sf-studio-timeline .sf-tl-tracks{overflow:auto;min-height:0;flex:1}.sf-studio-timeline .sf-tl-row{display:flex;height:30px;align-items:center;border-bottom:1px solid #30363d}.sf-studio-timeline .sf-tl-label{width:175px;flex-shrink:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:none;background:transparent}.sf-studio-timeline .sf-tl-lane{flex:1;height:100%;position:relative;min-width:160px;margin:0 12px;background:repeating-linear-gradient(90deg,#ffffff10 0 1px,transparent 1px 10%)}.sf-studio-timeline .sf-tl-key{position:absolute;top:9px;width:11px;height:11px;padding:0;transform:translateX(-50%) rotate(45deg);border:1px solid #ffcd80;background:#e6903a;z-index:2;touch-action:none}.sf-studio-timeline .sf-tl-key.selected{background:#71d0af;border-color:white;box-shadow:0 0 0 2px #71d0af55}.sf-studio-timeline .sf-tl-head{position:absolute;top:0;bottom:0;width:1px;background:#91c8ff;pointer-events:none;z-index:1}.sf-studio-timeline .sf-tl-message{padding:5px 9px;color:#9ba9b7;font-size:10px;min-height:15px}.sf-studio-timeline .sf-tl-empty{padding:12px;color:#9ba9b7}`;
function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function keyId(path, frame) { return JSON.stringify([path, frame]); }

export class TimelinePanel {
  constructor(api) { this.api = api; this.store = api.store; this.timeline = api.timeline; this.selected = new Set(); this.activePath = "sun.azimuth"; this.drag = null; }
  init(host) {
    this.host = host;
    this.root = element("section", "sf-studio-timeline"); this.root.tabIndex = 0; this.root.setAttribute("aria-label", "Animation timeline");
    const style = element("style"); style.textContent = CSS; this.root.append(style);
    this.bar = element("div", "sf-tl-bar");
    this.play = element("button", "", "Play"); this.play.title = "Play / pause · Space"; this.play.onclick = () => this.timeline.toggle(); this.bar.append(this.play);
    this.frame = this.number("Frame", () => this.timeline.seek(this.frame.value), 0, 1000000);
    this.scrub = element("input", "sf-tl-scrub"); this.scrub.type = "range"; this.scrub.step = "1"; this.scrub.setAttribute("aria-label", "Scrub animation"); this.scrub.oninput = () => { this.timeline.pause(); this.timeline.seek(this.scrub.value); }; this.bar.append(this.scrub);
    this.start = this.number("Start", () => this.timeline.setRange(this.start.value, this.end.value), 0, 1000000);
    this.end = this.number("End", () => this.timeline.setRange(this.start.value, this.end.value), 0, 1000000);
    this.fps = this.number("FPS", () => this.timeline.setFps(this.fps.value), 1, 240);
    const loopLabel = element("label", "", "Loop "); this.loop = element("input"); this.loop.type = "checkbox"; this.loop.setAttribute("aria-label", "Loop animation"); this.loop.onchange = () => this.timeline.setLoop(this.loop.checked); loopLabel.append(this.loop); this.bar.append(loopLabel);
    this.path = element("select"); this.path.setAttribute("aria-label", "Animation property"); this.path.onchange = () => { this.activePath = this.path.value; }; this.bar.append(this.path);
    const add = element("button", "", "+ Key"); add.title = "Insert keyframe at current frame"; add.dataset.studioAction = "add-keyframe"; add.onclick = () => { try { this.timeline.addKeyframe(this.activePath); this.message.textContent = "Keyframe added. Drag a diamond; Escape cancels."; } catch (error) { this.message.textContent = error.message; } }; this.bar.append(add);
    this.interpolation = element("select"); this.interpolation.setAttribute("aria-label", "Keyframe interpolation"); for (const [value, label] of [["linear", "Linear"], ["step", "Constant"], ["smooth", "Smooth"]]) { const option = element("option", "", label); option.value = value; this.interpolation.append(option); } this.interpolation.onchange = () => this.changeInterpolation(); this.bar.append(this.interpolation);
    const remove = element("button", "", "Delete keys"); remove.onclick = () => this.deleteSelection(); this.bar.append(remove);
    this.tracks = element("div", "sf-tl-tracks"); this.message = element("div", "sf-tl-message", "Direct / Graph sets the base. Animated tracks override it at the current frame.");
    this.root.append(this.bar, this.tracks, this.message); host.append(this.root);
    this.onKey = (event) => {
      if (event.key === "Escape" && this.drag) { event.preventDefault(); event.stopPropagation(); this.finishDrag(false); }
      if (event.target.matches("input,select,textarea")) return;
      if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); this.deleteSelection(); }
      if (event.code === "Space") { event.preventDefault(); event.stopPropagation(); this.timeline.toggle(); }
    };
    this.root.addEventListener("keydown", this.onKey);
    this.onMove = (event) => this.moveDrag(event); this.onUp = () => this.finishDrag(true); this.onCancel = () => this.finishDrag(false);
    globalThis.addEventListener("pointermove", this.onMove); globalThis.addEventListener("pointerup", this.onUp); globalThis.addEventListener("pointercancel", this.onCancel); globalThis.addEventListener("blur", this.onCancel);
    this.unsubscribe = this.store.subscribe((_state, change) => {
      if (this.drag && !this.drag.edit.active) this.finishDrag(false);
      if (!change?.path || change.path.startsWith("timeline") || change.path.startsWith("scene")) this.sync();
    });
    this.unsubscribeTimeline = this.timeline.subscribe(() => this.sync());
    this.sync(); return this;
  }
  number(label, change, min, max) {
    const wrap = element("label", "", `${label} `), input = element("input"); input.type = "number"; input.min = String(min); input.max = String(max); input.step = "1"; input.setAttribute("aria-label", label); input.onchange = change; wrap.append(input); this.bar.append(wrap); return input;
  }
  availableTracks() {
    const tracks = [...TRACKS];
    for (const [id, obj] of Object.entries(this.store.get("scene.referenceObjects") || {})) for (const property of ["position", "rotation", "scale"]) tracks.push([`scene.referenceObjects.${id}.${property}`, `${obj.name || obj.kind} · ${property}`]);
    return tracks;
  }
  sync() {
    const timeline = this.timeline;
    this.play.textContent = timeline.playing ? "Pause" : "Play"; this.play.setAttribute("aria-pressed", String(timeline.playing));
    for (const [input, value] of [[this.frame, timeline.currentFrame], [this.start, timeline.startFrame], [this.end, timeline.endFrame], [this.fps, timeline.fps]]) if (document.activeElement !== input) input.value = String(Math.round(value * 100) / 100);
    this.scrub.min = String(timeline.startFrame); this.scrub.max = String(timeline.endFrame); this.scrub.value = String(timeline.currentFrame); this.loop.checked = timeline.loop;
    const available = this.availableTracks(), signature = JSON.stringify(available);
    if (signature !== this.trackOptionsSignature) {
      this.trackOptionsSignature = signature; this.path.replaceChildren();
      for (const [value, label] of available) { const option = element("option", "", label); option.value = value; this.path.append(option); }
      if (!available.some(([path]) => path === this.activePath)) this.activePath = available[0][0];
      this.path.value = this.activePath;
    }
    const serialized = timeline.serializeKeyframes(), keysSignature = JSON.stringify([serialized, timeline.startFrame, timeline.endFrame, [...this.selected]]);
    if (keysSignature !== this.keysSignature) { this.keysSignature = keysSignature; this.renderTracks(serialized, new Map(available)); }
    for (const head of this.tracks.querySelectorAll(".sf-tl-head")) head.style.left = `${this.percent(timeline.currentFrame)}%`;
  }
  percent(frame) { return (frame - this.timeline.startFrame) / Math.max(1, this.timeline.endFrame - this.timeline.startFrame) * 100; }
  renderTracks(serialized, labels) {
    this.tracks.replaceChildren();
    for (const [path, keys] of Object.entries(serialized)) {
      const row = element("div", "sf-tl-row"), label = element("button", "sf-tl-label", labels.get(path) || path); label.title = path; label.onclick = () => { this.activePath = path; this.path.value = path; };
      const lane = element("div", "sf-tl-lane"); lane.dataset.path = path;
      lane.onpointerdown = (event) => { if (event.target !== lane || event.button !== 0) return; this.timeline.pause(); this.timeline.seek(this.frameAt(event.clientX, lane)); this.root.focus(); };
      lane.append(element("div", "sf-tl-head"));
      for (const key of keys) {
        const button = element("button", `sf-tl-key${this.selected.has(keyId(path, key.frame)) ? " selected" : ""}`); button.style.left = `${this.percent(key.frame)}%`; button.dataset.path = path; button.dataset.frame = String(key.frame); button.title = `${labels.get(path) || path} · frame ${key.frame} · ${key.interpolation}`; button.setAttribute("aria-label", button.title);
        button.onpointerdown = (event) => this.startDrag(event, path, key.frame, lane);
        lane.append(button);
      }
      row.append(label, lane); this.tracks.append(row);
    }
    if (!Object.keys(serialized).length) this.tracks.append(element("div", "sf-tl-empty", "Select a property above and insert a keyframe. Transform tracks animate the entire XYZ vector."));
  }
  frameAt(x, lane) { const rect = lane.getBoundingClientRect(); return Math.round(this.timeline.startFrame + (x - rect.left) / Math.max(1, rect.width) * (this.timeline.endFrame - this.timeline.startFrame)); }
  startDrag(event, path, frame, lane) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); this.root.focus(); this.timeline.pause();
    const id = keyId(path, frame);
    if (event.shiftKey) { if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id); }
    else if (!this.selected.has(id)) this.selected = new Set([id]);
    this.activePath = path; this.path.value = path;
    const key = this.timeline.keyframes.get(path)?.find((item) => item.frame === frame); this.interpolation.value = key?.interpolation === "constant" ? "step" : key?.interpolation || "linear";
    const rect = lane.getBoundingClientRect();
    this.drag = { x: event.clientX, width: Math.max(1, rect.width), keys: this.timeline.serializeKeyframes(), selected: new Set(this.selected), edit: this.store.beginEdit("timeline.keyframes", { label: "Move animation keyframes" }) };
    this.sync();
  }
  moveDrag(event) {
    if (!this.drag || !this.drag.edit.active) return;
    event.preventDefault();
    const drag = this.drag, span = this.timeline.endFrame - this.timeline.startFrame;
    const delta = Math.round((event.clientX - drag.x) / drag.width * span), next = cloneValue(drag.keys), selected = new Set();
    for (const [path, keys] of Object.entries(drag.keys)) {
      const moving = keys.filter((key) => drag.selected.has(keyId(path, key.frame)));
      if (!moving.length) continue;
      const untouched = keys.filter((key) => !drag.selected.has(keyId(path, key.frame))), byFrame = new Map(untouched.map((key) => [key.frame, cloneValue(key)]));
      for (const key of moving) { const frame = Math.round(Math.max(this.timeline.startFrame, Math.min(this.timeline.endFrame, key.frame + delta))); byFrame.set(frame, { ...cloneValue(key), frame }); selected.add(keyId(path, frame)); }
      next[path] = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
    }
    this.selected = selected; drag.edit.preview(next); this.sync();
  }
  finishDrag(commit) {
    const drag = this.drag; if (!drag) return; this.drag = null;
    if (commit) drag.edit.commit(); else { this.selected = drag.selected; drag.edit.cancel(); }
    this.sync();
  }
  deleteSelection() {
    if (!this.selected.size) return;
    this.finishDrag(false);
    const serialized = this.timeline.serializeKeyframes();
    for (const [path, keys] of Object.entries(serialized)) { serialized[path] = keys.filter((key) => !this.selected.has(keyId(path, key.frame))); if (!serialized[path].length) delete serialized[path]; }
    this.selected.clear(); this.store.set("timeline.keyframes", serialized, { label: "Delete selected animation keys" }); this.sync();
  }
  changeInterpolation() {
    if (!this.selected.size) { this.message.textContent = "Select keyframes to change their outgoing interpolation."; return; }
    const serialized = this.timeline.serializeKeyframes();
    for (const [path, keys] of Object.entries(serialized)) for (const key of keys) if (this.selected.has(keyId(path, key.frame))) key.interpolation = this.interpolation.value;
    this.store.set("timeline.keyframes", serialized, { label: "Change keyframe interpolation" });
  }
  dispose() {
    this.finishDrag(false); this.unsubscribe?.(); this.unsubscribeTimeline?.();
    globalThis.removeEventListener("pointermove", this.onMove); globalThis.removeEventListener("pointerup", this.onUp); globalThis.removeEventListener("pointercancel", this.onCancel); globalThis.removeEventListener("blur", this.onCancel);
    this.root?.remove();
  }
}
