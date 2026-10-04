const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const url = s => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const cameraUrl = url(source('src/client/viewport/camera.js'));
const transformUrl = url(source('src/client/viewport/transform-math.js').replaceAll("'./camera.js'", JSON.stringify(cameraUrl)));
const geometryUrl = () => url(source('src/client/viewport/reference-geometry.js').replaceAll("'./camera.js'", JSON.stringify(cameraUrl)).replaceAll("'./transform-math.js'", JSON.stringify(transformUrl)));
const moduleAt = p => import(url(source(p).replaceAll("'./camera.js'", JSON.stringify(cameraUrl)).replaceAll("'./transform-math.js'", JSON.stringify(transformUrl)).replaceAll("'./reference-geometry.js'", JSON.stringify(geometryUrl()))));

async function fixture(projection = 'perspective') {
  const { SkyForgeStore } = await import(url(source('src/client/core/state-store.js')));
  const camera = await import(cameraUrl), geometry = await import(geometryUrl());
  const { ReferenceGizmo } = await moduleAt('src/client/viewport/reference-gizmo.js');
  const { ViewportNavigation } = await moduleAt('src/client/viewport/navigation.js');
  const store = new SkyForgeStore({ storage: null });
  const object = { id: 'cube-1', type: 'cube', name: 'Cube', position: [3, 0, 1], scale: 1, visible: true, locked: false };
  store.set('scene.referenceObjects', { [object.id]: object }, { record: false });
  store.set('viewport.camera', camera.normalizeCamera({ projection, yaw: 0.7, pitch: 0.4, target: object.position }), { record: false });
  const handlers = new Map(), captures = new Set();
  const root = { addEventListener(type, fn) { const list = handlers.get(type) || []; list.push(fn); handlers.set(type, list); },
    removeEventListener(type, fn) { handlers.set(type, handlers.get(type).filter(f => f !== fn)); } };
  const canvas = { getBoundingClientRect: () => ({ left: 40, top: 20, width: 800, height: 600 }), clientHeight: 600,
    focus() {}, setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) };
  const overlay = { setAttribute() {}, innerHTML: '' };
  let invalidations = 0, active = true;
  const gizmo = new ReferenceGizmo(canvas, overlay, { store, root, getCamera: () => store.get('viewport.camera'), getFov: () => 60,
    isActive: () => active, invalidate: () => invalidations++, commitCamera: (c, label) => store.set('viewport.camera', c, { label }) });
  const navigation = new ViewportNavigation(canvas, { root, getCamera: () => store.get('viewport.camera'), getFov: () => 60,
    preview() {}, commit: (c, label) => store.set('viewport.camera', c, { label }) });
  const emit = (type, options = {}) => {
    const e = { target: canvas, button: 0, pointerId: 1, clientX: 440, clientY: 320, preventDefault() {},
      stopImmediatePropagation() { this.stopped = true; }, ...options };
    for (const fn of handlers.get(type) || []) { fn(e); if (e.stopped) break; }
    return e;
  };
  const update = () => gizmo.update(store.get('viewport.camera'), 800, 600, 60);
  const position = () => store.get(['scene', 'referenceObjects', object.id, 'position']);
  const select = () => { emit('pointerdown'); emit('pointerup'); update(); };
  const drag = (axis = 'x', distance = 45) => {
    update(); const segment = gizmo.segments.find(s => s.axis === axis && s.enabled); assert.ok(segment, `visible ${axis} handle`);
    const dx = segment.end[0] - segment.start[0], dy = segment.end[1] - segment.start[1], length = Math.hypot(dx, dy);
    const p = { clientX: 40 + segment.start[0] + dx * 0.7, clientY: 20 + segment.start[1] + dy * 0.7 };
    emit('pointerdown', p); assert.ok(gizmo.drag, 'axis gesture owns pointer');
    for (let i = 1; i <= 5; i++) emit('pointermove', { clientX: p.clientX + dx / length * distance * i / 5, clientY: p.clientY + dy / length * distance * i / 5 });
    return p;
  };
  return { store, object, gizmo, navigation, emit, captures, handlers, canvas, overlay, geometry, select, drag, position, update,
    setActive: value => active = value, invalidations: () => invalidations,
    dispose() { gizmo.dispose(); navigation.dispose(); store.destroy(); } };
}

test('mesh click selects through the Store; background clears and hidden objects cannot be selected', async () => {
  const f = await fixture();
  try {
    f.select(); assert.equal(f.store.get('scene.selectedReferenceId'), f.object.id); assert.equal(f.store.history.length, 0);
    assert.match(f.overlay.innerHTML, /<line/);
    f.emit('pointerdown', { clientX: 41, clientY: 619 }); assert.equal(f.store.get('scene.selectedReferenceId'), null);
    f.store.set(['scene', 'referenceObjects', f.object.id, 'visible'], false, { record: false });
    f.select(); assert.equal(f.store.get('scene.selectedReferenceId'), null);
  } finally { f.dispose(); }
});

test('X/Y/Z movement in both projections previews only one coordinate and commits one Undo', async () => {
  for (const projection of ['perspective', 'orthographic']) for (const axis of ['x', 'y', 'z']) {
    const f = await fixture(projection);
    try {
      f.select(); const before = f.position(), camera = f.store.get('viewport.camera'); f.drag(axis);
      const after = f.position(), index = ['x', 'y', 'z'].indexOf(axis);
      assert.notEqual(after[index], before[index]); after.forEach((v, i) => { if (i !== index) assert.equal(v, before[i]); });
      assert.equal(f.store.history.length, 0); assert.deepEqual(f.store.snapshot({ committed: true }).scene.referenceObjects[f.object.id].position, before);
      f.emit('pointerup'); assert.equal(f.store.history.length, 1); assert.equal(f.captures.size, 0);
      f.emit('keydown', { key: 'z', metaKey: true }); assert.deepEqual(f.position(), before);
      f.emit('keydown', { key: 'z', metaKey: true, shiftKey: true }); assert.deepEqual(f.position(), after);
      assert.deepEqual(f.store.get('viewport.camera'), camera);
    } finally { f.dispose(); }
  }
});

test('Escape, pointercancel, lost capture, blur and dispose restore movement without history', async () => {
  for (const cancellation of ['escape', 'pointercancel', 'lostpointercapture', 'blur', 'dispose']) {
    const f = await fixture();
    try {
      f.select(); const before = f.position(); f.drag();
      if (cancellation === 'escape') f.emit('keydown', { key: 'Escape' });
      else if (cancellation === 'dispose') f.gizmo.dispose(); else f.emit(cancellation);
      f.emit('pointerup'); assert.deepEqual(f.position(), before); assert.equal(f.store.history.length, 0); assert.equal(f.captures.size, 0);
    } finally { f.dispose(); }
  }
});

test('Alt/MMB navigation owns reference hits and does not move the object', async () => {
  for (const options of [{ altKey: true }, { button: 1 }, { altKey: true, shiftKey: true }, { altKey: true, ctrlKey: true }]) {
    const f = await fixture();
    try {
      f.select(); const before = f.position(); f.emit('pointerdown', options);
      assert.equal(f.gizmo.drag, null); assert.ok(f.navigation.drag);
      f.emit('pointermove', { clientX: 490, clientY: 350 }); f.emit('pointerup'); assert.deepEqual(f.position(), before);
    } finally { f.dispose(); }
  }
});

test('locked objects remain selectable; no-move click and stale external edits do not create history', async () => {
  const f = await fixture();
  try {
    f.store.set(['scene', 'referenceObjects', f.object.id, 'locked'], true, { record: false }); f.select();
    assert.equal(f.store.get('scene.selectedReferenceId'), f.object.id); assert.equal(f.gizmo.segments.length, 0);
    f.store.set(['scene', 'referenceObjects', f.object.id, 'locked'], false, { record: false }); f.select(); f.update();
    const segment = f.gizmo.segments.find(s => s.enabled), p = { clientX: 40 + segment.end[0], clientY: 20 + segment.end[1] };
    f.emit('pointerdown', p); f.emit('pointerup'); assert.equal(f.store.history.length, 0);
    f.drag(); f.store.set(['scene', 'referenceObjects', f.object.id, 'position'], [8, 9, 10], { label: 'External position' });
    f.emit('pointermove', { clientX: 550 }); f.emit('pointerup'); assert.deepEqual(f.position(), [8, 9, 10]); assert.equal(f.store.history.length, 1);
  } finally { f.dispose(); }
});

test('F and frame action target the selected object; editable keys and inactive viewport defer', async () => {
  const f = await fixture();
  try {
    f.select(); f.store.set(['scene', 'referenceObjects', f.object.id, 'position'], [13, 7, 4], { record: false });
    f.emit('keydown', { key: 'f' }); assert.deepEqual(f.store.get('viewport.camera.target'), [13, 7, 4]);
    const after = f.store.get('viewport.camera'); assert.ok(after.distance < 12);
    assert.equal(f.emit('keydown', { key: 'f', target: { closest: () => ({}) } }).stopped, undefined);
    f.setActive(false); f.store.set('scene.selectedReferenceId', null, { record: false });
    assert.equal(f.emit('keydown', { key: 'z', metaKey: true }).stopped, undefined);
  } finally { f.dispose(); }
});

test('references keep a single Core Undo owner in Legacy View', async () => {
  const f = await fixture();
  try {
    f.select(); const before = f.position(); f.drag(); f.emit('pointerup'); f.setActive(false);
    assert.equal(f.emit('keydown', { key: 'z', metaKey: true }).stopped, true);
    assert.deepEqual(f.position(), before); assert.equal(f.store.history.length, 0);
  } finally { f.dispose(); }
});

test('hiding or locking an object during a gesture cancels its provisional position', async () => {
  for (const [key, value] of [['visible', false], ['locked', true]]) {
    const f = await fixture();
    try {
      f.select(); const before = f.position(); f.drag();
      f.store.set(['scene', 'referenceObjects', f.object.id, key], value, { label: `Change ${key}` }); f.update();
      f.emit('pointerup'); assert.deepEqual(f.position(), before); assert.equal(f.gizmo.drag, null); assert.equal(f.store.history.length, 1);
    } finally { f.dispose(); }
  }
});

test('object motion, cancellation and undo do not schedule Natural Light evaluations', async () => {
  const f = await fixture(); const { LightingSync } = await import(url(source('src/client/core/lighting-sync.js')));
  const lighting = new LightingSync(f.store); let calls = 0; lighting.schedule = () => calls++;
  try {
    f.select(); f.drag(); f.emit('pointerup'); f.store.undo(); f.store.redo(); f.drag(); f.emit('keydown', { key: 'Escape' });
    assert.equal(calls, 0); assert.equal(lighting.timer, null);
  } finally { lighting.dispose(); f.dispose(); }
});
