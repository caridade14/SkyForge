const { clientSource } = require('./helpers/client-source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const moduleUrl = file => `data:text/javascript;base64,${Buffer.from(clientSource(file)).toString('base64')}`;
const adapterUrl = moduleUrl('src/client/core/scene-object-adapter.js');
const storeUrl = moduleUrl('src/client/core/state-store.js');

function classes(initial = '') {
  const values = new Set(initial.split(/\s+/).filter(Boolean));
  return { contains: value => values.has(value), add: value => values.add(value), remove: value => values.delete(value),
    toggle(value, force) { if (force === undefined) force = !values.has(value); force ? values.add(value) : values.delete(value); return force; } };
}
function domFixture() {
  const rows = [], listeners = new Map();
  const input = () => ({ value: '', parentElement: { querySelector: () => ({ textContent: '' }) } });
  const controls = Object.fromEntries(['tri-pos-x', 'tri-pos-y', 'tri-pos-z', 'tri-rot', 'tri-scale', 'sf-ins-readout', 'tri-selected-object', 'tri-selected-type'].map(id => [id, input()]));
  const list = {
    querySelectorAll: () => [...rows], querySelector: () => rows.find(row => row.classList.contains('sel')) || null,
    appendChild(row) { rows.push(row); row.isConnected = true; }
  };
  const createRow = value => {
    const eye = { classList: classes(value.visible === false ? 'tri-eye' : 'tri-eye on'), textContent: '*' };
    const lock = { classList: classes(value.locked ? 'tri-lock on' : 'tri-lock'), textContent: 'o' };
    return { dataset: { sfKey: value.key, sfX: String(value.x ?? 0), sfY: String(value.y ?? 0), sfZ: String(value.z ?? 0), sfScale: String(value.scale ?? 1), sfRot: String(value.rot ?? 0) },
      children: [{ textContent: value.icon || 'O' }, { textContent: value.name }, { textContent: value.type }],
      classList: classes(`tri-out-extra${value.selected ? ' sel' : ''}`),
      matches(selector) { return selector.includes('.tri-out-extra'); },
      querySelector(selector) { return selector === '.tri-eye' ? eye : selector === '.tri-lock' ? lock : null; },
      remove() { const index = rows.indexOf(this); if (index >= 0) rows.splice(index, 1); this.isConnected = false; }
    };
  };
  const document = { getElementById: id => id === 'outliner-list' ? list : controls[id] || null, querySelector: () => null };
  const root = { document, SF_VIEWPORT_3D_ACTIVE: true, legacyHistory: 0, legacyTransforms: 0,
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(value => value !== fn)); },
    emit(type, event = {}) { for (const fn of listeners.get(type) || []) fn(event); },
    sfCreateOutlinerRow: createRow, sfInsertRowIntoGroup: row => list.appendChild(row), sfCurrentTargetGroup: () => null,
    sfGetSelectedOutlinerRow: () => list.querySelector('.tri-out-extra.sel'),
    sfSyncTransformPanel(row) { const p = root.sfGetRowPosition(row); ['x', 'y', 'z'].forEach(axis => { controls[`tri-pos-${axis}`].value = p[axis]; }); },
    sfRefreshOutlinerInspector() {}, sfRefreshOutlinerCounts() {}, sfRefreshAllGroupVisibilityStates() {},
    sfClearSceneSelection() { rows.forEach(row => row.classList.remove('sel')); },
    triSelectOut(row) { root.sfClearSceneSelection(); row?.classList.add('sel'); if (row) root.sfSyncTransformPanel(row); },
    sfGetRowPosition: row => ({ x: Number(row?.dataset.sfX), y: Number(row?.dataset.sfY), z: Number(row?.dataset.sfZ) }),
    sfSetRowPosition(row, position) { for (const axis of ['x', 'y', 'z']) row.dataset[`sf${axis.toUpperCase()}`] = String(Math.round(position[axis])); },
    sfGetRowScale: row => Number(row.dataset.sfScale), sfSetRowScale: (row, value) => { row.dataset.sfScale = value; }, sfSetRowRotation() {},
    sfSetSelectedTransformFromInputs() { root.legacyTransforms++; },
    sfAddSceneObject(type, name, options = {}) { const row = createRow({ key: `old-${rows.length}`, type, name, ...options }); list.appendChild(row); return row; },
    sfUpdateSelectedFromInspector(field, value) { const row = root.sfGetSelectedOutlinerRow(); if (field === 'name') row.children[1].textContent = value; if (field === 'type') row.children[2].textContent = value; },
    sfRenameSelectedObject() {}, sfDuplicateSelectedObject() {}, sfDeleteSelectedObject() {}, sfToggleSelectedVisibility() {}, sfToggleSelectedLock() {},
    sfHistoryCapture() { root.legacyHistory++; }, sfUndo() {}, sfRedo() {}, sfFocusOutlinerRow() {},
    sfCollectOutlinerObjects: () => rows.map(row => ({ key: row.dataset.sfKey, type: row.children[2].textContent, name: row.children[1].textContent,
      ...root.sfGetRowPosition(row), scale: root.sfGetRowScale(row), visible: row.querySelector('.tri-eye').classList.contains('on'),
      locked: row.querySelector('.tri-lock').classList.contains('on'), selected: row.classList.contains('sel'), added: true })),
    sfRestoreOutlinerObjects(values) { rows.splice(0); values.forEach(value => list.appendChild(createRow(value))); const selected = rows.find(row => row.classList.contains('sel')) || rows[0]; if (selected) root.triSelectOut(selected); },
    sfInitCleanStartupScene() { rows.splice(0); },
    prompt: () => 'Renamed reference', confirm: () => true
  };
  return { root, rows, controls, list, createRow };
}
async function fixture(run) {
  const module = await import(adapterUrl), { SkyForgeStore } = await import(storeUrl);
  const store = new SkyForgeStore({ storage: null, autosaveDelay: 5 });
  const dom = domFixture(), adapter = new module.SceneObjectAdapter(store, { root: dom.root }).init();
  try { await run({ ...dom, adapter, store, ...module }); } finally { adapter.dispose(); store.destroy(); }
}

test('Coordinate adapter preserves east/north/up and fractional metres in both directions', async () => {
  const { legacyToViewportPosition, viewportToLegacyPosition } = await import(adapterUrl);
  assert.deepEqual(legacyToViewportPosition({ x: 1.25, y: 2.5, z: -3.75 }), [1.25, -3.75, 2.5]);
  assert.deepEqual(viewportToLegacyPosition([1.25, -3.75, 2.5]), { x: 1.25, y: 2.5, z: -3.75 });
  assert.deepEqual(legacyToViewportPosition([0, 0, 1]), [0, 1, 0], 'legacy north remains viewport north');
  assert.deepEqual(legacyToViewportPosition([0, 1, 0]), [0, 0, 1], 'legacy vertical becomes viewport Z');
});

test('Legacy bootstrap cannot erase restored references and unrelated clicks retain their handlers', async () => {
  await fixture(({ root, store, rows }) => {
    root.sfAddSceneObject('CUBE', 'Restored cube'); const before = store.get('scene');
    root.sfInitCleanStartupScene(); assert.deepEqual(store.get('scene'), before); assert.equal(rows.length, 1);
    assert.doesNotThrow(() => root.emit('click', { target: { closest: () => null } }));
  });
});

test('Builder creates explicit reference types with one Undo and bidirectional selection', async () => {
  await fixture(({ root, adapter, store, rows }) => {
    const row = root.sfAddSceneObject('CUBE', 'Editable cube');
    const id = row.dataset.sfReferenceId;
    assert.equal(rows.length, 1); assert.equal(store.history.length, 1);
    assert.deepEqual(store.get(['scene', 'referenceObjects', id, 'position']), [3, 0, 1]);
    assert.equal(store.get('scene.selectedReferenceId'), id);
    root.sfClearSceneSelection(); assert.equal(store.get('scene.selectedReferenceId'), null);
    root.triSelectOut(row); assert.equal(store.get('scene.selectedReferenceId'), id);
    assert.equal(store.history.length, 1, 'selection creates no Undo entry');
    assert.equal(store.undo(), true); assert.equal(rows.length, 0);
    assert.equal(store.redo(), true); assert.equal(rows.length, 1);
    adapter.select(null); assert.equal(rows[0].classList.contains('sel'), false);
  });
});

test('Numeric inspector uses Z-up decimal position and supports Undo/Redo without legacy history', async () => {
  await fixture(({ root, controls, store }) => {
    const row = root.sfAddSceneObject('SPHERE', 'Decimal sphere'), id = row.dataset.sfReferenceId;
    for (const [axis, value] of [['x', '1.125'], ['y', '-2.75'], ['z', '3.5']]) controls[`tri-pos-${axis}`].value = value;
    controls['tri-scale'].value = '1.75'; root.sfSetSelectedTransformFromInputs();
    assert.deepEqual(store.get(['scene', 'referenceObjects', id, 'position']), [1.125, -2.75, 3.5]);
    assert.deepEqual(root.sfGetRowPosition(row), { x: 1.125, y: 3.5, z: -2.75 });
    assert.equal(row.dataset.sfX, '1.125'); assert.equal(row.dataset.sfY, '3.5'); assert.equal(row.dataset.sfZ, '-2.75');
    assert.equal(store.history.length, 2); assert.equal(root.legacyTransforms, 0);
    assert.equal(store.undo(), true); assert.equal(Number(controls['tri-pos-z'].value), 1);
    assert.equal(store.redo(), true); assert.equal(Number(controls['tri-pos-z'].value), 3.5);
    root.sfHistoryCapture('Move object'); assert.equal(root.legacyHistory, 0);
    root.sfHistoryCapture('Create object'); assert.equal(root.legacyHistory, 1, 'creating a legacy type retains its history');
  });
});

test('Provisional movement updates rows while legacy persistence exports committed values, then cancels', async () => {
  await fixture(({ root, store }) => {
    const row = root.sfAddSceneObject('PLANE', 'Plane'), id = row.dataset.sfReferenceId;
    const history = store.history.length;
    const edit = store.beginEdit(['scene', 'referenceObjects', id, 'position'], { label: 'Move reference object' });
    edit.preview([4.25, 5.5, 6.75]);
    assert.deepEqual(root.sfGetRowPosition(row), { x: 4.25, y: 6.75, z: 5.5 });
    const saved = root.sfCollectOutlinerObjects()[0];
    assert.deepEqual([saved.x, saved.y, saved.z], [3, 0, 0]);
    assert.equal(store.history.length, history);
    edit.cancel(); assert.deepEqual(root.sfGetRowPosition(row), { x: 3, y: 0, z: 0 });
    const next = store.beginEdit(['scene', 'referenceObjects', id, 'position'], { label: 'Move reference object' });
    next.preview([4.25, 5.5, 6.75]); next.preview([5, 6, 7]); next.commit();
    assert.equal(store.history.length, history + 1);
    assert.equal(store.undo(), true); assert.deepEqual(root.sfGetRowPosition(row), { x: 3, y: 0, z: 0 });
    assert.equal(store.redo(), true); assert.deepEqual(root.sfGetRowPosition(row), { x: 5, y: 7, z: 6 });
  });
});

test('Legacy gesture setters preserve fractional coordinates and commit once or cancel with Escape', async () => {
  await fixture(({ root, store }) => {
    const row = root.sfAddSceneObject('CUBE', 'Legacy cube'), id = row.dataset.sfReferenceId;
    root.SF_VIEWPORT_3D_ACTIVE = false;
    const down = { button: 0, target: { closest: () => ({}) } };
    root.emit('mousedown', down);
    root.sfSetRowPosition(row, { x: 5.25, y: 2.125, z: 1.75 });
    root.sfSetRowPosition(row, { x: 7.25, y: 2.125, z: 1.75 });
    assert.equal(store.history.length, 1); root.emit('mouseup'); assert.equal(store.history.length, 2);
    assert.deepEqual(store.get(['scene', 'referenceObjects', id, 'position']), [7.25, 1.75, 2.125]);
    root.emit('mousedown', down); root.sfSetRowPosition(row, { x: 99.5, y: 9, z: 9 });
    root.emit('keydown', { key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(store.history.length, 2); assert.deepEqual(root.sfGetRowPosition(row), { x: 7.25, y: 2.125, z: 1.75 });
  });
});

test('Legacy restoration imports only explicit types and preserves unsupported scene rows', async () => {
  await fixture(({ root, store, rows }) => {
    const unsupported = { key: 'cloud', type: 'CLOUD', name: 'Existing cloud', x: 7, y: 8, z: 9, added: true };
    root.sfRestoreOutlinerObjects([unsupported, { key: 'sphere', type: 'SPHERE', name: 'Saved sphere', x: 1.25, y: 3.5, z: 2.75, selected: true, scale: 2 }]);
    assert.equal(rows.length, 2); assert.deepEqual(Object.keys(store.get('scene.referenceObjects')), ['sphere']);
    assert.deepEqual(store.get('scene.referenceObjects.sphere.position'), [1.25, 2.75, 3.5]);
    store.set('scene.referenceObjects', {}, { record: false });
    assert.equal(rows.length, 1); assert.equal(rows[0].dataset.sfKey, 'cloud');
    root.sfRestoreOutlinerObjects([unsupported]); assert.deepEqual(store.get('scene.referenceObjects'), {});
    assert.equal(root.sfCollectOutlinerObjects()[0].type, 'CLOUD');
  });
});

test('Reference rename, visibility, lock, duplication and deletion synchronize and undo atomically', async () => {
  await fixture(({ root, store, rows }) => {
    const row = root.sfAddSceneObject('CUBE', 'Cube'), id = row.dataset.sfReferenceId;
    root.sfRenameSelectedObject(); assert.equal(store.get(`scene.referenceObjects.${id}.name`), 'Renamed reference');
    root.sfToggleSelectedVisibility(); assert.equal(store.get(`scene.referenceObjects.${id}.visible`), false);
    root.sfToggleSelectedLock(); assert.equal(store.get(`scene.referenceObjects.${id}.locked`), true);
    const before = store.get(`scene.referenceObjects.${id}.position`);
    root.sfSetRowPosition(row, { x: 500, y: 500, z: 500 }); assert.deepEqual(store.get(`scene.referenceObjects.${id}.position`), before);
    root.sfToggleSelectedLock();
    const count = store.history.length, clone = root.sfDuplicateSelectedObject();
    assert.equal(store.history.length, count + 1); assert.equal(rows.length, 2);
    assert.equal(store.get(`scene.referenceObjects.${clone.dataset.sfKey}.visible`), false);
    assert.equal(store.undo(), true); assert.equal(rows.length, 1);
    assert.equal(store.redo(), true); assert.equal(rows.length, 2);
    root.sfDeleteSelectedObject(); assert.equal(rows.length, 1);
    root.sfUndo(); assert.equal(rows.length, 2, 'Legacy menu Undo restores a deleted reference even with no selection');
  });
});

test('unsupported outliner additions and edits remain in Core autosave state', async () => {
  await fixture(({ root, adapter, store }) => {
    const row = root.sfAddSceneObject('CLOUD', 'Legacy cloud'); adapter.importRows();
    assert.equal(store.get('scene.legacyObjects')[0].name, 'Legacy cloud');
    row.children[1].textContent = 'Edited cloud'; row.dataset.sfY = '321.5'; adapter.importRows();
    assert.equal(store.get('scene.legacyObjects')[0].name, 'Edited cloud');
    assert.equal(store.get('scene.legacyObjects')[0].y, 321.5);
    assert.deepEqual(store.get('scene.referenceObjects'), {});
  });
});

test('Legacy project migration keeps unknown types intact and converts only SPHERE/CUBE/PLANE', async () => {
  const { prepareReferenceScene } = await import(adapterUrl);
  const cloud = { key: 'cloud', type: 'CLOUD', props: { density: .7 }, x: 4, y: 100, z: 6 };
  const item = { key: 'item', type: 'ITEM', name: 'Chrome ball', props: { mode: 'Reference' } };
  const payload = { metadata: { upAxis: 'Y' }, objects: [cloud, item, { type: 'SPHERE', x: 1.25, y: 3.75, z: 2.5, selected: true }] };
  assert.equal(prepareReferenceScene(payload), payload);
  assert.equal(payload.objects[0], cloud); assert.equal(payload.objects[1], item);
  assert.deepEqual(Object.keys(payload.scene.referenceObjects), ['legacy-ref-2']);
  assert.deepEqual(payload.scene.referenceObjects['legacy-ref-2'].position, [1.25, 2.5, 3.75]);
  assert.equal(payload.scene.selectedReferenceId, 'legacy-ref-2');
  const existing = { scene: { referenceObjects: {}, selectedReferenceId: null, objects: payload.objects } };
  prepareReferenceScene(existing); assert.deepEqual(existing.scene.referenceObjects, {}, 'explicit empty canonical scene remains empty');
  const malformed = { scene: { referenceObjects: { stable: { id: 'wrong', type: 'cube', position: [Infinity, 2e6, -2e6], scale: -2 },
    unknown: { type: 'CLOUD' } }, selectedReferenceId: 'wrong' } };
  prepareReferenceScene(malformed);
  assert.deepEqual(Object.keys(malformed.scene.referenceObjects), ['stable']);
  assert.equal(malformed.scene.referenceObjects.stable.id, 'stable');
  assert.deepEqual(malformed.scene.referenceObjects.stable.position, [0, 1e6, -1e6]);
  assert.equal(malformed.scene.referenceObjects.stable.scale, .01); assert.equal(malformed.scene.selectedReferenceId, null);
});

test('Old Core projects reset only references, and disposing restores legacy function ownership', async () => {
  await fixture(({ root, store, rows, adapter }) => {
    const add = adapter.originals.get('sfAddSceneObject').original;
    root.sfAddSceneObject('CLOUD', 'Keep legacy cloud'); root.sfAddSceneObject('SPHERE', 'Remove on old project open');
    store.replace({ project: { name: 'Old Core project' }, sun: { azimuth: 0, elevation: 10 } }, { record: false });
    assert.equal(rows.length, 1); assert.equal(rows[0].children[2].textContent, 'CLOUD');
    adapter.dispose(); assert.equal(root.sfAddSceneObject, add);
  });
});

test('position edits preserve nonuniform scale; legacy uniform scale resizes local proportions', async () => {
  await fixture(({ root, controls, store }) => {
    const row = root.sfAddSceneObject('CUBE', 'Nonuniform cube'), id = row.dataset.sfReferenceId;
    store.set(`scene.referenceObjects.${id}.rotation`, [12, 23, 34], { record: false });
    store.set(`scene.referenceObjects.${id}.scale`, [2, 3, 4], { record: false });
    controls['tri-pos-x'].value = '8.125'; root.sfSetSelectedTransformFromInputs();
    assert.deepEqual(store.get(`scene.referenceObjects.${id}.scale`), [2, 3, 4]);
    assert.deepEqual(store.get(`scene.referenceObjects.${id}.rotation`), [12, 23, 34]);
    controls['tri-scale'].value = '2'; root.sfSetSelectedTransformFromInputs();
    assert.deepEqual(store.get(`scene.referenceObjects.${id}.scale`), [1, 1.5, 2]);
    store.undo(); assert.deepEqual(store.get(`scene.referenceObjects.${id}.scale`), [2, 3, 4]);
    root.sfSetRowScale(row, 8); assert.deepEqual(store.get(`scene.referenceObjects.${id}.scale`), [4, 6, 8]);
    root.sfSetRowRotation(row, 47.25); assert.deepEqual(store.get(`scene.referenceObjects.${id}.rotation`), [12, 23, 47.25]);
  });
});

test('numeric transform previews cancel on selection, hiding, locking, deletion and project replacement', async () => {
  for (const field of ['rotation', 'scale']) for (const cancel of ['select', 'hide', 'lock', 'delete', 'replace']) {
    await fixture(({ root, adapter, store }) => {
      const row = root.sfAddSceneObject('CUBE', 'Edited cube'), id = row.dataset.sfReferenceId;
      const before = store.get(`scene.referenceObjects.${id}.${field}`), history = store.history.length;
      const input = { value: field === 'rotation' ? '42.25' : '2.75', dataset: { studioTransform: field, axis: 'x' } };
      adapter.startNumericEdit(input); adapter.previewNumericEdit(input);
      assert.notDeepEqual(store.get(`scene.referenceObjects.${id}.${field}`), before);
      assert.deepEqual(store.snapshot({ committed: true }).scene.referenceObjects[id][field], before);
      if (cancel === 'select') adapter.select(null);
      else if (cancel === 'hide') root.sfToggleSelectedVisibility();
      else if (cancel === 'lock') root.sfToggleSelectedLock();
      else if (cancel === 'delete') root.sfDeleteSelectedObject();
      else store.replace({ project: { name: 'Old project' } }, { record: false });
      adapter.finishNumericEdit(false);
      if (cancel === 'delete') {
        assert.equal(store.get(`scene.referenceObjects.${id}`), undefined);
        assert.equal(store.history.length, history + 1); store.undo();
        assert.deepEqual(store.get(`scene.referenceObjects.${id}.${field}`), before);
      } else if (cancel !== 'replace') {
        assert.deepEqual(store.get(`scene.referenceObjects.${id}.${field}`), before);
        assert.equal(store.history.length, history + (['hide', 'lock'].includes(cancel) ? 1 : 0));
      } else assert.equal(store.history.length, history);
      assert.equal(store.activeEdit, null);
    });
  }
});

test('legacy rotation and uniform scale gestures each commit once and Escape restores all transforms', async () => {
  for (const mode of ['rotation', 'scale']) await fixture(({ root, store }) => {
    const row = root.sfAddSceneObject('CUBE', 'Legacy transformed cube'), id = row.dataset.sfReferenceId;
    store.set(`scene.referenceObjects.${id}.rotation`, [12, 23, 34], { record: false });
    store.set(`scene.referenceObjects.${id}.scale`, [2, 3, 4], { record: false });
    root.SF_VIEWPORT_3D_ACTIVE = false;
    const down = { button: 0, target: { closest: () => ({}) } }, before = store.get(`scene.referenceObjects.${id}.${mode}`);
    const history = store.history.length, setter = mode === 'rotation' ? 'sfSetRowRotation' : 'sfSetRowScale';
    root.emit('mousedown', down); root[setter](row, 5.25); root[setter](row, 7.5);
    assert.equal(store.history.length, history);
    assert.deepEqual(store.snapshot({ committed: true }).scene.referenceObjects[id][mode], before);
    const after = store.get(`scene.referenceObjects.${id}.${mode}`);
    root.emit('mouseup'); assert.equal(store.history.length, history + 1);
    store.undo(); assert.deepEqual(store.get(`scene.referenceObjects.${id}.${mode}`), before);
    store.redo(); assert.deepEqual(store.get(`scene.referenceObjects.${id}.${mode}`), after);
    root.emit('mousedown', down); root[setter](row, 19.5);
    root.emit('keydown', { key: 'Escape', preventDefault() {} }); root.emit('mouseup');
    assert.deepEqual(store.get(`scene.referenceObjects.${id}.${mode}`), after);
    assert.equal(store.history.length, history + 1);
  });
});

test('hidden references remain editable numerically after the hiding gesture has cancelled', async () => {
  await fixture(({ root, adapter, store }) => {
    const row = root.sfAddSceneObject('CUBE', 'Hidden cube'), id = row.dataset.sfReferenceId;
    root.sfToggleSelectedVisibility(); const history = store.history.length;
    const input = { value: '37.5', dataset: { studioTransform: 'rotation', axis: 'z' } };
    adapter.startNumericEdit(input); adapter.previewNumericEdit(input); adapter.finishNumericEdit(false);
    assert.deepEqual(store.get(`scene.referenceObjects.${id}.rotation`), [0, 0, 37.5]);
    assert.equal(store.get(`scene.referenceObjects.${id}.visible`), false); assert.equal(store.history.length, history + 1);
  });
});

test('legacy transform metadata roundtrips fractional Euler XYZ and local scale while scalar ROT remains compatible', async () => {
  await fixture(({ root, store, referenceToLegacy, referenceFromLegacy }) => {
    const value = { id: 'transformed', name: 'Transformed cube', type: 'cube', position: [1.25, -2.5, 3.75], rotation: [12.125, -23.25, 34.5], scale: [2, 3, 4], visible: false, locked: true };
    const legacy = referenceToLegacy(value);
    assert.equal(legacy.scale, 4); assert.equal(legacy.rot, 34.5);
    assert.deepEqual(legacy.referenceTransform, { upAxis: 'Z', rotation: value.rotation, scale: value.scale });
    assert.deepEqual(referenceFromLegacy(legacy), value);
    root.sfRestoreOutlinerObjects([legacy]);
    assert.deepEqual(store.get('scene.referenceObjects.transformed'), value);
    const exported = root.sfCollectOutlinerObjects()[0];
    assert.deepEqual(exported.referenceTransform, legacy.referenceTransform);
    root.sfRestoreOutlinerObjects([exported]); assert.deepEqual(store.get('scene.referenceObjects.transformed'), value);
    root.sfRestoreOutlinerObjects([{ key: 'old', type: 'PLANE', rot: 43.125, scale: 2, x: 1, y: 2, z: 3 }]);
    assert.deepEqual(store.get('scene.referenceObjects.old.rotation'), [0, 0, 43.125]);
    assert.equal(store.get('scene.referenceObjects.old.scale'), 2);
  });
});
