const hasStructuredClone = typeof globalThis.structuredClone === "function";

export function cloneValue(value) {
  if (value === undefined) return undefined;
  if (hasStructuredClone) return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function normalizePath(path) {
  if (Array.isArray(path)) return path.filter(Boolean);
  if (path === "" || path == null) return [];
  return String(path).split(".").filter(Boolean);
}

function pathsOverlap(a, b) {
  const length = Math.min(a.length, b.length);
  return a.slice(0, length).every((key, index) => key === b[index]);
}

function pathPresence(object, keys) {
  let cursor = object;
  return keys.map((key) => {
    const exists = cursor != null && Object.prototype.hasOwnProperty.call(cursor, key);
    cursor = exists ? cursor[key] : undefined;
    return exists;
  });
}

function restoreEditValue(object, edit) {
  if (!edit.keys.length) return cloneValue(edit.before);
  if (edit.presence.at(-1)) return setAtPath(object, edit.keys, edit.before);

  const parents = [];
  let cursor = object;
  for (const key of edit.keys.slice(0, -1)) {
    if (!cursor || typeof cursor !== "object" || !cursor[key] || typeof cursor[key] !== "object") return object;
    parents.push([cursor, key]);
    cursor = cursor[key];
  }
  if (cursor && typeof cursor === "object") delete cursor[edit.keys.at(-1)];
  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const [parent, key] = parents[index];
    if (edit.presence[index] || Object.keys(parent[key]).length) break;
    delete parent[key];
  }
  return object;
}

export function getAtPath(object, path) {
  return normalizePath(path).reduce((value, key) => value?.[key], object);
}

export function setAtPath(object, path, value) {
  const keys = normalizePath(path);
  if (!keys.length) return cloneValue(value);
  const root = object && typeof object === "object" ? object : {};
  let cursor = root;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys.at(-1)] = cloneValue(value);
  return root;
}

export const DEFAULT_SKYFORGE_STATE = Object.freeze({
  schemaVersion: 3,
  app: {
    version: "v11",
    build: "CORE11",
    ready: false
  },
  project: {
    id: "untitled",
    name: "Untitled Sky",
    modified: false,
    createdAt: null,
    updatedAt: null
  },
  location: {
    name: "Paris, FR",
    latitude: 48.85,
    longitude: 2.35,
    altitudeMeters: 35
  },
  time: {
    date: null,
    timeOfDay: null,
    dateTime: null,
    timezoneOffsetMinutes: null
  },
  sun: {
    elevation: 7,
    azimuth: 215,
    intensity: 1.8,
    temperature: 5200,
    angularDiameter: 0.53
  },
  atmosphere: {
    model: "SkyForge Physical",
    turbidity: 2.4,
    rayleigh: 2.8,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.8,
    haze: 0.3,
    ozone: 0.6,
    aerialPerspective: 1
  },
  clouds: {
    type: "Cumulus",
    coverage: 0.62,
    density: 0.7,
    altitude: 2400,
    thickness: 800,
    erosion: 0.45,
    detail: 0.6,
    windSpeed: 8,
    windDirection: 220,
    precipitation: 0
  },
  camera: {
    fov: 60,
    exposure: 1,
    mode: "Perspective"
  },
  viewport: {
    mode: "webgl",
    camera: { yaw: 0.55, pitch: 0.22, distance: 12, target: [0, 0, 1.5], projection: "perspective" },
    grid: true,
    overlays: true,
    referenceSphere: true,
    cloudMode: "volumetric",
    cloudQuality: "low"
  },
  scene: {
    referenceObjects: {},
    selectedReferenceId: null
  },
  color: {
    workingSpace: "ACEScg",
    displayTransform: "ACES 1.3",
    whiteBalance: 6500,
    tint: 0,
    saturation: 1,
    contrast: 1
  },
  render: {
    width: 4096,
    height: 2048,
    format: "EXR",
    bitDepth: 32,
    panorama: "Equirectangular",
    passes: ["Beauty"],
    status: "idle",
    progress: 0
  },
  timeline: {
    fps: 24,
    startFrame: 1,
    endFrame: 240,
    currentFrame: 1,
    loop: true,
    playing: false,
    keyframes: {}
  },
  nodes: {
    version: 1,
    nodes: [],
    connections: []
  },
  bridge: {
    blender: {
      status: "unknown",
      connected: false,
      lastSyncAt: null,
      lastPayloadPath: null
    }
  },
  engine: {
    lighting: {
      status: "idle",
      lastEvaluationAt: null,
      error: null
    }
  }
});

function createDefaultState() {
  const state = cloneValue(DEFAULT_SKYFORGE_STATE);
  const current = new Date();
  const now = current.toISOString();
  const pad = (value) => String(value).padStart(2, "0");
  state.project.createdAt = now;
  state.project.updatedAt = now;
  state.time.date = `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}`;
  state.time.timeOfDay = `${pad(current.getHours())}:${pad(current.getMinutes())}`;
  state.time.dateTime = now;
  state.time.timezoneOffsetMinutes = -current.getTimezoneOffset();
  return state;
}

function getStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export class SkyForgeStore {
  constructor(options = {}) {
    this.historyLimit = Math.max(10, Number(options.historyLimit || 200));
    this.storageKey = options.storageKey || "skyforge.core.v11.autosave";
    this.autosaveDelay = Math.max(100, Number(options.autosaveDelay || 650));
    this.state = cloneValue(options.initialState || createDefaultState());
    this.listeners = new Set();
    this.history = [];
    this.future = [];
    this.autosaveTimer = null;
    this.activeEdit = null;
    this.storage = options.storage === undefined ? getStorage() : options.storage;
  }

  get(path = []) {
    return cloneValue(getAtPath(this.state, path));
  }

  snapshot(options = {}) {
    const snapshot = cloneValue(this.state);
    return options.committed && this.activeEdit ? restoreEditValue(snapshot, this.activeEdit) : snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(change) {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot, change);
      } catch (error) {
        console.error("SkyForge store listener failed", error);
      }
    }
  }

  beginEdit(path, options = {}) {
    this.cancelEdit();
    const store = this;
    const keys = normalizePath(path);
    const edit = {
      keys,
      path: keys.join("."),
      label: options.label || `Change ${keys.join(".") || "project"}`,
      before: cloneValue(keys.length ? getAtPath(this.state, keys) : this.state),
      presence: pathPresence(this.state, keys)
    };
    const api = {
      get active() { return store.activeEdit === edit; },
      preview: (value) => {
        if (!api.active) return false;
        const before = keys.length ? getAtPath(this.state, keys) : this.state;
        if (deepEqual(before, value)) return false;
        if (keys.length) setAtPath(this.state, keys, value);
        else this.state = cloneValue(value);
        this.notify({ type: "set", path: edit.path, label: edit.label, before: cloneValue(before), after: cloneValue(value), transient: true });
        return true;
      },
      commit: () => {
        if (!api.active) return false;
        const value = cloneValue(keys.length ? getAtPath(this.state, keys) : this.state);
        this.activeEdit = null;
        if (deepEqual(edit.before, value)) return false;
        this.touchProject(keys);
        const change = {
          type: "set", path: edit.path, label: edit.label,
          before: cloneValue(edit.before),
          after: cloneValue(keys.length ? getAtPath(this.state, keys) : this.state),
          transient: false
        };
        this.pushHistory(change);
        this.scheduleAutosave();
        this.notify(change);
        return true;
      },
      cancel: () => {
        if (!api.active) return false;
        this.activeEdit = null;
        const changed = !deepEqual(keys.length ? getAtPath(this.state, keys) : this.state, edit.before);
        this.state = restoreEditValue(this.state, edit);
        if (changed) this.notify({ type: "cancel", path: edit.path, label: edit.label, transient: true });
        return true;
      }
    };
    edit.api = api;
    this.activeEdit = edit;
    return api;
  }

  cancelEdit(path) {
    if (this.activeEdit && (path === undefined || pathsOverlap(this.activeEdit.keys, normalizePath(path)))) {
      return this.activeEdit.api.cancel();
    }
    return false;
  }

  set(path, value, options = {}) {
    const normalizedPath = normalizePath(path);
    this.cancelEdit(normalizedPath);
    const before = normalizedPath.length ? getAtPath(this.state, normalizedPath) : this.state;
    if (deepEqual(before, value)) return false;

    const change = {
      type: "set",
      path: normalizedPath.join("."),
      label: options.label || `Change ${normalizedPath.join(".") || "project"}`,
      before: cloneValue(before),
      after: cloneValue(value),
      transient: Boolean(options.transient)
    };

    if (normalizedPath.length) setAtPath(this.state, normalizedPath, value);
    else this.state = cloneValue(value);

    if (!change.transient) {
      this.touchProject(normalizedPath);
      if (options.record !== false) this.pushHistory(change);
      this.scheduleAutosave();
    }

    this.notify(change);
    return true;
  }

  replace(nextState, options = {}) {
    return this.set([], nextState, {
      label: options.label || "Replace project state",
      transient: options.transient,
      record: options.record
    });
  }

  batch(label, mutator, options = {}) {
    if (typeof mutator !== "function") throw new TypeError("mutator must be a function");
    // Mutators start from committed values so an external sun update never
    // incorporates a half-finished gesture. Unrelated engine batches keep it live.
    const before = this.snapshot({ committed: true });
    const draft = cloneValue(before);
    mutator(draft);
    if (deepEqual(before, draft)) return false;
    const edit = this.activeEdit;
    let previewValue;
    if (edit) {
      if (!deepEqual(getAtPath(before, edit.keys), getAtPath(draft, edit.keys))) this.cancelEdit();
      else previewValue = cloneValue(getAtPath(this.state, edit.keys));
    }
    this.state = draft;
    if (edit && this.activeEdit === edit) {
      if (edit.keys.length) setAtPath(this.state, edit.keys, previewValue);
      else this.state = cloneValue(previewValue);
    }
    let recordedChange = null;
    if (!options.transient) {
      this.touchProject([]);
      if (options.record !== false) {
        recordedChange = {
          type: "batch",
          path: "",
          label: label || "Batch change",
          before,
          after: this.snapshot({ committed: true }),
          transient: false
        };
        this.pushHistory(recordedChange);
      }
      this.scheduleAutosave();
    }
    this.notify(recordedChange || { type: "batch", path: "", label: label || "Batch change", transient: Boolean(options.transient) });
    return true;
  }

  touchProject(path) {
    const root = path[0] || "";
    if (root === "app" || root === "engine" || root === "bridge" || (root === "timeline" && ["currentFrame", "playing"].includes(path[1]))) return;
    if (!this.state.project) this.state.project = {};
    this.state.project.modified = true;
    this.state.project.updatedAt = new Date().toISOString();
  }

  pushHistory(change) {
    this.history.push(change);
    if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
    this.future.length = 0;
  }

  canUndo() {
    return this.history.length > 0;
  }

  canRedo() {
    return this.future.length > 0;
  }

  undo() {
    this.cancelEdit();
    const change = this.history.pop();
    if (!change) return false;
    if (change.path) setAtPath(this.state, change.path, change.before);
    else this.state = cloneValue(change.before);
    for (const related of change.related || []) setAtPath(this.state, related.path, related.before);
    this.future.push(change);
    this.scheduleAutosave();
    this.notify({ type: "undo", path: change.path, label: change.label });
    return true;
  }

  redo() {
    this.cancelEdit();
    const change = this.future.pop();
    if (!change) return false;
    if (change.path) setAtPath(this.state, change.path, change.after);
    else this.state = cloneValue(change.after);
    for (const related of change.related || []) setAtPath(this.state, related.path, related.after);
    this.history.push(change);
    this.scheduleAutosave();
    this.notify({ type: "redo", path: change.path, label: change.label });
    return true;
  }

  reset(options = {}) {
    this.cancelEdit();
    this.history.length = 0;
    this.future.length = 0;
    this.state = cloneValue(options.state || createDefaultState());
    this.scheduleAutosave();
    this.notify({ type: "reset", path: "", label: options.label || "New project" });
  }

  markSaved() {
    if (!this.state.project) this.state.project = {};
    this.state.project.modified = false;
    this.state.project.updatedAt = new Date().toISOString();
    this.scheduleAutosave();
    this.notify({ type: "saved", path: "project.modified", label: "Project saved" });
  }

  scheduleAutosave() {
    if (!this.storage) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.persist(), this.autosaveDelay);
  }

  persist() {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.snapshot({ committed: true })));
      return true;
    } catch (error) {
      console.warn("SkyForge autosave failed", error);
      return false;
    }
  }

  restore() {
    this.cancelEdit();
    if (!this.storage) return false;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return false;
      const restored = JSON.parse(raw);
      if (!restored || typeof restored !== "object") return false;
      this.state = restored;
      this.history.length = 0;
      this.future.length = 0;
      this.notify({ type: "restore", path: "", label: "Autosave restored" });
      return true;
    } catch (error) {
      console.warn("SkyForge autosave restore failed", error);
      return false;
    }
  }

  destroy() {
    this.cancelEdit();
    clearTimeout(this.autosaveTimer);
    this.listeners.clear();
  }
}

export function createSkyForgeStore(options = {}) {
  return new SkyForgeStore(options);
}
