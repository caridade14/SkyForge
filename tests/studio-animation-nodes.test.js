const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const stateUrl = url(read('src/client/core/state-store.js'));
const graphUrl = url(read('src/client/core/node-graph.js').replace('"./state-store.js"', JSON.stringify(stateUrl)));
const timelineUrl = url(read('src/client/core/timeline-engine.js').replace('"./state-store.js"', JSON.stringify(stateUrl)));
const adapterUrl = url(read('src/client/core/scene-object-adapter.js'));
const projectUrl = url(read('src/client/core/project-service.js').replace('"./state-store.js"', JSON.stringify(stateUrl)).replace('"./node-graph.js"', JSON.stringify(graphUrl)).replace('"./scene-object-adapter.js"', JSON.stringify(adapterUrl)).replace('"./timeline-engine.js"', JSON.stringify(timelineUrl)));
const modules = Promise.all([
  import(stateUrl),
  import(timelineUrl),
  import(graphUrl),
  import(url(read('src/client/studio/composition.js').replace('"../core/state-store.js"', JSON.stringify(stateUrl)))),
  import(projectUrl)
]);
async function make() {
  const [{ SkyForgeStore }, { TimelineEngine }, { NodeGraph }, { Composition }] = await modules;
  const store = new SkyForgeStore({ storage: null });
  const nodeGraph = new NodeGraph(); nodeGraph.createDefaultGraph();
  store.set('nodes', nodeGraph.serialize(), { transient: true, record: false });
  const timeline = new TimelineEngine(store), api = { store, nodeGraph, timeline };
  api.composition = new Composition(api).init();
  api.dispose = () => { api.composition.dispose(); timeline.dispose(); store.destroy(); };
  return api;
}
test('Studio browser modules parse without build dependencies', () => {
  for (const file of ['composition', 'timeline-panel', 'node-panel']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: read(`src/client/studio/${file}.js`), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});
test('Timeline supports outgoing constant, linear and smooth interpolation for vectors', async () => {
  const [, { interpolateValue }] = await modules;
  assert.equal(interpolateValue(0, 100, 0.25), 25);
  assert.equal(interpolateValue(0, 100, 0.25, 'smooth'), 15.625);
  assert.deepEqual(interpolateValue([0, 0, 0], [100, 200, 300], 0.25, 'smooth'), [15.625, 31.25, 46.875]);
  assert.equal(interpolateValue(0, 100, 0.99, 'step'), 0);
  assert.equal(interpolateValue(0, 100, 1, 'constant'), 100);
});
test('Timeline reads Undo/Redo, full project replacement, range, loop and FPS from Store', async () => {
  const api = await make(), { store, timeline } = api;
  try {
    timeline.addKeyframe('sun.azimuth', 1, 10);
    timeline.addKeyframe('sun.azimuth', 20, 200);
    assert.equal(timeline.sample('sun.azimuth', 20), 200);
    store.undo(); assert.equal(timeline.keyframes.get('sun.azimuth').length, 1);
    store.redo(); assert.equal(timeline.keyframes.get('sun.azimuth').length, 2);
    timeline.setRange(5, 20); timeline.setFps(60); timeline.setLoop(false);
    assert.deepEqual([timeline.startFrame, timeline.endFrame, timeline.fps, timeline.loop], [5, 20, 60, false]);
    store.undo(); assert.equal(timeline.loop, true);
    const document = store.snapshot(); document.timeline = { startFrame: 0, endFrame: 100, currentFrame: 35, fps: 12, loop: false, keyframes: { 'clouds.coverage': [{ frame: 0, value: 0 }, { frame: 100, value: 1 }] } };
    store.replace(document, { record: false });
    assert.equal(timeline.keyframes.has('sun.azimuth'), false);
    assert.deepEqual([timeline.currentFrame, timeline.fps, timeline.endFrame], [35, 12, 100]);
    assert.equal(store.get('clouds.coverage'), 0.35);
  } finally { api.dispose(); }
});
test('Each animated frame is one transient batch, with no history or physical root notifications', async () => {
  const api = await make(), { store, timeline } = api;
  try {
    timeline.addKeyframe('sun.azimuth', 1, 0); timeline.addKeyframe('sun.azimuth', 20, 180);
    timeline.addKeyframe('clouds.coverage', 1, 0); timeline.addKeyframe('clouds.coverage', 20, 1);
    timeline.addKeyframe('camera.exposure', 1, 1); timeline.addKeyframe('camera.exposure', 20, 2);
    const length = store.history.length, changes = [];
    const off = store.subscribe((_state, change) => changes.push(change));
    for (let frame = 2; frame <= 20; frame++) timeline.seek(frame);
    off();
    assert.equal(store.history.length, length);
    assert.equal(changes.length, 19);
    assert.ok(changes.every((change) => change.type === 'batch' && change.transient && change.path === ''));
    assert.equal(store.get('sun.azimuth'), 180); assert.equal(store.get('clouds.coverage'), 1);
  } finally { api.dispose(); }
});
test('Keyframe gesture previews, cancellation and commit keep engine map consistent', async () => {
  const api = await make(), { store, timeline } = api;
  try {
    timeline.addKeyframe('sun.elevation', 1, 5); const history = store.history.length;
    let edit = store.beginEdit('timeline.keyframes', { label: 'Move keyframes' });
    for (let frame = 2; frame < 10; frame++) edit.preview({ 'sun.elevation': [{ frame, value: 5, interpolation: 'linear' }] });
    assert.equal(timeline.keyframes.get('sun.elevation')[0].frame, 9); assert.equal(store.history.length, history);
    edit.cancel(); assert.equal(timeline.keyframes.get('sun.elevation')[0].frame, 1);
    edit = store.beginEdit('timeline.keyframes', { label: 'Move keyframes' }); edit.preview({ 'sun.elevation': [{ frame: 12, value: 5, interpolation: 'smooth' }] }); edit.commit();
    assert.equal(store.history.length, history + 1); store.undo(); assert.equal(timeline.keyframes.get('sun.elevation')[0].frame, 1); store.redo(); assert.equal(timeline.keyframes.get('sun.elevation')[0].frame, 12);
  } finally { api.dispose(); }
});
test('Object transform tracks interpolate arrays and never resurrect deleted objects', async () => {
  const api = await make(), { store, timeline } = api;
  try {
    store.set('scene.referenceObjects.cube', { id: 'cube', kind: 'cube', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    for (const [property, a, b] of [['position', [0, 0, 0], [10, 20, 30]], ['rotation', [0, 0, 0], [90, 180, 270]], ['scale', [1, 1, 1], [3, 3, 3]]]) {
      timeline.addKeyframe(`scene.referenceObjects.cube.${property}`, 1, a); timeline.addKeyframe(`scene.referenceObjects.cube.${property}`, 11, b);
    }
    timeline.seek(6); assert.deepEqual(store.get('scene.referenceObjects.cube.position'), [5, 10, 15]); assert.deepEqual(store.get('scene.referenceObjects.cube.scale'), [2, 2, 2]);
    store.set('scene.referenceObjects', {}); timeline.seek(8); assert.deepEqual(store.get('scene.referenceObjects'), {});
    assert.throws(() => timeline.addKeyframe('project.modified', 1, true), /animatable/);
  } finally { api.dispose(); }
});
test('Node parameters win over context defaults and invalid cycles leave connections intact', async () => {
  const [, , { NodeGraph }] = await modules;
  const graph = new NodeGraph(); graph.createDefaultGraph();
  graph.updateNode('sun', { params: { elevation: 42 } }); graph.updateNode('color-grade', { params: { exposure: 1.5, saturation: 0.4 } });
  const output = graph.evaluateOutput({ state: { sun: { elevation: 12, angularDiameter: 0.53 }, color: { exposure: -2 } } });
  assert.equal(output.sun.elevation, 42); assert.equal(output.sun.angularDiameter, 0.53); assert.equal(output.color.exposure, 1.5);
  const before = graph.serialize();
  assert.throws(() => graph.connect('output', 'output', 'color-grade', 'input'), /cycle/);
  assert.deepEqual(graph.serialize(), before);
  assert.throws(() => graph.connect('sun', 'sun', 'output', 'input'), /mismatch/);
  const invalid = structuredClone(before); invalid.connections.push({ id: 'cycle', from: { node: 'output', socket: 'output' }, to: { node: 'color-grade', socket: 'input' } });
  assert.throws(() => graph.load(invalid), /cycle/); assert.deepEqual(graph.serialize(), before);
});
test('Graph edits and gestures synchronize Undo/Redo without feedback history; animation wins', async () => {
  const api = await make(), { store, nodeGraph, composition, timeline } = api;
  try {
    composition.setAuthority('graph');
    nodeGraph.updateNode('sun', { params: { elevation: 22 } }); assert.equal(store.get('sun.elevation'), 22);
    const history = store.history.length; store.undo(); assert.equal(nodeGraph.nodes.get('sun').params.elevation, 7); assert.equal(store.get('sun.elevation'), 7); assert.equal(store.history.length, history - 1);
    store.redo(); assert.equal(store.get('sun.elevation'), 22); assert.equal(store.history.length, history);
    const edit = store.beginEdit('nodes', { label: 'Move node' }), before = nodeGraph.serialize(), moved = structuredClone(before); moved.nodes[0].position.x += 100;
    edit.preview(moved); assert.equal(nodeGraph.nodes.get('sun').position.x, 140); assert.equal(store.history.length, history); edit.cancel(); assert.equal(nodeGraph.nodes.get('sun').position.x, 40);
    timeline.addKeyframe('sun.elevation', 1, 2); timeline.addKeyframe('sun.elevation', 11, 12); timeline.seek(6);
    nodeGraph.updateNode('sun', { params: { elevation: 55, azimuth: 100 } });
    assert.equal(composition.authority, 'graph'); assert.equal(store.get('sun.elevation'), 7); assert.equal(store.get('sun.azimuth'), 100);
    store.set('sun.azimuth', 170); assert.equal(composition.authority, 'direct');
  } finally { api.dispose(); }
});
test('Store replacement restores graph parameters silently with no write-back history', async () => {
  const api = await make(), { store, nodeGraph, composition } = api;
  try {
    const saved = store.snapshot(); saved.scene.authority = 'graph'; saved.nodes.nodes.find((node) => node.type === 'Clouds').params.coverage = 0.17;
    const before = store.history.length; store.replace(saved, { record: false });
    assert.equal(store.history.length, before); assert.equal(composition.authority, 'graph'); assert.equal(nodeGraph.nodes.get('clouds').params.coverage, 0.17); assert.equal(store.get('clouds.coverage'), 0.17);
    let writes = 0; const off = nodeGraph.subscribe(() => writes++); nodeGraph.load(saved.nodes, { silent: true }); off(); assert.equal(writes, 0);
  } finally { api.dispose(); }
});
test('Cancelling a direct gesture preserves graph authority; committing selects Direct once', async () => {
  const api = await make(), { store, composition } = api;
  try {
    composition.setAuthority('graph'); const original = store.get('sun'), history = store.history.length;
    let edit = store.beginEdit('sun', { label: 'Move Sun' }); edit.preview({ ...original, azimuth: 88 });
    assert.equal(store.get('sun.azimuth'), 88); assert.equal(composition.authority, 'graph');
    edit.cancel(); assert.equal(store.get('sun.azimuth'), original.azimuth); assert.equal(composition.authority, 'graph');
    edit = store.beginEdit('sun', { label: 'Move Sun' }); edit.preview({ ...original, azimuth: 99 }); edit.commit();
    assert.equal(composition.authority, 'direct'); assert.equal(store.history.length, history + 1);
  } finally { api.dispose(); }
});
test('Disconnecting a graph component restores its captured direct base; missing scene reports an error', async () => {
  const api = await make(), { store, nodeGraph, composition } = api;
  try {
    store.set('sun.elevation', 18); store.set('clouds.coverage', 0.23);
    composition.setAuthority('graph'); nodeGraph.updateNode('sun', { params: { elevation: 42 } });
    assert.equal(store.get('sun.elevation'), 42);
    const connection = nodeGraph.incoming('sky-scene', 'sun'); nodeGraph.disconnect(connection.id);
    assert.equal(store.get('sun.elevation'), 18);
    composition.setAuthority('direct'); assert.equal(store.get('clouds.coverage'), 0.23);
    composition.setAuthority('graph'); nodeGraph.disconnect(nodeGraph.incoming('output', 'input').id);
    assert.match(composition.error, /Output needs a scene/);
  } finally { api.dispose(); }
});
test('Playback coalesces elapsed steps, stops at the range and pauses while hidden', async () => {
  const previousRAF = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame, previousDocument = globalThis.document;
  let nextHandle = 0; const pending = new Map(), listeners = new Map();
  globalThis.requestAnimationFrame = (callback) => { pending.set(++nextHandle, callback); return nextHandle; };
  globalThis.cancelAnimationFrame = (handle) => pending.delete(handle);
  globalThis.document = { hidden: false, addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: (type) => listeners.delete(type) };
  const api = await make(), { store, timeline } = api;
  try {
    timeline.setRange(1, 10); timeline.setFps(24); timeline.addKeyframe('sun.azimuth', 1, 0); timeline.addKeyframe('sun.azimuth', 10, 90);
    const run = (time) => { const handle = timeline.frameHandle, callback = pending.get(handle); pending.delete(handle); callback(time); };
    timeline.play(); run(0); const before = store.history.length, changes = [];
    const off = store.subscribe((_state, change) => changes.push(change)); run(100); off();
    assert.equal(timeline.currentFrame, 3); assert.equal(changes.length, 1); assert.equal(store.history.length, before);
    globalThis.document.hidden = true; listeners.get('visibilitychange')();
    assert.equal(timeline.playing, false); assert.equal(timeline.frameHandle, null); assert.equal(pending.size, 0);
    globalThis.document.hidden = false; timeline.setLoop(false); timeline.seek(10); timeline.play(); run(200); run(300);
    assert.equal(timeline.currentFrame, 10); assert.equal(timeline.playing, false); assert.equal(pending.size, 0);
  } finally { api.dispose(); globalThis.requestAnimationFrame = previousRAF; globalThis.cancelAnimationFrame = previousCancel; if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
});
test('Project documents exclude provisional node/keyframe previews and restore all studio services', async () => {
  const api = await make(), { store, nodeGraph, timeline, composition } = api;
  const [, , , , { ProjectService }] = await modules;
  const projects = new ProjectService(store, { nodeGraph, timeline });
  try {
    timeline.addKeyframe('sun.azimuth', 1, 12); timeline.addKeyframe('sun.azimuth', 11, 120);
    nodeGraph.updateNode('clouds', { params: { coverage: 0.21 } }); composition.setAuthority('graph');
    const nodesBefore = store.get('nodes'), keysBefore = store.get('timeline.keyframes');
    let edit = store.beginEdit('nodes', { label: 'Drag node' }); const nodesPreview = structuredClone(nodesBefore); nodesPreview.nodes[0].position.x += 500; edit.preview(nodesPreview);
    assert.deepEqual(projects.createDocument().payload.nodes, nodesBefore); assert.notDeepEqual(nodeGraph.serialize(), nodesBefore); edit.cancel();
    edit = store.beginEdit('timeline.keyframes', { label: 'Drag key' }); const keysPreview = structuredClone(keysBefore); keysPreview['sun.azimuth'][0].frame = 4; edit.preview(keysPreview);
    assert.deepEqual(projects.createDocument().payload.timeline.keyframes, keysBefore); edit.cancel();
    const document = projects.createDocument(); timeline.removeKeyframe('sun.azimuth', 11); nodeGraph.updateNode('clouds', { params: { coverage: 0.9 } });
    projects.loadDocument(document);
    assert.equal(store.history.length, 0); assert.equal(store.future.length, 0);
    assert.deepEqual(timeline.serializeKeyframes(), keysBefore); assert.deepEqual(nodeGraph.serialize(), nodesBefore); assert.equal(store.get('clouds.coverage'), 0.21);
    store.set('sun.intensity', 3); assert.equal(store.undo(), true); assert.equal(store.redo(), true);
    assert.deepEqual(projects.createDocument().payload.nodes, nodesBefore);
  } finally { api.dispose(); }
});
test('Invalid project graph validation leaves the current scene and history untouched', async () => {
  const api = await make(), { store, nodeGraph, timeline } = api;
  const [, , , , { ProjectService, completeProjectState }] = await modules;
  const projects = new ProjectService(store, { nodeGraph, timeline });
  try {
    store.set('sun.intensity', 2.5); const before = store.snapshot(), history = store.history.length;
    const bad = structuredClone(before); bad.nodes.connections.push({ id: 'cycle', from: { node: 'output', socket: 'output' }, to: { node: 'color-grade', socket: 'input' } });
    assert.throws(() => projects.loadDocument(bad), /cycle/); assert.deepEqual(store.snapshot(), before); assert.equal(store.history.length, history);
    const legacy = { schemaVersion: 2, sun: { elevation: 30 }, unknownTool: { preserved: true } }, normalized = completeProjectState(legacy);
    assert.equal(normalized.sun.elevation, 30); assert.equal(normalized.sun.azimuth, 215); assert.equal(normalized.engine.lighting.status, 'idle'); assert.ok(normalized.bridge.blender); assert.deepEqual(normalized.unknownTool, legacy.unknownTool);
    assert.equal(legacy.engine, undefined);
    projects.newProject('New Studio scene'); assert.equal(store.get('project.name'), 'New Studio scene'); assert.equal(store.get('project.modified'), false); assert.equal(store.history.length, 0); assert.equal(nodeGraph.nodes.size, 6); assert.equal(timeline.keyframes.size, 0);
  } finally { api.dispose(); }
});
test('Deleting the last animated graph track restores its graph parameter immediately and supports Undo/Redo', async () => {
  const api = await make(), { store, timeline, composition, nodeGraph } = api;
  try {
    nodeGraph.updateNode('sun', { params: { elevation: 55 } }); composition.setAuthority('graph');
    timeline.addKeyframe('sun.elevation', 1, 10); assert.equal(store.get('sun.elevation'), 10);
    timeline.removeKeyframe('sun.elevation', 1); assert.equal(store.get('sun.elevation'), 55);
    store.undo(); assert.equal(store.get('sun.elevation'), 10); store.redo(); assert.equal(store.get('sun.elevation'), 55);
    assert.equal(composition.authority, 'graph');
  } finally { api.dispose(); }
});
test('Autosave reopened during a provisional key edit reconstructs the committed current pose without history', async () => {
  const [{ SkyForgeStore }, { TimelineEngine }, , , { ProjectService }] = await modules;
  const values = new Map(), storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const store = new SkyForgeStore({ storage }), timeline = new TimelineEngine(store), projects = new ProjectService(store, { timeline });
  const restored = new SkyForgeStore({ storage }); let restoredTimeline;
  try {
    timeline.addKeyframe('sun.elevation', 1, 10); const committedKeys = timeline.serializeKeyframes();
    const edit = store.beginEdit('timeline.keyframes', { label: 'Edit key value' }); edit.preview({ 'sun.elevation': [{ frame: 1, value: 90, interpolation: 'linear' }] });
    assert.equal(store.get('sun.elevation'), 90); store.persist(); const document = projects.createDocument();
    assert.deepEqual(document.payload.timeline.keyframes, committedKeys); assert.equal(document.payload.sun.elevation, 10);
    restored.restore(); restoredTimeline = new TimelineEngine(restored);
    assert.equal(restored.get('sun.elevation'), 10); assert.equal(restored.history.length, 0); assert.equal(restoredTimeline.playing, false);
    new ProjectService(restored, { timeline: restoredTimeline }).loadDocument(document);
    assert.equal(restored.get('sun.elevation'), 10); assert.equal(restored.history.length, 0); edit.cancel();
  } finally { restoredTimeline?.dispose(); timeline.dispose(); restored.destroy(); store.destroy(); }
});
test('Graph parameters, animated frame batches, key deletion and Undo never schedule a physical request', async () => {
  const api = await make(), { store, timeline, composition, nodeGraph } = api;
  const { LightingSync } = await import(url(read('src/client/core/lighting-sync.js')));
  const lighting = new LightingSync(store); let requests = 0; lighting.schedule = () => requests++;
  try {
    composition.setAuthority('graph'); nodeGraph.updateNode('sun', { params: { elevation: 40 } });
    timeline.addKeyframe('sun.elevation', 1, 10); timeline.addKeyframe('sun.elevation', 11, 30);
    timeline.addKeyframe('clouds.coverage', 1, 0.2); timeline.addKeyframe('clouds.coverage', 11, 0.8);
    for (let frame = 1; frame <= 11; frame++) timeline.seek(frame);
    timeline.removeKeyframe('sun.elevation', 1); timeline.removeKeyframe('sun.elevation', 11); store.undo(); store.redo();
    assert.equal(requests, 0);
  } finally { lighting.dispose(); api.dispose(); }
});
test('Graph autosave discards provisional node parameters and rebuilds their derived preview on restore', async () => {
  const [{ SkyForgeStore }, { TimelineEngine }, { NodeGraph }, { Composition }, { ProjectService }] = await modules;
  const values = new Map(), storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const store = new SkyForgeStore({ storage }), nodeGraph = new NodeGraph(); nodeGraph.createDefaultGraph(); store.set('nodes', nodeGraph.serialize(), { transient: true, record: false });
  const timeline = new TimelineEngine(store), api = { store, timeline, nodeGraph }, composition = new Composition(api).init();
  const restored = new SkyForgeStore({ storage }); let restoredApi, restoredComposition;
  try {
    composition.setAuthority('graph'); nodeGraph.updateNode('sun', { params: { elevation: 33 } });
    const committed = nodeGraph.serialize(), edit = store.beginEdit('nodes', { label: 'Edit Sun node' }), preview = structuredClone(committed); preview.nodes.find((node) => node.id === 'sun').params.elevation = 88; edit.preview(preview);
    assert.equal(store.get('sun.elevation'), 88);
    const history = store.history.length, document = new ProjectService(store, { nodeGraph, timeline }).createDocument();
    assert.equal(document.payload.sun.elevation, 33); assert.deepEqual(document.payload.nodes, committed); assert.equal(store.get('sun.elevation'), 88); assert.equal(store.history.length, history);
    store.persist(); restored.restore();
    restoredApi = { store: restored, timeline: new TimelineEngine(restored), nodeGraph: new NodeGraph({ serialized: restored.get('nodes') }) };
    restoredComposition = new Composition(restoredApi).init();
    assert.equal(restoredComposition.authority, 'graph'); assert.equal(restored.get('sun.elevation'), 33); assert.deepEqual(restoredApi.nodeGraph.serialize(), committed); assert.equal(restored.history.length, 0);
    edit.cancel();
  } finally { restoredComposition?.dispose(); restoredApi?.timeline.dispose(); restored.destroy(); composition.dispose(); timeline.dispose(); store.destroy(); }
});
test('Undo of a committed direct Sun gesture restores graph authority in the same entry without rewinding transport', async () => {
  const api = await make(), { store, composition, nodeGraph, timeline } = api;
  try {
    nodeGraph.updateNode('sun', { params: { elevation: 31, azimuth: 70 } }); composition.setAuthority('graph');
    const before = store.get('sun'), history = store.history.length, edit = store.beginEdit('sun', { label: 'Move Sun' });
    edit.preview({ ...before, elevation: 45, azimuth: 100 }); edit.commit();
    assert.equal(composition.authority, 'direct'); assert.equal(store.history.length, history + 1);
    timeline.seek(25); store.undo(); assert.equal(composition.authority, 'graph'); assert.equal(store.get('sun.elevation'), 31); assert.equal(timeline.currentFrame, 25);
    store.redo(); assert.equal(composition.authority, 'direct'); assert.equal(store.get('sun.elevation'), 45); assert.equal(timeline.currentFrame, 25);
    store.undo(); nodeGraph.updateNode('sun', { params: { elevation: 55 } }); assert.equal(store.get('sun.elevation'), 55);
  } finally { api.dispose(); }
});
test('Direct batches preserve authority in their own entry and unrecorded changes cannot annotate older history', async () => {
  const api = await make(), { store, composition } = api;
  try {
    composition.setAuthority('graph'); const history = store.history.length;
    store.batch('Direct sky edit', (draft) => { draft.sun.elevation = 40; draft.clouds.coverage = 0.3; });
    assert.equal(composition.authority, 'direct'); assert.equal(store.history.length, history + 1);
    store.undo(); assert.equal(composition.authority, 'graph'); store.redo(); assert.equal(composition.authority, 'direct'); assert.equal(store.get('sun.elevation'), 40);
    composition.setAuthority('graph'); const before = structuredClone(store.history);
    store.batch('Direct sky edit', (draft) => { draft.sun.elevation = 50; }, { record: false });
    assert.equal(composition.authority, 'direct'); assert.deepEqual(store.history, before);
  } finally { api.dispose(); }
});
