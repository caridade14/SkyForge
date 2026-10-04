const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const moduleUrl = (file) => `data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(__dirname, "..", file), "utf8")).toString("base64")}`;
const bridgeUrl = moduleUrl("src/client/core/ui-bridge.js");
const storeUrl = moduleUrl("src/client/core/state-store.js");

function range(name, label) {
  const listeners = new Map();
  let value = "0";
  const control = {
    type: "range", min: name === "Elevation" ? "-10" : "0", max: name === "Elevation" ? "90" : "360", step: "1", dataset: {},
    matches(selector) { return selector === "input,select" || selector.includes(`"${this.dataset.sfCorePath}"`); },
    querySelectorAll() { return []; },
    closest() { return { querySelector: (selector) => selector === ".sl-val" ? label : { textContent: name } }; },
    addEventListener(name, listener) { listeners.set(name, [...(listeners.get(name) || []), listener]); },
    removeEventListener(name, listener) { listeners.set(name, (listeners.get(name) || []).filter((current) => current !== listener)); },
    dispatchEvent() { throw new Error("State refresh must not dispatch legacy input handlers"); },
    fire(name, afterTargetListeners) {
      for (const listener of listeners.get(name) || []) listener();
      afterTargetListeners?.();
      this.ownerDocument?.bubble(name, this);
    },
    listenerCount(name) { return (listeners.get(name) || []).length; },
    get value() { return value; },
    set value(next) {
      // Model browser range sanitization, including fractional step rounding.
      const min = Number(this.min), max = Number(this.max), step = Number(this.step);
      const bounded = Math.max(min, Math.min(max, Number(next)));
      value = String(Number((min + Math.round((bounded - min) / step) * step).toFixed(8)));
    }
  };
  return control;
}

async function fixture(run) {
  const { SkyForgeUIBridge } = await import(bridgeUrl);
  const { SkyForgeStore } = await import(storeUrl);
  const previousDocument = global.document;
  const labels = Object.fromEntries(["v-az", "v-elev", "rp-sun", "ai-sun"].map((id) => [id, { textContent: "stale" }]));
  const elevation = range("Elevation", labels["v-elev"]), azimuth = range("Azimuth", labels["v-az"]);
  const controls = [elevation, azimuth];
  const documentListeners = new Map();
  const document = {
    querySelectorAll(selector) { return selector === "input,select" ? controls : controls.filter((control) => selector.includes(`"${control.dataset.sfCorePath}"`)); },
    getElementById(id) { return labels[id] || null; },
    addEventListener(type, listener) { documentListeners.set(type, [...(documentListeners.get(type) || []), listener]); },
    removeEventListener(type, listener) { documentListeners.set(type, (documentListeners.get(type) || []).filter((current) => current !== listener)); },
    bubble(type, target) { for (const listener of documentListeners.get(type) || []) listener({ target }); },
    dispatch(type, event) { for (const listener of documentListeners.get(type) || []) listener(event); },
    listenerCount(type) { return (documentListeners.get(type) || []).length; }
  };
  controls.forEach((control) => { control.ownerDocument = document; });
  global.document = document;
  const store = new SkyForgeStore({ storage: null });
  const statusText = { textContent: "" };
  const ui = new SkyForgeUIBridge({ store, nodeGraph: { nodes: new Map() } });
  ui.status = { dataset: {}, querySelector: () => statusText, remove() {} };
  ui.hub = { querySelector: () => null, remove() {} };
  const unsubscribe = store.subscribe((state, change) => ui.refresh(state, change));
  ui.unsubscribe = unsubscribe;
  try { await run({ ui, store, document, labels, controls, elevation, azimuth }); }
  finally { ui.dispose(); store.destroy(); global.document = previousDocument; }
}

test("Sun controls bind fractional restored values, negative elevation and metrics without changing State", async () => {
  await fixture(({ ui, store, document, labels, elevation, azimuth }) => {
    store.set("sun", { ...store.get("sun"), azimuth: 215.4, elevation: -72.6 }, { transient: true });
    const before = store.snapshot();
    ui.bindControls(document);
    assert.deepEqual(store.snapshot(), before);
    assert.equal(elevation.dataset.sfCorePath, "sun.elevation");
    assert.equal(elevation.min, "-90");
    assert.equal(elevation.max, "90");
    assert.equal(elevation.step, "0.1");
    assert.equal(elevation.value, "-72.6");
    assert.equal(azimuth.min, "0");
    assert.equal(azimuth.max, "360");
    assert.equal(azimuth.step, "0.1");
    assert.equal(azimuth.value, "215.4");
    assert.equal(labels["v-elev"].textContent, "-72.6°");
    assert.equal(labels["v-az"].textContent, "215.4°");
    assert.equal(labels["rp-sun"].textContent, "215.4° / -72.6°");
    assert.equal(labels["ai-sun"].textContent, "215.4° / -72.6°");
    assert.equal(store.history.length, 0);
  });
});

test("Sun preview and cancellation refresh controls directly, preserving full physical precision and poles", async () => {
  await fixture(({ ui, store, document, labels, elevation, azimuth }) => {
    ui.bindControls(document);
    const before = store.get("sun");
    for (const value of [-90, 90, -45.12345]) {
      store.set("sun", { ...before, azimuth: 359.9, elevation: value }, { transient: true });
      assert.equal(store.get("sun.elevation"), value);
      assert.equal(Number(elevation.value), Number(value.toFixed(1)));
      assert.equal(azimuth.value, "359.9");
      assert.equal(labels["v-elev"].textContent, `${Number(value.toFixed(1))}°`);
    }
    store.set("sun", before, { transient: true });
    assert.equal(elevation.value, String(before.elevation));
    assert.equal(azimuth.value, String(before.azimuth));
    assert.equal(store.history.length, 0);
    assert.equal(store.get("project.modified"), false);
  });
});

test("Sun inputs write State and Undo/Redo synchronize values and metrics", async () => {
  await fixture(({ ui, store, document, labels, elevation }) => {
    ui.bindControls(document);
    elevation.value = "21.7";
    elevation.fire("input");
    elevation.fire("change");
    assert.equal(store.get("sun.elevation"), 21.7);
    assert.equal(store.history.length, 1);
    assert.equal(labels["v-elev"].textContent, "21.7°");
    assert.equal(labels["ai-sun"].textContent, "215° / 21.7°");
    assert.equal(store.undo(), true);
    assert.equal(elevation.value, "7");
    assert.equal(labels["rp-sun"].textContent, "215° / 7°");
    assert.equal(store.redo(), true);
    assert.equal(elevation.value, "21.7");
    assert.equal(labels["rp-sun"].textContent, "215° / 21.7°");
  });
});

test("Newly mounted Sun input roots and duplicate control labels receive State only once", async () => {
  await fixture(({ ui, store, document, labels, controls }) => {
    ui.bindControls(document);
    store.set("sun.elevation", -29.3, { transient: true });
    const secondaryLabel = { textContent: "stale" }, secondary = range("Elevation", secondaryLabel);
    secondary.ownerDocument = document;
    controls.push(secondary);
    ui.bindControls(secondary);
    ui.bindControls(secondary);
    assert.equal(secondary.value, "-29.3");
    assert.equal(secondaryLabel.textContent, "-29.3°");
    assert.equal(labels["v-elev"].textContent, "-29.3°");
    assert.equal(secondary.listenerCount("input"), 1);
    assert.equal(secondary.listenerCount("change"), 1);
    secondary.value = "4.2";
    secondary.fire("input");
    assert.equal(store.get("sun.elevation"), 4.2);
    assert.equal(secondaryLabel.textContent, "4.2°");
    assert.equal(labels["v-elev"].textContent, "4.2°");
  });
});

test("Sun document bubbling restores fractional labels after late legacy listeners, including no-op changes", async () => {
  await fixture(({ ui, store, document, labels, elevation, azimuth }) => {
    ui.bindControls(document);
    let changes = 0;
    const legacyAzimuths = [];
    store.subscribe(() => { changes++; });
    const legacyListener = () => {
      labels["v-az"].textContent = `${Math.round(Number(azimuth.value))}°`;
      labels["v-elev"].textContent = `${Number(elevation.value).toFixed(1)}°`;
      legacyAzimuths.push(labels["v-az"].textContent);
      for (const id of ["rp-sun", "ai-sun"]) labels[id].textContent = `${labels["v-az"].textContent} / ${labels["v-elev"].textContent}`;
    };
    for (const control of [azimuth, elevation]) for (const type of ["input", "change"]) control.addEventListener(type, legacyListener);
    azimuth.value = "330.2";
    azimuth.fire("input");
    elevation.value = "-8.3";
    elevation.fire("input");
    assert.deepEqual(legacyAzimuths, ["330°", "330°"], "late target handlers round azimuth before document bubbling");
    assert.equal(labels["v-az"].textContent, "330.2°");
    assert.equal(labels["v-elev"].textContent, "-8.3°");
    assert.equal(labels["rp-sun"].textContent, "330.2° / -8.3°");
    assert.equal(labels["ai-sun"].textContent, "330.2° / -8.3°");
    azimuth.fire("change");
    elevation.fire("change");
    assert.deepEqual(legacyAzimuths, ["330°", "330°", "330°", "330°"]);
    assert.equal(labels["v-az"].textContent, "330.2°");
    assert.equal(labels["rp-sun"].textContent, "330.2° / -8.3°");
    assert.equal(store.history.length, 2);
    assert.equal(changes, 2, "readout repair never writes State or dispatches input events");
    assert.equal(document.listenerCount("input"), 1, "one bubble listener serves both Sun controls");
    assert.equal(document.listenerCount("change"), 1);
  });
});

test("Sun document listeners retain their owner document and are removed on disposal", async () => {
  await fixture(({ ui, store, document, labels, azimuth }) => {
    ui.bindControls(document);
    ui.bindControls(document);
    azimuth.addEventListener("input", () => { labels["v-az"].textContent = "rounded"; });
    azimuth.value = "330.2";
    const decoy = { querySelectorAll() { throw new Error("Readout repair used a different document"); } };
    try {
      azimuth.fire("input", () => { global.document = decoy; });
      assert.equal(labels["v-az"].textContent, "330.2°");
    } finally { global.document = document; }
    assert.equal(document.listenerCount("input"), 1);
    assert.equal(document.listenerCount("change"), 1);
    ui.dispose();
    assert.equal(document.listenerCount("input"), 0);
    assert.equal(document.listenerCount("change"), 0);
    azimuth.value = "330.3";
    azimuth.fire("input");
    assert.equal(labels["v-az"].textContent, "rounded", "disposed bridges do not touch readouts");
    assert.equal(store.get("sun.azimuth"), 330.2, "disposed controls no longer write into the old Store");
    assert.equal(store.history.length, 1);
  });
});

test("UI Bridge removes keyboard ownership and dynamically mounted control handlers on disposal", async () => {
  await fixture(({ ui, store, document, controls, elevation }) => {
    ui.bindControls(document); ui.bindKeyboard(); ui.bindKeyboard();
    assert.equal(document.listenerCount("keydown"), 1);
    const dynamic = range("Azimuth", { textContent: "" }); dynamic.ownerDocument = document; controls.push(dynamic); ui.bindControls(dynamic);
    assert.equal(dynamic.listenerCount("input"), 1); assert.equal(dynamic.listenerCount("change"), 1);
    elevation.value = "24"; elevation.fire("input");
    const key = (key) => ({ key, ctrlKey: true, metaKey: false, shiftKey: false, preventDefault() {}, target: { closest: () => null } });
    document.dispatch("keydown", key("z")); assert.equal(store.get("sun.elevation"), 7);
    const before = store.snapshot(); ui.dispose();
    assert.equal(document.listenerCount("keydown"), 0); assert.equal(dynamic.listenerCount("input"), 0); assert.equal(dynamic.listenerCount("change"), 0); assert.equal(elevation.listenerCount("input"), 0);
    elevation.value = "30"; elevation.fire("input"); dynamic.value = "90"; dynamic.fire("change"); document.dispatch("keydown", key("z"));
    assert.deepEqual(store.snapshot(), before);
    ui.bindControls(document); ui.bindKeyboard(); assert.equal(document.listenerCount("keydown"), 0); assert.equal(dynamic.listenerCount("input"), 0);
  });
});

test("Rebooting the bridge attaches controls to the new Store and leaves the disposed Store untouched", async () => {
  await fixture(({ ui, store, document, elevation }) => {
    ui.bindControls(document); elevation.value = "21"; elevation.fire("input"); const previous = store.snapshot(); ui.dispose();
    const nextStore = new store.constructor({ storage: null }), nextUI = new ui.constructor({ store: nextStore });
    try {
      nextUI.bindControls(document); assert.equal(elevation.listenerCount("input"), 1);
      elevation.value = "12"; elevation.fire("input"); elevation.fire("change");
      assert.equal(nextStore.get("sun.elevation"), 12); assert.equal(nextStore.history.length, 1); assert.deepEqual(store.snapshot(), previous);
    } finally { nextUI.dispose(); nextStore.destroy(); }
  });
});

test("Queued control mutations cannot recreate disposed listeners", async () => {
  await fixture(({ ui, document }) => {
    const previous = global.MutationObserver; let callback, disconnected = false;
    global.MutationObserver = class { constructor(fn) { callback = fn; } observe() {} disconnect() { disconnected = true; } };
    try {
      ui.observe(); ui.bindKeyboard(); ui.dispose(); assert.equal(disconnected, true);
      const late = range("Elevation", { textContent: "" }); late.ownerDocument = document; late.nodeType = 1;
      callback([{ addedNodes: [late] }]); assert.equal(late.listenerCount("input"), 0); assert.equal(document.listenerCount("keydown"), 0);
    } finally { global.MutationObserver = previous; }
  });
});
