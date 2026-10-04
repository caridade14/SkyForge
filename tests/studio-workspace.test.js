const { clientSource } = require('./helpers/client-source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = clientSource('src/client/studio/workspace.js');
const moduleURL = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const load = () => import(moduleURL);

test('Studio layouts accept corrupted or unavailable storage without interrupting project boot', async () => {
  const { readStudioLayout, writeStudioLayout, normalizeStudioLayout } = await load();
  assert.deepEqual(readStudioLayout({ getItem() { throw new Error('SecurityError'); } }), normalizeStudioLayout());
  assert.deepEqual(readStudioLayout({ getItem: () => 'broken json' }), normalizeStudioLayout());
  assert.deepEqual(readStudioLayout({ getItem: () => 'null' }), normalizeStudioLayout());
  assert.equal(writeStudioLayout({ setItem() { throw new Error('QuotaExceeded'); } }, {}), false);
});

test('Studio layout bounds prevent collapsed or oversized editors from losing the viewport', async () => {
  const { normalizeStudioLayout } = await load();
  const layout = normalizeStudioLayout({ left: -5, right: Infinity, bottom: 100000, preset: 'invalid', editor: 'render', inspector: 'unknown', maximized: true });
  assert.equal(layout.left, 170); assert.equal(layout.right, 292); assert.equal(layout.bottom, 620);
  assert.equal(layout.preset, 'Sky'); assert.equal(layout.editor, 'timeline'); assert.equal(layout.inspector, 'sky'); assert.equal(layout.maximized, true);
  assert.equal(Object.hasOwn(layout, 'scene'), false, 'workspace preferences never serialize project scene state');
});

test('Sky, Animation and Nodes presets expose functional editor slots while retaining independent layout preferences', async () => {
  const { studioPreset } = await load();
  const animation = studioPreset('Animation', { maximized: true, leftCollapsed: true, rightCollapsed: true });
  assert.equal(animation.editor, 'timeline'); assert.equal(animation.bottomCollapsed, false);
  assert.equal(animation.inspector, 'selection'); assert.equal(animation.maximized, false); assert.equal(animation.leftCollapsed, false);
  const nodes = studioPreset('Nodes', animation); assert.equal(nodes.editor, 'nodes'); assert.equal(nodes.bottomCollapsed, false);
  const sky = studioPreset('Sky', nodes); assert.equal(sky.inspector, 'sky'); assert.equal(sky.bottomCollapsed, true);
});

test('pointer and keyboard resizing use the correct direction for each dock and preserve the initial layout', async () => {
  const { resizeStudioLayout, normalizeStudioLayout } = await load();
  const before = normalizeStudioLayout({ left: 240, right: 280, bottom: 200 });
  assert.equal(resizeStudioLayout(before, 'left', 20).left, 260);
  assert.equal(resizeStudioLayout(before, 'right', 20).right, 260);
  assert.equal(resizeStudioLayout(before, 'bottom', -20).bottom, 220);
  assert.equal(resizeStudioLayout(before, 'left', -10000).left, 170);
  assert.equal(before.left, 240); assert.equal(before.right, 280); assert.equal(before.bottom, 200);
});

test('saved layout restores panel visibility, editor and orientation without importing unexpected properties', async () => {
  const { readStudioLayout, writeStudioLayout, studioPreset } = await load();
  const storage = { value: '', getItem() { return this.value; }, setItem(_key, value) { this.value = value; } };
  const layout = { ...studioPreset('Nodes'), rightCollapsed: true, maximized: true, untrusted: { project: 'ignored' } };
  assert.equal(writeStudioLayout(storage, layout), true);
  const restored = readStudioLayout(storage);
  assert.equal(restored.rightCollapsed, true); assert.equal(restored.maximized, true); assert.equal(restored.editor, 'nodes');
  assert.equal(Object.hasOwn(restored, 'untrusted'), false);
});
