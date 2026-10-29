const test = require('node:test');
const assert = require('node:assert/strict');
const { clientSource } = require('./helpers/client-source.cjs');
const contract = require('./fixtures/studio-r16-menus.json');
const load = file => import('data:text/javascript;base64,' + Buffer.from(clientSource(file)).toString('base64'));

test('R17 retains every R16 menu name, label, order and command identifier', async () => {
  const { MENUS } = await load('src/client/studio/workspace.js');
  assert.deepEqual(MENUS, contract);
  assert.equal(Object.values(MENUS).flat().length, 52);
});

test('keyboard navigation wraps, enters from either direction and handles empty menus', async () => {
  const { menuIndex } = await load('src/client/studio/menu-navigation.js');
  assert.equal(menuIndex(-1, 'ArrowDown', 8), 0);
  assert.equal(menuIndex(-1, 'ArrowUp', 8), 7);
  assert.equal(menuIndex(7, 'ArrowRight', 8), 0);
  assert.equal(menuIndex(0, 'ArrowLeft', 8), 7);
  assert.equal(menuIndex(4, 'Home', 8), 0);
  assert.equal(menuIndex(0, 'End', 8), 7);
  assert.equal(menuIndex(0, 'ArrowDown', 0), -1);
  assert.equal(menuIndex(1, 'Enter', 8), -1);
});

test('popup placement keeps menus inside desktop, laptop and narrow viewports', async () => {
  const { menuPlacement } = await load('src/client/studio/menu-navigation.js');
  for (const width of [320, 390, 760, 1280, 1440, 2560]) {
    for (const height of [260, 720, 900]) {
      for (const left of [-30, 12, width - 5]) {
        const result = menuPlacement({ left, bottom: 44 }, { width: 292, height: 580 }, { width, height });
        assert.ok(result.left >= 8);
        assert.ok(result.left + Math.min(292, result.maxWidth) <= width - 8);
        assert.ok(result.top >= 8);
        assert.ok(result.top + result.maxHeight <= height - 8);
        assert.ok(result.maxHeight >= 1);
      }
    }
  }
});

test('menus near the bottom of a short window remain scrollable on screen', async () => {
  const { menuPlacement } = await load('src/client/studio/menu-navigation.js');
  const result = menuPlacement({ left: 1260, bottom: 710 }, { width: 292, height: 580 }, { width: 1280, height: 720 });
  assert.ok(result.top < 710);
  assert.equal(result.left, 980);
  assert.ok(result.maxHeight >= 80);
});
