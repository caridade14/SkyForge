const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const storeUrl = url(read('src/client/core/state-store.js'));
const bridgeUrl = url(read('src/client/core/ui-bridge.js'));
const graphUrl = url(read('src/client/core/node-graph.js').replace('"./state-store.js"', JSON.stringify(storeUrl)));

function control(name, max, value, type = 'range') {
  const events = new Map(), label = { textContent: '' };
  return { type, min: '0', max: String(max), step: '1', value: String(value), dataset: {},
    matches: selector => selector === 'input,select', querySelectorAll: () => [],
    closest: () => ({ querySelector: selector => selector === '.sl-val' ? label : { textContent: name } }),
    addEventListener: (type, listener) => events.set(type, listener), removeEventListener: type => events.delete(type),
    fire(type) { events.get(type)?.(); }, label };
}

test('legacy density and percent coverage roundtrip their actual scales through Undo, Redo and replacement', async () => {
  const { SkyForgeStore } = await import(storeUrl), { SkyForgeUIBridge } = await import(bridgeUrl);
  const store = new SkyForgeStore({ storage: null });
  const density = control('Density', 10, 7), coverage = control('Coverage', 100, 62), detail = control('Detail', 100, 60);
  const controls = [density, coverage, detail];
  const doc = { querySelectorAll: selector => selector === 'input,select' ? controls : [], getElementById: () => null, addEventListener() {}, removeEventListener() {} };
  controls.forEach(input => { input.ownerDocument = doc; });
  const previous = global.document; global.document = doc;
  const ui = new SkyForgeUIBridge({ store });
  const unsubscribe = store.subscribe(state => ui.syncControls(state, doc));
  try {
    ui.bindControls(doc);
    assert.equal(density.value, 7); assert.equal(density.dataset.sfCoreScale, '0.1');
    assert.equal(coverage.value, 62); assert.equal(detail.value, 60);
    density.value = '8'; density.fire('input'); density.fire('change');
    assert.equal(store.get('clouds.density'), .8); assert.equal(store.history.length, 1);
    assert.equal(density.label.textContent, '0.8');
    store.undo(); assert.equal(Number(density.value), 7);
    store.redo(); assert.equal(Number(density.value), 8);
    store.set('clouds.coverage', .2); assert.equal(Number(coverage.value), 20); assert.equal(coverage.label.textContent, '20%');
    store.replace({ ...store.snapshot(), clouds: { ...store.get('clouds'), density: .3, detail: .9 } }, { record: false });
    assert.equal(Number(density.value), 3); assert.equal(Number(detail.value), 90);
    assert.equal(store.get('clouds.density'), .3, 'UI synchronization does not fire legacy input handlers');
  } finally { unsubscribe(); ui.dispose(); store.destroy(); global.document = previous; }
});

test('empty numeric edits keep the previous state until a valid number arrives', async () => {
  const { SkyForgeStore } = await import(storeUrl), { SkyForgeUIBridge } = await import(bridgeUrl);
  const store = new SkyForgeStore({ storage: null }); const input = control('Color temp (K)', 12000, 5200, 'number');
  const doc = { querySelectorAll: selector => selector === 'input,select' ? [input] : [], getElementById: () => null, addEventListener() {}, removeEventListener() {} };
  input.ownerDocument = doc; const previous = global.document; global.document = doc;
  const ui = new SkyForgeUIBridge({ store });
  try { ui.bindControls(doc); input.value = ''; input.fire('input'); assert.equal(store.get('sun.temperature'), 5200); assert.equal(store.history.length, 0); }
  finally { ui.dispose(); store.destroy(); global.document = previous; }
});

test('default graph creation is one history transaction and a single Undo restores the previous graph', async () => {
  const { SkyForgeStore } = await import(storeUrl), { SkyForgeUIBridge } = await import(bridgeUrl), { NodeGraph } = await import(graphUrl);
  const store = new SkyForgeStore({ storage: null }), graph = new NodeGraph();
  graph.createDefaultGraph(); graph.nodes.get('sun').params.intensity = 4;
  const original = graph.serialize(); store.set('nodes', original, { record: false });
  const unsubscribe = graph.subscribe(() => store.set('nodes', graph.serialize()));
  const ui = new SkyForgeUIBridge({ store, nodeGraph: graph }); ui.toast = () => {};
  try {
    await ui.action('graph'); assert.equal(store.history.length, 1);
    assert.notDeepEqual(store.get('nodes'), original);
    assert.equal(store.undo(), true); assert.deepEqual(store.get('nodes'), original); assert.equal(store.history.length, 0);
  } finally { unsubscribe(); ui.dispose(); store.destroy(); }
});

test('invalid Core section requests reveal Project rather than a blank command center', async () => {
  const { SkyForgeUIBridge } = await import(bridgeUrl); const ui = new SkyForgeUIBridge({});
  const section = name => ({ dataset: { section: name, panel: name }, classList: { toggle(_name, active) { this.active = active; } } });
  const sections = ['project', 'engine', 'pipeline', 'bridge'].map(section);
  ui.hub = { querySelectorAll: () => sections };
  ui.setSection('overview'); assert.equal(sections[0].classList.active, true); assert.ok(sections.slice(1).every(section => !section.classList.active));
  ui.setSection('bridge'); assert.equal(sections[3].classList.active, true);
});
