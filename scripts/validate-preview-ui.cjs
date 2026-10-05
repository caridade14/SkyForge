// Regression gate for the ordinary startup camera and visible Studio commands.
// Uses the real gateway, DOM and WebGL readbacks; never substitutes a renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SKYFORGE_TEST_URL || 'http://127.0.0.1:3000';
const out = process.env.SKYFORGE_TEST_OUTPUT || '/tmp/skyforge-preview-ui';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const launch = { headless: true };
  if (process.env.PLAYWRIGHT_CHANNEL) launch.channel = process.env.PLAYWRIGHT_CHANNEL;
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launch.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (process.env.SKYFORGE_WEBGL_BACKEND !== 'native') launch.args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const studioCommand=async(menu,action)=>{if(!(await page.locator('#sf-studio-menus').isVisible())){const original={physical:'sun',home:'home',frame:'frame',grid:'grid',overlays:'overlays'}[action];return original?page.locator(`[data-vp="${original}"]`).click():page.locator(`[data-studio-action="${action}"]`).click();}await page.locator(`[data-studio-menu="${menu}"]`).click();await page.locator(`#sf-studio-menus [aria-label="${menu}"] [data-studio-command="${action}"]`).click();};
  const errors = [], requests = [], failedLighting = [], results = { backend: process.env.SKYFORGE_WEBGL_BACKEND || 'swiftshader', checks: [], metrics: {} };
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
  page.on('request', request => { if (request.url().includes('/api/lighting/preview')) requests.push(request.url()); });
  page.on('response', response => { if (response.url().includes('/api/lighting/preview') && response.status() >= 400) failedLighting.push({ status: response.status(), input: response.request().postData(), response: response.text().catch(() => '') }); });
  const stage = name => { console.log(`Preview/UI: ${name}`); results.checks.push(name); };
  const read = name => page.evaluate(name => SkyForgeCore.store.get(name), name);
  const command = async (menu, action) => { await page.locator(`[data-studio-menu="${menu}"]`).click(); await page.locator(`#sf-studio-menus [aria-label="${menu}"] [data-studio-command="${action}"]`).click(); };
  const input = name => page.locator(`[data-sf-core-path="${name}"]`).first();
  const setRange = (name, raw) => input(name).evaluate((input, raw) => { input.value = String(raw); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }, raw);
  const pixels = async () => {
    return page.evaluate(() => new Promise((resolve, reject) => {
      const viewport = SkyForgeCore.viewport, timer = setTimeout(() => reject(new Error('GPU readback did not finish')), 15000);
      viewport.invalidate(); requestAnimationFrame(() => {
        try {
          const gl = viewport.renderer.gl, w = viewport.canvas.width, h = viewport.canvas.height, bytes = new Uint8Array(w * h * 4), start = performance.now();
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          const elapsed = performance.now() - start, sky = [], object = [];
          for (let y = Math.floor(h * .76); y < h; y += 2) for (let x = 0; x < w; x += 2) { const i = (y * w + x) * 4; sky.push(...bytes.slice(i, i + 3)); }
          for (let y = Math.floor(h * .4); y < h * .55; y += 2) for (let x = Math.floor(w * .43); x < w * .57; x += 2) { const i = (y * w + x) * 4; object.push(...bytes.slice(i, i + 3)); }
          clearTimeout(timer); resolve({ sky, object, error: gl.getError(), elapsed, w, h, metrics: viewport.renderer.cloudMetrics });
        } catch (error) { clearTimeout(timer); reject(error); }
      });
    }));
  };
  const difference = (a, b) => { assert.equal(a.length, b.length); let total = 0, changed = 0; for (let i = 0; i < a.length; i += 3) { const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); total += d / 3; if (d > 12) changed++; } return { mean: total / (a.length / 3), fraction: changed / (a.length / 3) }; };
  const luminance = a => { let sum = 0; for (let i = 0; i < a.length; i += 3) sum += .2126 * a[i] + .7152 * a[i + 1] + .0722 * a[i + 2]; return sum / (a.length / 3); };
  const downloadText = async download => { const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk); return Buffer.concat(chunks).toString('utf8'); };
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => globalThis.SkyForgeCore?.nodePanel && SkyForgeCore.viewport?.renderer?.frames > 0);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('sf-studio-menus')).display === 'flex');
    stage('clouds visible in the unchanged startup camera, within Low budget');
    const camera = await read('viewport.camera');
    const clouds = await pixels();
    assert.equal(clouds.error, 0); assert.equal(clouds.metrics.mode, 'volumetric'); assert.equal(clouds.metrics.samples, 16); assert.ok(clouds.metrics.pixels <= 250000); assert.ok(clouds.w * clouds.h <= 2000000);
    await page.screenshot({ path: path.join(out, 'preview-ui-startup.png') });
    await page.evaluate(() => SkyForgeCore.store.set('clouds.coverage', 0)); const clear = await pixels();
    results.metrics.startupClouds = difference(clouds.sky, clear.sky);
    assert.ok(results.metrics.startupClouds.fraction > .05, `clouds affect visible startup sky: ${JSON.stringify(results.metrics.startupClouds)}`);
    assert.deepEqual(await read('viewport.camera'), camera, 'visibility fix does not reposition the camera');

    stage('normal Studio density scale and Undo/Redo synchronize slider and readout');
    await command('Sky', 'sky-clouds'); assert.equal(await page.locator('#sec-clouds').isVisible(), true); assert.equal(await page.locator('#sec-sun').isVisible(), false);
    assert.equal(Number(await input('clouds.density').inputValue()), 7);
    const history = await page.evaluate(() => SkyForgeCore.store.history.length);
    await setRange('clouds.density', 8); assert.equal(await read('clouds.density'), .8);
    assert.equal(await page.evaluate(() => SkyForgeCore.store.history.length), history + 1);
    await command('Edit', 'undo'); assert.equal(Number(await input('clouds.density').inputValue()), 7);
    await command('Edit', 'redo'); assert.equal(Number(await input('clouds.density').inputValue()), 8);
    await page.locator('[data-cloud-preset="Cumulus"]').click(); assert.equal(await read('clouds.density'), .7);
    assert.equal(Number(await input('clouds.density').inputValue()), 7);
    assert.equal(Number(await input('clouds.coverage').inputValue()), 62);
    for (const shape of ['Stratus', 'Cirrus', 'Cumulonimbus', 'Altostratus', 'Cumulus']) {
      await page.getByLabel('Cloud shape', { exact: true }).selectOption(shape);
      const frame = await pixels(); assert.equal(frame.error, 0); assert.equal(frame.metrics.samples, 16); assert.equal(await read('clouds.type'), shape);
    }
    await page.screenshot({ path: path.join(out, 'preview-ui-clouds.png') });

    stage('noon, dawn and night share lighting; no daylight object illumination at night');
    await command('Sky', 'sky-sun'); await page.locator('[data-studio-sun-preset="Noon"]').click();
    assert.equal(await read('sun.elevation'), 60); assert.equal(Number(await input('sun.elevation').inputValue()), 60);
    const noon = await pixels(); await page.screenshot({ path: path.join(out, 'preview-ui-noon.png') });
    assert.equal(noon.metrics.cloudShadows, true, 'ground and references use the real density shadow shader');
    await command('Sky', 'sky-clouds'); await page.locator('[data-cloud-preset="Clear"]').click(); const clearNoon = await pixels();
    await page.locator('[data-cloud-preset="Overcast"]').click(); const overcast = await pixels();
    results.metrics.cloudShadow = { clear: luminance(clearNoon.object), overcast: luminance(overcast.object) };
    assert.ok(results.metrics.cloudShadow.overcast < results.metrics.cloudShadow.clear - 2, `clouds attenuate object sunlight: ${JSON.stringify(results.metrics.cloudShadow)}`);
    await page.locator('[data-cloud-preset="Cumulus"]').click(); await command('Sky', 'sky-sun');
    await page.locator('[data-studio-sun-preset="Sunset"]').click(); const sunset = await pixels();
    await page.screenshot({ path: path.join(out, 'preview-ui-sunset.png') });
    await page.locator('[data-studio-sun-preset="Night"]').click(); const night = await pixels();
    await page.screenshot({ path: path.join(out, 'preview-ui-night.png') });
    results.metrics.light = { noon: luminance(noon.sky), sunset: luminance(sunset.sky), night: luminance(night.sky), objectNoon: luminance(noon.object), objectNight: luminance(night.object) };
    assert.ok(results.metrics.light.night < results.metrics.light.noon * .35, JSON.stringify(results.metrics.light));
    assert.ok(results.metrics.light.objectNight < results.metrics.light.objectNoon * .35, JSON.stringify(results.metrics.light));
    assert.ok(difference(noon.sky, sunset.sky).mean > 3);
    await command('Edit', 'undo'); assert.equal(await read('sun.elevation'), 2);

    stage('Core, workspace reset and editor menus expose their actual panels');
    await studioCommand('Help','hub'); assert.equal(await page.locator('.sf-core-hub [data-panel="project"]').isVisible(), true);
    await page.locator('.sf-core-hub [data-action="close"]').last().click();
    await page.locator('[data-studio-action="maximize"]').click();
    await command('Help', 'hub'); await page.locator('.sf-core-hub [data-action="reset-layout"]').click();
    await page.locator('.sf-core-hub [data-action="close"]').last().click();
    const layout = await page.evaluate(() => SkyForgeCore.workspace.layout); assert.equal(layout.maximized, false); assert.equal(layout.leftCollapsed, false); assert.equal(layout.inspector, 'sky');
    await command('Animation', 'add-key'); assert.equal(await page.locator('.sf-studio-timeline').isVisible(), true);
    assert.ok((await read('timeline.keyframes'))['sun.azimuth'].length > 0);
    await command('Nodes', 'nodes'); assert.equal(await page.locator('.sf-studio-nodes').isVisible(), true);
    await command('Nodes', 'frame-graph'); await command('Nodes', 'from-controls'); await command('Nodes', 'graph');
    assert.equal(await read('scene.authority'), 'graph');
    await command('Nodes', 'direct'); assert.equal(await read('scene.authority'), 'direct');
    await command('Help', 'bridge'); assert.equal(await page.locator('.sf-core-hub [data-panel="bridge"]').isVisible(), true);
    await page.locator('.sf-core-hub [data-action="close"]').last().click();
    await command('Help', 'help'); assert.equal(await page.locator('.sf-studio-guide').isVisible(), true); await page.locator('.sf-studio-guide button').click();
    await page.locator('.sf-studio-outliner [title="Add reference geometry (Scene menu)"]').click();
    assert.equal(await page.locator('[data-studio-menu="Scene"]').getAttribute('aria-expanded'), 'true');
    await page.locator('#sf-studio-menus [data-studio-command="add-cube"]').click();
    const referenceId = await read('scene.selectedReferenceId'); assert.equal((await read(`scene.referenceObjects.${referenceId}`)).type, 'cube');
    await command('Edit', 'duplicate'); assert.equal(Object.keys(await read('scene.referenceObjects')).length, 2);
    let deleteConfirmation;
    page.once('dialog', dialog => { deleteConfirmation = dialog.type(); return dialog.accept(); });
    await command('Edit', 'delete'); assert.equal(deleteConfirmation, 'confirm'); assert.equal(Object.keys(await read('scene.referenceObjects')).length, 1);

    stage('file menus save current Core state and report invalid project files without replacing it');
    const downloading = page.waitForEvent('download'); await command('File', 'save'); const saved = await downloadText(await downloading), savedDocument = JSON.parse(saved);
    assert.equal(savedDocument.kind, 'skyforge.project'); assert.equal(savedDocument.payload.clouds.density, .7);
    const beforeOpen = await read('sun');
    const choosing = page.waitForEvent('filechooser'); await command('File', 'open');
    await (await choosing).setFiles({ name: 'invalid.skyforge', mimeType: 'application/json', buffer: Buffer.from('not json') });
    await page.waitForFunction(() => document.querySelector('.sf-core-toast.error')?.textContent.includes('not valid JSON'));
    assert.deepEqual(await read('sun'), beforeOpen);
    const choosingSaved = page.waitForEvent('filechooser'); await command('File', 'open');
    await (await choosingSaved).setFiles({ name: 'saved.skyforge', mimeType: 'application/json', buffer: Buffer.from(saved) });
    await page.waitForFunction(() => !SkyForgeCore.store.canUndo());
    assert.deepEqual(await read('clouds'), savedDocument.payload.clouds);
    await command('Sky', 'sky-clouds'); assert.equal(Number(await input('clouds.density').inputValue()), 7);
    assert.equal(await page.locator('[data-studio-action="undo"]').isDisabled(), true);
    await page.evaluate(() => SkyForgeCore.store.set('clouds.density', .345));
    assert.equal(Number(await input('clouds.density').inputValue()), 3.45, 'animated/node values are not rounded to an old slider step');
    assert.equal(await page.locator('[data-studio-action="undo"]').isDisabled(), false);

    stage('keyboard ownership, menu keyboard access, Legacy preservation and idle rendering');
    await page.locator('.sf-3d-canvas').focus(); await page.evaluate(() => { SkyForgeCore.store.set('clouds.density', .4); SkyForgeCore.store.set('clouds.density', .5); });
    await page.keyboard.press('Control+z'); assert.equal(await read('clouds.density'), .4);
    await page.keyboard.press('Control+Shift+z'); assert.equal(await read('clouds.density'), .5);
    const menu = page.locator('[data-studio-menu="View"]'); await menu.focus(); await page.keyboard.press('ArrowDown');
    assert.equal(await menu.getAttribute('aria-expanded'), 'true'); await page.keyboard.press('Escape'); assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    await command('View', 'legacy'); assert.equal(await page.locator('.mb-menus').isVisible(), true); assert.equal(await page.locator('#sf-new-type').isVisible(), true);
    await page.locator('[data-studio-action="legacy"]').click(); assert.equal(await page.locator('#sf-studio-menus').isVisible(), true);
    await page.evaluate(() => SkyForgeCore.viewport.invalidate()); await page.waitForTimeout(2500);
    await page.waitForFunction(() => SkyForgeCore.viewport.frame === null && SkyForgeCore.store.get('engine.lighting.status') !== 'evaluating');
    const counts = await page.evaluate(() => SkyForgeCore.viewport.renderer.frames), countRequests = requests.length;
    await page.waitForTimeout(1400); assert.equal(await page.evaluate(() => SkyForgeCore.viewport.renderer.frames), counts, 'idle does not redraw continuously');
    assert.equal(requests.length, countRequests, 'idle does not start another physical-light loop');
    results.metrics.readbackMs = { startup: clouds.elapsed, noon: noon.elapsed, night: night.elapsed };
    // A cloud snapshot may exclude the repository's unchanged photo assets;
    // an unavailable optional web font must not mask application/API errors.
    const fatal = errors.filter(error => !/fonts\.googleapis\.com/.test(error) && !/status of 404.*\/assets\/(?:startup-skyforge-splash\.png|earth-blue-marble\.jpg|world-map-reference(?:-significados)?\.(?:jpg|png))$/.test(error));
    assert.deepEqual(fatal, [], 'no runtime, API, shader or synchronization errors');
    assert.deepEqual(failedLighting.map(({ status, input }) => ({ status, input })), [], 'scene edits produce valid physical-light inputs'); console.log('PASS: natural preview and Studio UI regression gate');
  } catch (error) {
    results.failure = error.stack || error.message; await page.screenshot({ path: path.join(out, 'preview-ui-failure.png') }).catch(() => {}); throw error;
  } finally {
    results.errors = errors; results.failedLighting = await Promise.all(failedLighting.map(async item => ({ ...item, response: await item.response }))); fs.writeFileSync(path.join(out, 'preview-ui-results.json'), JSON.stringify(results, null, 2)); await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
