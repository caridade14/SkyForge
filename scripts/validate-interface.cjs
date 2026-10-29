// Real gateway, original command dispatcher, actual DOM and WebGL renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const contract = require('../tests/fixtures/studio-r16-menus.json');
const out = process.env.SKYFORGE_TEST_OUTPUT || '/tmp/skyforge-interface-browser';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const launch = { headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launch.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const owned = await chromium.launchServer({ ...launch, host: '127.0.0.1' });
  const browser = await chromium.connect(owned.wsEndpoint());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [], stages = [];
  page.setDefaultTimeout(20000);
  page.on('pageerror', e => errors.push(e.stack || e.message));
  const stage = name => { console.log('Interface: ' + name); stages.push(name); };
  const command = async (menu, action) => {
    await page.locator('[data-studio-menu="' + menu + '"]').click();
    await page.locator('#sf-studio-menu-' + menu + ' [data-studio-command="' + action + '"]').click();
  };
  const shot = name => page.screenshot({ path: path.join(out, name + '.png') });
  const scene = () => page.evaluate(() => {
    const c = SkyForgeCore;
    return { objects: c.store.get('scene.referenceObjects'), graph: c.nodeGraph.serialize(), keys: c.timeline.serializeKeyframes() };
  });
  try {
    await page.goto(process.env.SKYFORGE_TEST_URL || 'http://127.0.0.1:3000', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => globalThis.SkyForgeCore?.viewport?.renderer?.frames > 0, null, { timeout: 60000 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.sf-studio-document')).display === 'flex');
    // Render real WebGL with a lower-cost cloud pass while testing UI behavior.
    await page.evaluate(() => SkyForgeCore.store.set('viewport.cloudMode', 'layer', { record: false }));
    stage('all 52 original commands and real WebGL remain available');
    const actual = await page.locator('.sf-studio-menu').evaluateAll(menus => Object.fromEntries(menus.map(menu => [
      menu.querySelector('[data-studio-menu]').dataset.studioMenu,
      [...menu.querySelectorAll('[data-studio-command]')].map(button => [button.dataset.studioCommand, button.querySelector('.sf-menu-label').textContent])
    ])));
    assert.deepEqual(actual, contract);
    assert.equal(await page.locator('#sf-studio-menus').count(), 1);
    assert.equal(await page.locator('.menubar .mb-menus').isVisible(), false);
    assert.equal(await page.evaluate(() => SkyForgeCore.viewport.active), true);
    assert.equal(await page.locator('.sf-studio-version').textContent(), 'R17');
    await shot('interface-desktop');

    stage('keyboard menus: entry, wrapping, disabled commands, Escape and Tab');
    await page.locator('[data-studio-menu="File"]').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('[data-studio-command="new"]').evaluate(e => e === document.activeElement), true);
    await page.keyboard.press('End');
    assert.equal(await page.locator('[data-studio-command="capture"]').evaluate(e => e === document.activeElement), true);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('[data-studio-menu="Edit"]').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.disabled), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-studio-menu="Edit"]').evaluate(e => e === document.activeElement), true);
    assert.equal(await page.locator('.sf-studio-dropdown:not([hidden])').count(), 0);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.sf-studio-dropdown:not([hidden])').count(), 0);
    await page.locator('[data-studio-menu="File"]').click();
    await shot('interface-file-menu');
    await page.keyboard.press('Escape');

    stage('original object commands and one-step Undo / Redo');
    const count = await page.evaluate(() => Object.keys(SkyForgeCore.store.get('scene.referenceObjects')).length);
    await command('Scene', 'add-sphere');
    assert.equal(await page.evaluate(() => Object.keys(SkyForgeCore.store.get('scene.referenceObjects')).length), count + 1);
    assert.equal(await page.locator('.sf-studio-empty').isVisible(), false);
    await command('Edit', 'undo');
    assert.equal(await page.evaluate(() => Object.keys(SkyForgeCore.store.get('scene.referenceObjects')).length), count);
    await command('Edit', 'redo');
    assert.equal(await page.evaluate(() => Object.keys(SkyForgeCore.store.get('scene.referenceObjects')).length), count + 1);
    const before = await scene();
    for (const preset of ['Animation', 'Nodes', 'Sky']) await page.locator('[data-studio-preset="' + preset + '"]').click();
    assert.deepEqual(await scene(), before, 'workspace choices never replace scene, graph or timeline');

    stage('each sky inspector section, celestial tabs and original editor commands');
    for (const section of ['sun', 'clouds', 'location', 'lighting', 'effects']) {
      await command('Sky', 'sky-' + section);
      assert.equal(await page.locator('[data-studio-sky="' + section + '"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.sf-studio-sky .sf-studio-sky-section').count(), 1);
    }
    await page.locator('[data-effect-tab="moon"]').click();
    await shot('interface-moon');
    await command('Animation', 'timeline');
    assert.equal(await page.locator('.sf-studio-timeline').isVisible(), true);
    await command('Nodes', 'nodes');
    assert.equal(await page.locator('.sf-studio-nodes').isVisible(), true);
    await command('View', 'reset');

    stage('laptop and narrow menus fit their viewports without document overflow');
    for (const size of [{ width: 1280, height: 720 }, { width: 760, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      for (const name of Object.keys(contract)) {
        const trigger = page.locator('[data-studio-menu="' + name + '"]');
        await trigger.click();
        const rect = await page.locator('#sf-studio-menu-' + name).boundingBox();
        assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= size.width + 1 && rect.y + rect.height <= size.height + 1, name + ' fits ' + size.width);
        await page.keyboard.press('Escape');
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok((await page.locator('.sf-3d-canvas').boundingBox()).width >= 100);
      await shot('interface-' + size.width);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    stage('Legacy restores original controls and Studio can be reopened');
    await command('View', 'legacy');
    assert.equal(await page.locator('.menubar .mb-menus').isVisible(), true);
    assert.equal(await page.locator('#sf-studio-menus').isVisible(), false);
    assert.equal(await page.locator('.sf-studio-document').isVisible(), false);
    await page.locator('[data-studio-action="legacy"]').click();
    assert.equal(await page.locator('#sf-studio-menus').isVisible(), true);
    assert.deepEqual(await scene(), before);
    await shot('interface-restored');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'interface-results.json'), JSON.stringify({ stages, errors, commands: Object.values(actual).flat().length }, null, 2));
    console.log('Interface integration passed');
  } catch (error) {
    await shot('interface-failure').catch(() => {});
    throw error;
  } finally {
    await browser.close().catch(() => {});
    await owned.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
