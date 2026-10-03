const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const url = s => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const cameraUrl = url(source('src/client/viewport/camera.js'));
const gizmoModule = () => import(url(source('src/client/viewport/sun-gizmo.js').replace("'./camera.js'", JSON.stringify(cameraUrl))));
const close = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('sun projection and dragging agree across perspective and orthographic views', async () => {
  const { normalizeCamera, cameraBasis, sunDirection } = await import(cameraUrl);
  const { projectSun, sunAtPointer } = await gizmoModule();
  for (const projection of ['perspective', 'orthographic']) for (const yaw of [-1, 0, 2]) for (const aspect of [0.7, 2]) {
    const camera = normalizeCamera({ projection, yaw, pitch: 0.2 });
    const sun = sunAtPointer(camera, 0.2, -0.3, aspect, 75);
    const point = projectSun(sun, camera, aspect, 75);
    close(point.x, 0.2); close(point.y, -0.3); assert.equal(point.behind, false);
    assert.ok(sun.azimuth >= 0 && sun.azimuth < 360);
    assert.ok(sun.elevation >= -90 && sun.elevation <= 90);
    assert.ok(cameraBasis(camera).forward.reduce((n, v, i) => n + v * sunDirection(sun)[i], 0) > 0);
  }
});

test('drag direction wraps azimuth, remains finite at poles and bounds orthographic rays', async () => {
  const { normalizeCamera } = await import(cameraUrl);
  const { sunAtPointer } = await gizmoModule();
  for (const projection of ['perspective', 'orthographic']) for (const pitch of [-1.56, 0, 1.56]) for (const x of [-100, 0, 100]) {
    const sun = sunAtPointer(normalizeCamera({ projection, pitch }), x, 100, 2, 120, 359);
    assert.ok(Number.isFinite(sun.azimuth) && Number.isFinite(sun.elevation));
    assert.ok(sun.azimuth >= 0 && sun.azimuth < 360);
    assert.ok(sun.elevation >= -90 && sun.elevation <= 90);
  }
  const sun = sunAtPointer(normalizeCamera({ yaw: 0, pitch: 0 }), 0, 0, 1, 60);
  close(sun.azimuth, 0); close(sun.elevation, 0);
});

test('offscreen and rear-facing suns keep a reachable marker including small views', async () => {
  const { normalizeCamera } = await import(cameraUrl);
  const { sunMarker } = await gizmoModule();
  for (const [width, height] of [[1200, 600], [600, 1200], [20, 20]]) for (const azimuth of [0, 90, 180, 270]) for (const elevation of [-90, 0, 90]) {
    const marker = sunMarker({ azimuth, elevation }, normalizeCamera(), width, height, 60);
    assert.ok(marker.x >= 0 && marker.x <= width);
    assert.ok(marker.y >= 0 && marker.y <= height);
    assert.ok(Number.isFinite(marker.angle));
  }
  assert.equal(sunMarker({ azimuth: 180, elevation: 0 }, normalizeCamera({ yaw: 0, pitch: 0 }), 800, 600).offscreen, true);
  assert.ok(sunMarker({ azimuth: 135, elevation: 0 }, normalizeCamera({ yaw: 0, pitch: 0 }), 800, 600).x > 400, 'rear east direction stays on the right');
  assert.ok(sunMarker({ azimuth: 225, elevation: 0 }, normalizeCamera({ yaw: 0, pitch: 0 }), 800, 600).x < 400, 'rear west direction stays on the left');
});

async function fixture() {
  const { SkyForgeStore } = await import(url(source('src/client/core/state-store.js')));
  const camera = await import(cameraUrl);
  const { SunGizmo, sunMarker, sunAtPointer } = await gizmoModule();
  const { ViewportNavigation } = await import(url(source('src/client/viewport/navigation.js').replace("'./camera.js'", JSON.stringify(cameraUrl))));
  const store = new SkyForgeStore({ storage: null });
  store.set('viewport.camera', camera.normalizeCamera({ yaw: 0, pitch: 0 }), { record: false });
  store.set('sun', { ...store.get('sun'), ...sunAtPointer(store.get('viewport.camera'), 0, 0.3, 2, 60) }, { record: false });
  const handlers = new Map(), captures = new Set(), classes = new Set();
  const root = {
    addEventListener: (type, fn) => { const list = handlers.get(type) || []; list.push(fn); handlers.set(type, list); },
    removeEventListener: (type, fn) => handlers.set(type, handlers.get(type).filter(x => x !== fn))
  };
  const canvas = { getBoundingClientRect: () => ({ left: 40, top: 20, width: 800, height: 400 }), clientHeight: 400,
    focus() {}, setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) };
  const marker = { classList: { add: v => classes.add(v), remove: v => classes.delete(v), toggle: (v, yes) => yes ? classes.add(v) : classes.delete(v) },
    style: { setProperty() {} }, setAttribute() {} };
  const gizmo = new SunGizmo(canvas, marker, { store, root, getCamera: () => store.get('viewport.camera'), getFov: () => 60, isActive: () => true, invalidate() {} });
  const navigation = new ViewportNavigation(canvas, { root, getCamera: () => store.get('viewport.camera'), getFov: () => 60,
    preview() {}, commit: (value, label) => store.set('viewport.camera', value, { label }) });
  const emit = (type, options = {}) => {
    const e = { target: canvas, button: 0, pointerId: 1, clientX: 440, clientY: 160, preventDefault() {},
      stopImmediatePropagation() { this.stopped = true; }, ...options };
    for (const fn of handlers.get(type) || []) { fn(e); if (e.stopped) break; }
    return e;
  };
  const position = () => { const m = sunMarker(store.get('sun'), store.get('viewport.camera'), 800, 400, 60); return { clientX: m.x + 40, clientY: m.y + 20 }; };
  return { store, gizmo, navigation, emit, position, captures, handlers, canvas,
    dispose() { gizmo.dispose(); navigation.dispose(); store.destroy(); } };
}

test('one sun drag updates the store live and commits exactly one undo entry', async () => {
  const f = await fixture();
  try {
    const before = f.store.get('sun'), camera = f.store.get('viewport.camera'), p = f.position();
    f.emit('pointerdown', p);
    for (let i = 1; i <= 10; i++) f.emit('pointermove', { clientX: p.clientX + i * 5, clientY: p.clientY - i * 3 });
    const after = f.store.get('sun'); assert.notDeepEqual(after, before); assert.equal(f.store.history.length, 0);
    assert.equal(after.intensity, before.intensity); assert.equal(after.temperature, before.temperature);
    f.emit('pointerup'); assert.equal(f.store.history.length, 1); assert.equal(f.captures.size, 0);
    f.store.undo(); assert.deepEqual(f.store.get('sun'), before);
    f.store.redo(); assert.deepEqual(f.store.get('sun'), after); assert.deepEqual(f.store.get('viewport.camera'), camera);
  } finally { f.dispose(); }
});

test('Escape, pointer cancellation, lost capture, blur and dispose cancel without undo', async () => {
  for (const type of ['escape', 'pointercancel', 'lostpointercapture', 'blur', 'dispose']) {
    const f = await fixture();
    try {
      const before = f.store.get('sun'), p = f.position();
      f.emit('pointerdown', p); f.emit('pointermove', { clientX: p.clientX + 50, clientY: p.clientY + 25 });
      if (type === 'escape') f.emit('keydown', { key: 'Escape', code: 'Escape' });
      else if (type === 'dispose') f.gizmo.dispose(); else f.emit(type);
      f.emit('pointerup'); assert.deepEqual(f.store.get('sun'), before); assert.equal(f.store.history.length, 0);
      assert.equal(f.captures.size, 0);
    } finally { f.dispose(); }
  }
});

test('plain clicks and other pointers do not move the sun; Alt and MMB retain navigation priority', async () => {
  const f = await fixture();
  try {
    const before = f.store.get('sun'), p = f.position();
    f.emit('pointerdown', p); f.emit('pointerup'); assert.equal(f.store.history.length, 0);
    f.emit('pointerdown', { clientX: 80, clientY: 380 }); f.emit('pointermove', p); f.emit('pointerup');
    assert.deepEqual(f.store.get('sun'), before);
    f.emit('pointerdown', p); f.emit('pointermove', { pointerId: 2, clientX: p.clientX + 100, clientY: p.clientY });
    assert.deepEqual(f.store.get('sun'), before); f.emit('pointercancel');
    for (const modifiers of [{ altKey: true }, { button: 1 }, { altKey: true, shiftKey: true }]) {
      const camera = f.store.get('viewport.camera');
      f.emit('pointerdown', { ...p, ...modifiers });
      assert.equal(f.gizmo.drag, null); assert.ok(f.navigation.drag);
      f.emit('pointermove', { clientX: p.clientX + 50, clientY: p.clientY + 20 }); f.emit('pointerup');
      assert.notDeepEqual(f.store.get('viewport.camera'), camera); assert.deepEqual(f.store.get('sun'), before);
    }
  } finally { f.dispose(); }
});

test('external sun edits take precedence over a captured drag', async () => {
  const f = await fixture();
  try {
    const p = f.position(); f.emit('pointerdown', p); f.emit('pointermove', { clientX: p.clientX + 50, clientY: p.clientY });
    f.store.set('sun.elevation', 63, { label: 'Control edit' });
    f.emit('pointermove', { clientX: p.clientX + 100, clientY: p.clientY }); f.emit('pointerup');
    assert.equal(f.store.get('sun.elevation'), 63); assert.equal(f.store.history.length, 1);
    f.gizmo.dispose(); assert.ok([...f.handlers.values()].every(list => list.length === 1));
  } finally { f.dispose(); }
});

test('starting a drag after editing a focused control survives its blur', async () => {
  const f = await fixture();
  try {
    f.canvas.focus = () => f.emit('blur', { target: { tagName: 'INPUT' } });
    const before = f.store.get('sun'), p = f.position();
    f.emit('pointerdown', p); assert.ok(f.gizmo.drag); assert.equal(f.captures.size, 1);
    f.emit('pointermove', { clientX: p.clientX + 40, clientY: p.clientY - 20 }); f.emit('pointerup');
    assert.notDeepEqual(f.store.get('sun'), before); assert.equal(f.store.history.length, 1); assert.equal(f.captures.size, 0);
  } finally { f.dispose(); }
});

test('sun gesture, cancel and undo reuse the host preview without forced physical evaluations', async () => {
  const f = await fixture();
  const { LightingSync } = await import(url(source('src/client/core/lighting-sync.js')));
  const original = globalThis.SkyForgeNaturalLightPreview;
  let refreshes = 0;
  globalThis.SkyForgeNaturalLightPreview = { getState: () => ({ installed: true, enabled: true }), refresh: () => { refreshes++; } };
  const lighting = new LightingSync(f.store);
  try {
    const p = f.position(); f.emit('pointerdown', p);
    for (let i = 1; i <= 10; i++) f.emit('pointermove', { clientX: p.clientX + i * 5, clientY: p.clientY - i * 2 });
    assert.equal(lighting.timer, null); f.emit('pointerup'); f.store.undo(); f.store.redo();
    const next = f.position(); f.emit('pointerdown', next); f.emit('pointermove', { clientX: next.clientX - 30, clientY: next.clientY + 20 });
    f.emit('keydown', { key: 'Escape', code: 'Escape' });
    assert.equal(refreshes, 0); assert.equal(lighting.timer, null);
  } finally { lighting.dispose(); globalThis.SkyForgeNaturalLightPreview = original; f.dispose(); }
});
