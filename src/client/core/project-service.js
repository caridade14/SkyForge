import { cloneValue } from "./state-store.js";

const FILE_FORMAT = "SkyForge Project File";
const FILE_KIND = "skyforge.project";
const FILE_VERSION = 3;
const FILE_MIME = "application/vnd.skyforge.project+json";
const RECENTS_KEY = "skyforge.core.v11.recentProjects";

function fnv1a(input) {
  let hash = 0x811c9dc5;
  const text = String(input);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safeFileName(name) {
  return String(name || "untitled-sky")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled-sky";
}

function readRecents() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(RECENTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecents(recents) {
  try {
    globalThis.localStorage?.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, 12)));
  } catch {
    // Local storage is optional.
  }
}

export class ProjectService {
  constructor(store, options = {}) {
    if (!store) throw new Error("ProjectService requires a SkyForge store");
    this.store = store;
    this.timeline = options.timeline || null;
    this.nodeGraph = options.nodeGraph || null;
    this.appVersion = options.appVersion || "v11";
    this.appBuild = options.appBuild || "CORE11";
  }

  createDocument() {
    const state = this.store.snapshot();
    if (this.timeline) state.timeline.keyframes = this.timeline.serializeKeyframes();
    if (this.nodeGraph) state.nodes = this.nodeGraph.serialize();
    const payloadText = JSON.stringify(state);
    return {
      format: FILE_FORMAT,
      kind: FILE_KIND,
      version: FILE_VERSION,
      application: {
        name: "SkyForge",
        version: this.appVersion,
        build: this.appBuild
      },
      metadata: {
        projectName: state.project?.name || "Untitled Sky",
        projectId: state.project?.id || "untitled",
        savedAt: new Date().toISOString()
      },
      checksum: `fnv1a:${fnv1a(payloadText)}`,
      payload: state
    };
  }

  validateDocument(document) {
    if (!document || typeof document !== "object") throw new Error("Invalid SkyForge document");
    const payload = document.payload || document.scene || document;
    if (!payload || typeof payload !== "object") throw new Error("SkyForge project payload is missing");
    if (document.checksum) {
      const expected = `fnv1a:${fnv1a(JSON.stringify(payload))}`;
      if (document.checksum !== expected) throw new Error("SkyForge project checksum does not match");
    }
    return payload;
  }

  loadDocument(document, options = {}) {
    const payload = cloneValue(this.validateDocument(document));
    this.store.replace(payload, { label: options.label || "Open project", record: false });
    if (this.timeline) this.timeline.loadKeyframes(payload.timeline?.keyframes || {});
    if (this.nodeGraph) {
      const serialized = payload.nodes;
      if (serialized?.nodes?.length) this.nodeGraph.load(serialized);
      else this.nodeGraph.createDefaultGraph();
    }
    this.store.markSaved();
    this.addRecent({
      name: payload.project?.name || document.metadata?.projectName || "Untitled Sky",
      id: payload.project?.id || document.metadata?.projectId || "untitled",
      openedAt: new Date().toISOString()
    });
    return payload;
  }

  loadText(text, options = {}) {
    let document;
    try {
      document = JSON.parse(String(text));
    } catch {
      throw new Error("The selected file is not valid JSON");
    }
    return this.loadDocument(document, options);
  }

  download() {
    if (typeof document === "undefined" || typeof URL === "undefined") return this.createDocument();
    const projectDocument = this.createDocument();
    const blob = new Blob([JSON.stringify(projectDocument, null, 2)], { type: FILE_MIME });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(projectDocument.metadata.projectName)}.skyforge`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.store.markSaved();
    this.addRecent({
      name: projectDocument.metadata.projectName,
      id: projectDocument.metadata.projectId,
      openedAt: new Date().toISOString()
    });
    return projectDocument;
  }

  openPicker() {
    if (typeof document === "undefined") return Promise.reject(new Error("File picker requires a browser"));
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".skyforge,.json,application/json";
      input.style.display = "none";
      input.addEventListener("change", async () => {
        try {
          const file = input.files?.[0];
          if (!file) return resolve(null);
          const payload = this.loadText(await file.text(), { label: `Open ${file.name}` });
          resolve(payload);
        } catch (error) {
          reject(error);
        } finally {
          input.remove();
        }
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  newProject(name = "Untitled Sky") {
    this.store.reset({ label: "New project" });
    this.store.batch("Name new project", (draft) => {
      draft.project.id = `project-${Date.now().toString(36)}`;
      draft.project.name = String(name || "Untitled Sky");
      draft.project.modified = false;
    }, { record: false });
    if (this.nodeGraph) this.nodeGraph.createDefaultGraph();
    if (this.timeline) this.timeline.loadKeyframes({});
    return this.store.snapshot();
  }

  addRecent(entry) {
    const recents = readRecents().filter((item) => item.id !== entry.id);
    recents.unshift(entry);
    writeRecents(recents);
  }

  getRecentProjects() {
    return readRecents();
  }
}

export { FILE_FORMAT, FILE_KIND, FILE_VERSION, FILE_MIME, fnv1a };
