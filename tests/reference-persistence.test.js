const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const url = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const storeUrl = url(source('src/client/core/state-store.js'));
const adapterUrl = url(source('src/client/core/scene-object-adapter.js'));
const graphUrl = url(source('src/client/core/node-graph.js').replace('"./state-store.js"', JSON.stringify(storeUrl)));
const timelineUrl = url(source('src/client/core/timeline-engine.js').replace('"./state-store.js"', JSON.stringify(storeUrl)));
const projectUrl = () => url(source('src/client/core/project-service.js').replace('"./state-store.js"', JSON.stringify(storeUrl)).replace('"./scene-object-adapter.js"', JSON.stringify(adapterUrl)).replace('"./node-graph.js"', JSON.stringify(graphUrl)).replace('"./timeline-engine.js"', JSON.stringify(timelineUrl)));

test('projects and autosave roundtrip all reference types, fractional positions, selection and hidden/locked properties', async () => {
  const { SkyForgeStore } = await import(storeUrl), { ProjectService } = await import(projectUrl());
  const values = new Map(), storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) };
  const store = new SkyForgeStore({ storage }), restored = new SkyForgeStore({ storage });
  try {
    const objects = Object.fromEntries(['sphere', 'cube', 'plane'].map((type, i) => [type, {
      id: type, type, name: `Saved ${type}`, position: [i + .125, i - .75, i + .5], scale: 1.25,
      visible: type !== 'plane', locked: type === 'cube'
    }]));
    store.set('scene', { referenceObjects: objects, selectedReferenceId: 'cube' });
    const document = new ProjectService(store).createDocument(), text = JSON.stringify(document);
    restored.persist(); store.persist(); assert.equal(restored.restore(), true);
    assert.deepEqual(restored.get('scene'), store.get('scene'));
    restored.reset(); new ProjectService(restored).loadDocument(document);
    assert.deepEqual(restored.get('scene'), store.get('scene')); assert.equal(JSON.stringify(document), text, 'loading does not mutate input');
  } finally { store.destroy(); restored.destroy(); }
});

test('pending autosave and project export exclude movement preview; commit and Undo/Redo persist atomically', async () => {
  const { SkyForgeStore } = await import(storeUrl), { ProjectService } = await import(projectUrl());
  const values = new Map(), storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) };
  const store = new SkyForgeStore({ storage, autosaveDelay: 5 }), projects = new ProjectService(store);
  try {
    store.set('scene.referenceObjects', { cube: { id: 'cube', type: 'cube', name: 'Cube', position: [3, 0, 1], scale: 1, visible: true, locked: false } }, { record: false });
    const before = store.get('scene.referenceObjects.cube.position'), edit = store.beginEdit('scene.referenceObjects.cube.position', { label: 'Move cube' });
    edit.preview([9.125, 2.5, 4.75]);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.deepEqual(JSON.parse(values.get(store.storageKey)).scene.referenceObjects.cube.position, before);
    assert.deepEqual(projects.createDocument().payload.scene.referenceObjects.cube.position, before);
    edit.commit(); assert.equal(store.history.length, 1); store.persist();
    assert.deepEqual(JSON.parse(values.get(store.storageKey)).scene.referenceObjects.cube.position, [9.125, 2.5, 4.75]);
    store.undo(); store.persist(); assert.deepEqual(JSON.parse(values.get(store.storageKey)).scene.referenceObjects.cube.position, before);
    store.redo(); assert.deepEqual(projects.createDocument().payload.scene.referenceObjects.cube.position, [9.125, 2.5, 4.75]);
  } finally { store.destroy(); }
});

test('Project Service migrates explicit Y-up reference records while preserving old Core and unsupported legacy data', async () => {
  const { SkyForgeStore } = await import(storeUrl), { ProjectService } = await import(projectUrl());
  const store = new SkyForgeStore({ storage: null }), projects = new ProjectService(store);
  try {
    const unsupported = { key: 'cloud', type: 'CLOUD', name: 'Cloud', x: 4, y: 100, z: 6, props: { density: .7 } };
    const document = { scene: { metadata: { units: 'meters', upAxis: 'Y' }, objects: [unsupported,
      { key: 'cube', type: 'CUBE', name: 'Old cube', x: 1.25, y: 3.75, z: 2.5, selected: true, scale: 2, visible: false, locked: true }] } };
    const original = JSON.stringify(document); projects.loadDocument(document);
    assert.deepEqual(Object.keys(store.get('scene.referenceObjects')), ['cube']);
    assert.deepEqual(store.get('scene.referenceObjects.cube.position'), [1.25, 2.5, 3.75]);
    assert.equal(store.get('scene.selectedReferenceId'), 'cube'); assert.deepEqual(store.get('objects')[0], unsupported);
    assert.equal(JSON.stringify(document), original); assert.deepEqual(projects.createDocument().payload.objects[0], unsupported);
    projects.loadDocument({ schemaVersion: 2, sun: { elevation: 7 }, project: { name: 'Before references' } });
    assert.deepEqual(store.get('scene.referenceObjects'), {}); assert.equal(store.get('scene.selectedReferenceId'), null);
    assert.equal(store.get('sun.elevation'), 7);
  } finally { store.destroy(); }
});

test('project and autosave persist Euler rotation and nonuniform local scale while excluding numeric previews', async () => {
  const { SkyForgeStore } = await import(storeUrl), { ProjectService } = await import(projectUrl());
  const values = new Map(), storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) };
  const store = new SkyForgeStore({ storage }), reopened = new SkyForgeStore({ storage });
  try {
    const object = { id: 'cube', type: 'cube', name: 'Studio cube', position: [1.125, 2.25, 3.375], rotation: [15.125, -27.25, 48.375], scale: [2, .5, 3], visible: true, locked: false };
    store.set('scene', { referenceObjects: { cube: object }, selectedReferenceId: 'cube' });
    const projects = new ProjectService(store), edit = store.beginEdit('scene.referenceObjects.cube.rotation', { label: 'Numeric rotation' });
    edit.preview([90, 0, 0]); store.persist();
    assert.deepEqual(JSON.parse(values.get(store.storageKey)).scene.referenceObjects.cube.rotation, object.rotation);
    assert.deepEqual(projects.createDocument().payload.scene.referenceObjects.cube.rotation, object.rotation);
    edit.cancel();
    const document = projects.createDocument(); new ProjectService(reopened).loadDocument(document);
    assert.deepEqual(reopened.get('scene.referenceObjects.cube'), object);
    store.persist(); reopened.reset(); assert.equal(reopened.restore(), true);
    assert.deepEqual(reopened.get('scene.referenceObjects.cube'), object);
    assert.equal(reopened.get('scene.selectedReferenceId'), 'cube');
  } finally { store.destroy(); reopened.destroy(); }
});
