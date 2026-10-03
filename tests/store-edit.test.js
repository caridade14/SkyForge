const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const storeUrl = moduleUrl(source('src/client/core/state-store.js'));
const projectUrl = moduleUrl(source('src/client/core/project-service.js').replace('"./state-store.js"', JSON.stringify(storeUrl)));
const modules = () => Promise.all([import(storeUrl), import(projectUrl)]);
const wait = delay => new Promise(resolve => setTimeout(resolve, delay));
const direction = (sun, azimuth, elevation) => ({ ...sun, azimuth, elevation });

test('a live sun edit commits one history entry and marks the project only on commit', async () => {
  const [{ SkyForgeStore }] = await modules();
  const store = new SkyForgeStore({ storage: null });
  const initial = store.get('sun'), project = store.get('project'), changes = [];
  store.subscribe((_state, change) => changes.push(change));
  const edit = store.beginEdit('sun', { label: 'Edit sun direction' });
  for (let step = 1; step <= 10; step++) edit.preview(direction(initial, 215 + step, 7 + step));
  assert.equal(edit.active, true);
  assert.equal(store.history.length, 0);
  assert.deepEqual(store.get('project'), project);
  assert.equal(changes.length, 10);
  assert.ok(changes.every(change => change.transient));
  assert.equal(edit.commit(), true);
  assert.equal(edit.active, false);
  assert.equal(store.history.length, 1);
  assert.equal(store.history[0].label, 'Edit sun direction');
  assert.deepEqual(store.history[0].before, initial);
  assert.deepEqual(store.history[0].after, direction(initial, 225, 17));
  assert.equal(store.get('project.modified'), true);
  assert.equal(changes.length, 11, 'commit emits one notification without a restore/preview round trip');
  assert.equal(changes.at(-1).transient, false);
  assert.equal(edit.commit(), false);
  assert.equal(edit.preview(initial), false);
  store.undo();
  assert.deepEqual(store.get('sun'), initial);
  store.redo();
  assert.deepEqual(store.get('sun'), direction(initial, 225, 17));
  store.destroy();
});

test('pending autosave and project export omit provisional sun values', async () => {
  const [{ SkyForgeStore }, { ProjectService }] = await modules();
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) };
  const store = new SkyForgeStore({ storage, autosaveDelay: 100 });
  const initial = store.get('sun');
  store.set('clouds.coverage', 0.25);
  const edit = store.beginEdit('sun');
  const final = direction(initial, 12.5, 42.7);
  edit.preview(final);
  assert.deepEqual(store.snapshot().sun, final, 'renderers see the live preview');
  const committed = store.snapshot({ committed: true });
  assert.deepEqual(committed.sun, initial);
  committed.sun.azimuth = -100;
  assert.deepEqual(store.get('sun'), final, 'committed snapshots remain isolated copies');
  const exported = new ProjectService(store).createDocument();
  assert.deepEqual(exported.payload.sun, initial);
  assert.equal(exported.payload.clouds.coverage, 0.25);
  assert.deepEqual(new ProjectService(store).validateDocument(exported).sun, initial);
  await wait(130);
  assert.deepEqual(JSON.parse(values.get(store.storageKey)).sun, initial, 'an autosave scheduled before pointerdown remains committed');
  edit.commit();
  await wait(130);
  assert.deepEqual(JSON.parse(values.get(store.storageKey)).sun, final);
  const restored = new SkyForgeStore({ storage });
  assert.equal(restored.restore(), true);
  assert.deepEqual(restored.get('sun'), final);
  restored.destroy();
  store.destroy();
});

test('cancel restores sun and preserves undo/redo and project metadata', async () => {
  const [{ SkyForgeStore }] = await modules();
  const store = new SkyForgeStore({ storage: null });
  store.set('sun.azimuth', 90);
  store.undo();
  const original = store.snapshot(), history = store.history.length, future = store.future.length;
  const edit = store.beginEdit('sun');
  edit.preview(direction(store.get('sun'), 123, 40));
  assert.equal(edit.cancel(), true);
  assert.deepEqual(store.snapshot(), original);
  assert.equal(store.history.length, history);
  assert.equal(store.future.length, future);
  assert.equal(edit.active, false);
  assert.equal(edit.cancel(), false);
  store.redo();
  assert.equal(store.get('sun.azimuth'), 90);
  store.destroy();
});

test('unchanged or out-and-back gestures produce no history or project modification', async () => {
  const [{ SkyForgeStore }] = await modules();
  const store = new SkyForgeStore({ storage: null });
  const initial = store.get('sun'), project = store.get('project');
  const unchanged = store.beginEdit('sun');
  assert.equal(unchanged.preview(initial), false);
  assert.equal(unchanged.commit(), false);
  const returned = store.beginEdit('sun');
  returned.preview(direction(initial, 20, 30));
  returned.preview(initial);
  assert.equal(returned.commit(), false);
  assert.equal(store.history.length, 0);
  assert.deepEqual(store.get('project'), project);
  store.destroy();
});

test('external overlapping set or replace cancels before applying and cannot be overwritten by a stale handle', async () => {
  const [{ SkyForgeStore }] = await modules();
  for (const mutation of ['sun', 'sun.azimuth', 'replace']) {
    const store = new SkyForgeStore({ storage: null });
    const initial = store.get('sun');
    const edit = store.beginEdit('sun');
    edit.preview(direction(initial, 160, 50));
    if (mutation === 'sun') store.set('sun', direction(initial, 40, 20));
    if (mutation === 'sun.azimuth') store.set('sun.azimuth', 40);
    if (mutation === 'replace') {
      const replacement = store.snapshot({ committed: true });
      replacement.project.name = 'Another project';
      replacement.sun = direction(initial, 40, 20);
      store.replace(replacement, { record: false });
    }
    assert.equal(edit.active, false);
    assert.equal(edit.commit(), false);
    assert.equal(edit.cancel(), false);
    assert.equal(store.get('sun.azimuth'), 40);
    assert.equal(store.get('sun.elevation'), mutation === 'sun.azimuth' ? initial.elevation : 20);
    store.destroy();
  }
  const store = new SkyForgeStore({ storage: null });
  const initial = store.get('sun');
  const edit = store.beginEdit('sun.azimuth');
  edit.preview(180);
  store.set('sun', { ...initial, elevation: 25 });
  assert.equal(edit.active, false, 'an ancestor assignment cancels a nested edit');
  assert.deepEqual(store.get('sun'), { ...initial, elevation: 25 });
  store.destroy();
});

test('engine batches preserve live preview while external sun batches use committed values', async () => {
  const [{ SkyForgeStore }] = await modules();
  const store = new SkyForgeStore({ storage: null });
  const initial = store.get('sun'), edit = store.beginEdit('sun');
  const provisional = direction(initial, 170, 45);
  edit.preview(provisional);
  store.batch('Lighting status', draft => { draft.engine.lighting.status = 'ready'; }, { transient: true, record: false });
  assert.equal(edit.active, true);
  assert.deepEqual(store.get('sun'), provisional);
  assert.deepEqual(store.snapshot({ committed: true }).sun, initial);
  assert.equal(store.history.length, 0);
  let calls = 0;
  store.batch('External solar change', draft => {
    calls++;
    assert.deepEqual(draft.sun, initial, 'mutators never derive an external change from a provisional sun');
    draft.sun.elevation += 5;
  });
  assert.equal(calls, 1);
  assert.equal(edit.active, false);
  assert.deepEqual(store.get('sun'), { ...initial, elevation: initial.elevation + 5 });
  assert.equal(store.get('engine.lighting.status'), 'ready');
  assert.equal(store.history.length, 1);
  assert.deepEqual(store.history[0].before.sun, initial);
  store.undo();
  assert.deepEqual(store.get('sun'), initial);
  store.destroy();
});

test('unrelated committed batches exclude preview from history and undo cancels a pending gesture', async () => {
  const [{ SkyForgeStore }] = await modules();
  const store = new SkyForgeStore({ storage: null });
  const initial = store.get('sun'), cloud = store.get('clouds.coverage');
  const edit = store.beginEdit('sun');
  edit.preview(direction(initial, 45, 70));
  store.batch('Change cloud cover', draft => { draft.clouds.coverage = 0.1; });
  assert.equal(edit.active, true);
  assert.deepEqual(store.history[0].before.sun, initial);
  assert.deepEqual(store.history[0].after.sun, initial);
  store.undo();
  assert.equal(edit.active, false);
  assert.deepEqual(store.get('sun'), initial);
  assert.equal(store.get('clouds.coverage'), cloud);
  store.redo();
  assert.equal(store.get('clouds.coverage'), 0.1);
  assert.deepEqual(store.get('sun'), initial);
  store.destroy();
});

test('undo, redo, reset and restore cancel pending edits before replacing state', async () => {
  const [{ SkyForgeStore }] = await modules();
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) };
  const store = new SkyForgeStore({ storage });
  const initial = store.get('sun');
  store.set('sun.elevation', 20);
  let edit = store.beginEdit('sun');
  edit.preview(direction(initial, 40, 70));
  store.undo();
  assert.equal(edit.active, false);
  assert.deepEqual(store.get('sun'), initial);
  edit = store.beginEdit('sun');
  edit.preview(direction(initial, 40, 70));
  store.redo();
  assert.equal(edit.active, false);
  assert.equal(store.get('sun.elevation'), 20);
  store.persist();
  edit = store.beginEdit('sun');
  edit.preview(direction(initial, 40, 70));
  assert.equal(store.restore(), true);
  assert.equal(edit.active, false);
  assert.equal(store.get('sun.elevation'), 20);
  edit = store.beginEdit('sun');
  edit.preview(direction(initial, 40, 70));
  store.reset();
  assert.equal(edit.active, false);
  assert.deepEqual(store.get('sun'), initial);
  edit = store.beginEdit('sun');
  edit.preview(direction(initial, 40, 70));
  assert.equal(store.undo(), false, 'undo with an empty history still cancels');
  assert.equal(edit.active, false);
  assert.deepEqual(store.get('sun'), initial);
  store.destroy();
});

test('a new edit or destroy cancels the old handle and missing legacy paths restore their original shape', async () => {
  const [{ SkyForgeStore }] = await modules();
  const store = new SkyForgeStore({ storage: null });
  const initial = store.get('sun');
  const first = store.beginEdit('sun');
  first.preview(direction(initial, 10, 80));
  const second = store.beginEdit('sun');
  assert.equal(first.active, false);
  assert.deepEqual(store.get('sun'), initial);
  second.preview(direction(initial, 10, 80));
  store.destroy();
  assert.equal(second.active, false);
  assert.deepEqual(store.get('sun'), initial);

  const legacy = { project: { name: 'Legacy sky' }, camera: { exposure: 2 } };
  const old = new SkyForgeStore({ storage: null, initialState: legacy });
  const edit = old.beginEdit('sun.azimuth');
  edit.preview(90);
  assert.deepEqual(old.snapshot({ committed: true }), legacy);
  edit.cancel();
  assert.deepEqual(old.snapshot(), legacy);
  const sibling = old.beginEdit('sun.azimuth');
  sibling.preview(90);
  old.set('sun.intensity', 2);
  assert.equal(sibling.active, true, 'an unrelated sibling path keeps a nested gesture active');
  sibling.cancel();
  assert.deepEqual(old.get('sun'), { intensity: 2 });
  old.destroy();
});
