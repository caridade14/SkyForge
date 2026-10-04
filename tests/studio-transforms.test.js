const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const url = s => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const cameraUrl = url(source('src/client/viewport/camera.js'));
const transformUrl = url(source('src/client/viewport/transform-math.js').replaceAll("'./camera.js'", JSON.stringify(cameraUrl)));
const geometryUrl = url(source('src/client/viewport/reference-geometry.js').replaceAll("'./camera.js'", JSON.stringify(cameraUrl)).replaceAll("'./transform-math.js'", JSON.stringify(transformUrl)));
const gizmoUrl = url(source('src/client/viewport/reference-gizmo.js').replaceAll("'./camera.js'", JSON.stringify(cameraUrl)).replaceAll("'./transform-math.js'", JSON.stringify(transformUrl)).replaceAll("'./reference-geometry.js'", JSON.stringify(geometryUrl)));
const close = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const closeVector = (a, b, epsilon) => a.forEach((v, i) => close(v, b[i], epsilon));
const modules = async () => ({ ...await import(cameraUrl), ...await import(transformUrl), ...await import(geometryUrl) });

async function fixture(projection = 'perspective', rotation = [0, 0, 0]) {
  const { SkyForgeStore } = await import(url(source('src/client/core/state-store.js')));
  const m = await modules(), { ReferenceGizmo } = await import(gizmoUrl);
  const store = new SkyForgeStore({ storage: null });
  const object = { id: 'reference', type: 'cube', name: 'Reference', position: [3, 0, 1], rotation, scale: [1, 2, 3], visible: true, locked: false };
  store.set('scene', { referenceObjects: { reference: object }, selectedReferenceId: object.id }, { record: false });
  store.set('viewport.camera', m.normalizeCamera({ projection, yaw: .7, pitch: .4, target: object.position }), { record: false });
  const handlers = new Map(), captures = new Set();
  const root = { addEventListener(type, fn) { handlers.set(type, [...(handlers.get(type) || []), fn]); },
    removeEventListener(type, fn) { handlers.set(type, handlers.get(type).filter(f => f !== fn)); } };
  const canvas = { getBoundingClientRect: () => ({ left: 40, top: 20, width: 800, height: 600 }), focus() {},
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) };
  const overlay = { setAttribute() {}, innerHTML: '' };
  const gizmo = new ReferenceGizmo(canvas, overlay, { store, root, getCamera: () => store.get('viewport.camera'), getFov: () => 60,
    isActive: () => true, invalidate() {}, commitCamera: c => store.set('viewport.camera', c) });
  const emit = (type, options = {}) => {
    const e = { target: canvas, button: 0, pointerId: 1, clientX: 440, clientY: 320, preventDefault() {}, stopImmediatePropagation() { this.stopped = true; }, ...options };
    for (const fn of handlers.get(type) || []) { fn(e); if (e.stopped) break; }
    return e;
  };
  const value = field => store.get(['scene', 'referenceObjects', object.id, field]);
  const update = () => gizmo.update(store.get('viewport.camera'), 800, 600, 60);
  const mode = (tool, space = 'global') => { store.set('viewport.transformTool', tool, { record: false }); store.set('viewport.transformSpace', space, { record: false }); update(); };
  const point = p => ({ clientX: 40 + p[0], clientY: 20 + p[1] });
  const axisDrag = (axis, pixels = 45) => {
    update(); const s = gizmo.segments.find(v => v.axis === axis && v.enabled); assert.ok(s, axis);
    const dx = s.end[0] - s.start[0], dy = s.end[1] - s.start[1], length = Math.hypot(dx, dy);
    const p = [s.start[0] + dx * .7, s.start[1] + dy * .7];
    emit('pointerdown', point(p)); assert.equal(gizmo.drag?.axis, axis);
    for (let i = 1; i <= 4; i++) emit('pointermove', point([p[0] + dx / length * pixels * i / 4, p[1] + dy / length * pixels * i / 4]));
  };
  const rotationGesture = (axis, degrees = 32) => {
    update(); const s = gizmo.segments.find(v => v.axis === axis && v.enabled); assert.ok(s, axis);
    // Choose a ring point separated from crossings with the other two rings.
    const other = gizmo.segments.filter(v => v !== s && v.enabled).flatMap(v => v.points);
    const indexed = s.points.slice(0, 96).map((p, i) => ({ p, i, clearance: Math.min(...other.map(q => Math.hypot(p[0] - q[0], p[1] - q[1]))) }));
    const start = indexed.sort((a, b) => b.clearance - a.clearance)[0];
    emit('pointerdown', point(start.p)); assert.equal(gizmo.drag?.axis, axis);
    const bases = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], index = ['x', 'y', 'z'].indexOf(axis);
    const matrix = m.rotationMatrix3(value('rotation'));
    for (let i = 1; i <= 4; i++) {
      const angle = start.i / 96 * Math.PI * 2 + degrees * i / 4 * Math.PI / 180;
      let offset = m.add(m.mul(bases[(index + 1) % 3], Math.cos(angle) * s.lengthWorld), m.mul(bases[(index + 2) % 3], Math.sin(angle) * s.lengthWorld));
      if (gizmo.space() === 'local') offset = m.rotateVector(offset, matrix);
      const projected = m.projectPoint(m.add(object.position, offset), store.get('viewport.camera'), 4 / 3, 60);
      emit('pointermove', point([(projected.x + 1) * 400, (1 - projected.y) * 300]));
    }
  };
  return { store, gizmo, overlay, captures, emit, m, value, mode, update, axisDrag, rotationGesture,
    dispose() { gizmo.dispose(); store.destroy(); } };
}

test('transformed picking matches rotated ellipsoids, boxes and finite planes with world distances', async () => {
  const m = await modules(), rotation = [13, 24, 67], matrix = m.rotationMatrix3(rotation), position = [5, 2, 3];
  const object = { id: 's', type: 'sphere', position, rotation, scale: [2, .5, 3] };
  const axis = m.rotateVector([1, 0, 0], matrix);
  const ray = { origin: m.add(position, m.mul(axis, -6)), direction: axis };
  close(m.pickReferenceObject([object], ray).distance, 4);
  object.type = 'cube'; close(m.pickReferenceObject([object], ray).distance, 4);
  const miss = { origin: m.add(ray.origin, m.rotateVector([0, .6, 0], matrix)), direction: axis };
  assert.equal(m.pickReferenceObject([object], miss), null);
  const plane = { id: 'p', type: 'plane', position: [5, 0, 0], rotation: [0, 90, 0], scale: [2, 3, 1] };
  close(m.pickReferenceObject([plane], { origin: [0, 5, 3], direction: [1, 0, 0] }).distance, 5);
  assert.equal(m.pickReferenceObject([plane], { origin: [0, 6.1, 3], direction: [1, 0, 0] }), null);
  assert.equal(m.pickReferenceObject([plane], { origin: [0, 5, 4.1], direction: [1, 0, 0] }), null);
  close(m.objectRadius(object), Math.hypot(2, .5, 3)); close(m.objectRadius(plane), Math.hypot(4, 6));
  close(m.objectRadius({ type: 'sphere', scale: [2, .5, 3] }), 3);
});

test('local movement follows rotated object axes in both projections with one Undo and committed snapshot isolation', async () => {
  for (const projection of ['perspective', 'orthographic']) for (const axis of ['x', 'y', 'z']) {
    const f = await fixture(projection, [20, 30, 40]);
    try {
      f.mode('move', 'local'); const before = f.value('position');
      const s = f.gizmo.segments.find(v => v.axis === axis); f.axisDrag(axis);
      const delta = f.value('position').map((v, i) => v - before[i]), amount = f.m.dot(delta, s.vector);
      assert.ok(Math.abs(amount) > .01); closeVector(delta, s.vector.map(v => v * amount));
      assert.deepEqual(f.store.snapshot({ committed: true }).scene.referenceObjects.reference.position, before);
      assert.equal(f.store.history.length, 0); const after = f.value('position'); f.emit('pointerup');
      assert.equal(f.store.history.length, 1); f.store.undo(); assert.deepEqual(f.value('position'), before);
      f.store.redo(); assert.deepEqual(f.value('position'), after);
    } finally { f.dispose(); }
  }
});

test('rotation rings change the requested global or local rotation with one history entry', async () => {
  for (const projection of ['perspective', 'orthographic']) for (const space of ['global', 'local']) for (const axis of ['x', 'y', 'z']) {
    const f = await fixture(projection, space === 'local' ? [12, 17, 23] : [0, 0, 0]);
    try {
      f.mode('rotate', space); assert.match(f.overlay.innerHTML, /<polyline/);
      const before = f.value('rotation'); f.rotationGesture(axis);
      const after = f.value('rotation'), expected = f.m.rotatedEuler(before, axis, 32, space === 'local');
      closeVector(f.m.rotationMatrix3(after), f.m.rotationMatrix3(expected), 1e-6);
      assert.equal(f.store.history.length, 0); assert.deepEqual(f.store.snapshot({ committed: true }).scene.referenceObjects.reference.rotation, before);
      f.emit('pointerup'); assert.equal(f.store.history.length, 1); f.store.undo(); assert.deepEqual(f.value('rotation'), before);
      f.store.redo(); assert.deepEqual(f.value('rotation'), after); assert.equal(f.captures.size, 0);
    } finally { f.dispose(); }
  }
});

test('scale handles alter one local dimension and keep positive finite bounds', async () => {
  for (const projection of ['perspective', 'orthographic']) for (const axis of ['x', 'y', 'z']) {
    const f = await fixture(projection, [20, 30, 40]);
    try {
      f.mode('scale', 'global'); assert.match(f.overlay.innerHTML, /<rect/);
      const before = f.value('scale'); f.axisDrag(axis);
      const after = f.value('scale'), index = ['x', 'y', 'z'].indexOf(axis);
      assert.ok(after[index] > before[index]); after.forEach((v, i) => { if (i !== index) assert.equal(v, before[i]); });
      assert.deepEqual(f.store.snapshot({ committed: true }).scene.referenceObjects.reference.scale, before);
      f.emit('pointerup'); assert.equal(f.store.history.length, 1); f.store.undo(); assert.deepEqual(f.value('scale'), before);
      f.store.redo(); assert.deepEqual(f.value('scale'), after);
      const history = f.store.history.length; f.axisDrag(axis, -1000); assert.ok(f.value('scale')[index] >= .01);
      f.emit('keydown', { key: 'Escape' }); assert.deepEqual(f.value('scale'), after); assert.equal(f.store.history.length, history);
    } finally { f.dispose(); }
  }
});

test('rotation and scale cancel on Escape, pointer cancellation, tool change, locking and dispose', async () => {
  for (const mode of ['rotate', 'scale']) for (const cancel of ['escape', 'pointercancel', 'tool', 'lock', 'dispose']) {
    const f = await fixture();
    try {
      f.mode(mode); const field = mode === 'rotate' ? 'rotation' : 'scale', before = f.value(field);
      if (mode === 'rotate') f.rotationGesture('x'); else f.axisDrag('x');
      assert.notDeepEqual(f.value(field), before);
      if (cancel === 'escape') f.emit('keydown', { key: 'Escape' });
      else if (cancel === 'tool') { f.mode('move'); }
      else if (cancel === 'lock') { f.store.set('scene.referenceObjects.reference.locked', true, { record: false }); f.update(); }
      else if (cancel === 'dispose') f.gizmo.dispose(); else f.emit(cancel);
      f.emit('pointerup'); assert.deepEqual(f.value(field), before); assert.equal(f.store.history.length, 0); assert.equal(f.captures.size, 0);
    } finally { f.dispose(); }
  }
});

test('G/R/S select tools on canvas while editor keys and F remain with their own editor', async () => {
  const f = await fixture();
  try {
    for (const [key, value] of [['r', 'rotate'], ['s', 'scale'], ['g', 'move']]) {
      assert.equal(f.emit('keydown', { key }).stopped, true); assert.equal(f.gizmo.mode(), value);
    }
    const editorTarget = { closest: selector => selector.includes('sf-studio') ? {} : null };
    assert.equal(f.emit('keydown', { key: 'f', target: editorTarget }).stopped, undefined);
    assert.equal(f.emit('keydown', { key: 'z', ctrlKey: true, target: editorTarget }).stopped, undefined);
    assert.equal(f.emit('keydown', { key: 'r', target: editorTarget }).stopped, undefined);
    assert.equal(f.store.history.length, 0);
  } finally { f.dispose(); }
});

test('serialized Store preserves rotated and nonuniform objects across restore and Undo/Redo', async () => {
  const f = await fixture('orthographic', [15, 29, 42]);
  try {
    f.mode('scale', 'local'); f.axisDrag('y'); f.emit('pointerup');
    const snapshot = JSON.parse(JSON.stringify(f.store.snapshot({ committed: true }))), saved = snapshot.scene.referenceObjects.reference;
    f.store.undo(); assert.notDeepEqual(f.value('scale'), saved.scale); f.store.redo(); assert.deepEqual(f.value('scale'), saved.scale);
    f.store.replace(snapshot, { record: false });
    assert.deepEqual(f.value('scale'), saved.scale); assert.deepEqual(f.value('rotation'), [15, 29, 42]);
    assert.deepEqual(f.store.get('scene.selectedReferenceId'), saved.id); assert.equal(f.gizmo.mode(), 'scale');
  } finally { f.dispose(); }
});
