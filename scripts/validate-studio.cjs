// Full Studio flow through the real gateway, DOM, State Store and GPU shaders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SKYFORGE_TEST_URL || 'http://127.0.0.1:3000';
const out = process.env.SKYFORGE_TEST_OUTPUT || '/tmp/skyforge-studio-browser';
const expectVolume = process.env.SKYFORGE_EXPECT_VOLUMETRIC === '1';
fs.mkdirSync(out, { recursive: true });
const timeout = (promise, milliseconds, label) => {
  let timer;
  return Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds} ms`)), milliseconds); })]).finally(() => clearTimeout(timer));
};
const vector = value => Array.isArray(value) ? value : [value, value, value];

(async () => {
  const launch = { headless: true };
  if (process.env.PLAYWRIGHT_CHANNEL) launch.channel = process.env.PLAYWRIGHT_CHANNEL;
  if (process.env.SKYFORGE_WEBGL_BACKEND !== 'native') launch.args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  // Public BrowserServer ownership gives cleanup a precise fallback: terminate
  // only this gate's browser if native driver shutdown stalls.
  const ownedBrowser = await chromium.launchServer({ ...launch, host: '127.0.0.1' });
  const browser = await chromium.connect(ownedBrowser.wsEndpoint());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [], requests = [], results = { backend: process.env.SKYFORGE_WEBGL_BACKEND || 'swiftshader', stages: [], performance: [] };
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.stack || error.message }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ type: 'console', message: message.text() }); });
  page.on('request', request => { if (request.url().includes('/api/lighting/preview')) requests.push({ time: Date.now(), method: request.method() }); });
  const evaluate = (fn, arg) => timeout(page.evaluate(fn, arg), 20000, 'Browser evaluation');
  const read = path => evaluate(path => SkyForgeCore.store.get(path), path);
  const history = () => evaluate(() => SkyForgeCore.store.history.length);
  const frames = () => evaluate(() => SkyForgeCore.viewport.renderer.frames);
  const nextFrame = async before => page.waitForFunction(count => SkyForgeCore.viewport.renderer.frames > count && SkyForgeCore.viewport.frame === null, before);
  const draw = async (fn, arg) => { const before = await frames(); await evaluate(fn, arg); await nextFrame(before); };
  const numeric = async (selector, value) => { const input = page.locator(selector); await input.fill(String(value)); await input.press('Tab'); };
  const controlValue = (selector, value) => page.locator(selector).first().evaluate((input, value) => {
    const scale = { 'clouds.coverage': .01, 'clouds.density': .01, 'sun.intensity': .1, 'camera.exposure': .1 }[input.dataset.sfCorePath] || 1;
    input.value = String(value / scale); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  const stage = label => { console.log(`Studio: ${label}`); results.stages.push(label); };
  const snapshot = () => evaluate(() => ({ scene: SkyForgeCore.store.get('scene'), nodes: SkyForgeCore.nodeGraph.serialize(), keys: SkyForgeCore.timeline.serializeKeyframes() }));
  const selected = () => read('scene.selectedReferenceId');
  const reference = id => read(`scene.referenceObjects.${id}`);
  const gpuPixels = () => evaluate(() => new Promise((resolve, reject) => {
    const viewport = SkyForgeCore.viewport;
    const timer = setTimeout(() => reject(new Error('GPU sample did not render')), 10000);
    viewport.invalidate();
    requestAnimationFrame(() => {
      try {
        const gl = viewport.renderer.gl, width = viewport.canvas.width, height = viewport.canvas.height, pixels = [];
        for (const [fx, fy] of [[0.2, 0.7], [0.5, 0.8], [0.8, 0.7], [0.5, 0.5]]) {
          const part = new Uint8Array(12 * 12 * 4);
          gl.readPixels(Math.max(0, Math.min(width - 12, Math.floor(width * fx))), Math.max(0, Math.min(height - 12, Math.floor(height * fy))), 12, 12, gl.RGBA, gl.UNSIGNED_BYTE, part);
          pixels.push(...part);
        }
        clearTimeout(timer); resolve({ pixels, error: gl.getError(), width, height });
      } catch (error) { clearTimeout(timer); reject(error); }
    });
  }));
  const canvasPoint = id => evaluate(async id => {
    const { projectPoint } = await import('/src/client/viewport/reference-geometry.js');
    const viewport = SkyForgeCore.viewport, rect = viewport.canvas.getBoundingClientRect(), object = SkyForgeCore.store.get(`scene.referenceObjects.${id}`);
    const point = projectPoint(object.position, viewport.camera, rect.width / rect.height, SkyForgeCore.store.get('camera.fov'));
    return { x: rect.x + (point.x + 1) * rect.width / 2, y: rect.y + (1 - point.y) * rect.height / 2 };
  }, id);
  const transformHandle = axis => evaluate(axis => {
    const viewport = SkyForgeCore.viewport, rect = viewport.canvas.getBoundingClientRect();
    const segment = viewport.referenceGizmo.segments.find(segment => segment.axis === axis && segment.enabled !== false);
    if (!segment) return null;
    if (segment.points?.length) {
      const index = Math.floor(segment.points.length * 0.22), start = segment.points[index], end = segment.points[Math.min(segment.points.length - 1, index + Math.max(3, Math.floor(segment.points.length * 0.1)))];
      return { x: rect.x + start[0], y: rect.y + start[1], dx: end[0] - start[0], dy: end[1] - start[1] };
    }
    const dx = segment.end[0] - segment.start[0], dy = segment.end[1] - segment.start[1], length = Math.hypot(dx, dy);
    return { x: rect.x + segment.start[0] + dx * 0.75, y: rect.y + segment.start[1] + dy * 0.75, dx: dx / length * 30, dy: dy / length * 30 };
  }, axis);
  const dragTransform = async (axis, cancel = false) => {
    const handle = await transformHandle(axis); assert.ok(handle, `${axis} transform handle exists`);
    await page.mouse.move(handle.x, handle.y); await page.mouse.down();
    assert.equal(await evaluate(() => Boolean(SkyForgeCore.viewport.referenceGizmo.drag)), true, 'actual pointer hit owns a transform gesture');
    const before = await frames();
    await page.mouse.move(handle.x + handle.dx, handle.y + handle.dy, { steps: 5 }); await nextFrame(before);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  const nodeTitle = id => page.locator(`[data-node-drag="${id}"]`);
  const nodeParam = async (id, type, key, value) => { await nodeTitle(id).click(); await numeric(`.sf-ng-inspector input[aria-label="${type} ${key}"]`, value); };
  const socket = (node, side, name) => page.locator(`.sf-ng-socket[data-node="${node}"][data-side="${side}"][data-socket="${name}"]`);
  const scrub = frame => numeric('.sf-studio-timeline input[aria-label="Frame"]', frame);
  const addKey = async (path, frame) => { if (frame !== undefined) await scrub(frame); await page.locator('.sf-studio-timeline select[aria-label="Animation property"]').selectOption(path); await page.locator('[data-studio-action="add-keyframe"]').click(); };
  const selectKey = (path, frame) => page.locator(`.sf-tl-key[data-path="${path}"][data-frame="${frame}"]`).click();
  const readDownload = async download => {
    const stream = await download.createReadStream(), chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  const run = async () => {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.SkyForgeCore?.workspace?.editors && SkyForgeCore.nodePanel && SkyForgeCore.timelinePanel && SkyForgeCore.viewport?.renderer?.frames > 0, null, { timeout: 40000 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('sf-studio-toolbar')).display === 'flex');
    results.webgl = await evaluate(() => { const gl = SkyForgeCore.viewport.renderer.gl, debug = gl.getExtension('WEBGL_debug_renderer_info'); return { version: gl.getParameter(gl.VERSION), renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL || gl.RENDERER), error: gl.getError() }; });
    assert.equal(results.webgl.error, 0); assert.equal(await evaluate(() => SkyForgeCore.viewport.active), true);
    if (expectVolume) assert.equal((await evaluate(() => SkyForgeCore.viewport.renderer.cloudMetrics))?.mode, 'volumetric', 'volume gate requires the real GPU pass');
    stage('workspace presets, resize, collapse, maximize and legacy access');
    for (const preset of ['Sky', 'Animation', 'Nodes']) {
      await page.locator(`[data-studio-preset="${preset}"]`).click();
      assert.equal((await evaluate(() => SkyForgeCore.workspace.layout)).preset, preset);
      const box = await page.locator('.sf-3d-canvas').boundingBox(); assert.ok(box.width >= 300 && box.height >= 180, 'viewport retains usable space');
    }
    const layoutBefore = await evaluate(() => SkyForgeCore.workspace.layout), separator = await page.locator('.sf-studio-resize-left').boundingBox();
    await page.mouse.move(separator.x + 2, separator.y + 50); await page.mouse.down(); await page.mouse.move(separator.x + 28, separator.y + 50); await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual(await evaluate(() => SkyForgeCore.workspace.layout), layoutBefore, 'Escape cancels layout resizing');
    await page.mouse.move(separator.x + 2, separator.y + 50); await page.mouse.down(); await page.mouse.move(separator.x + 22, separator.y + 50); await page.mouse.up();
    assert.ok((await evaluate(() => SkyForgeCore.workspace.layout)).left > layoutBefore.left);
    for (const action of ['left', 'right', 'bottom']) {
      await page.locator(`[data-studio-action="${action}"]`).click(); assert.equal((await evaluate(() => SkyForgeCore.workspace.layout))[`${action}Collapsed`], true);
      await page.locator(`[data-studio-action="${action}"]`).click(); assert.equal((await evaluate(() => SkyForgeCore.workspace.layout))[`${action}Collapsed`], false);
    }
    await page.locator('.sf-3d-canvas').focus(); await page.keyboard.press('Shift+Space'); assert.equal((await evaluate(() => SkyForgeCore.workspace.layout)).maximized, true);
    await page.locator('[data-studio-action="maximize"]').click(); assert.equal((await evaluate(() => SkyForgeCore.workspace.layout)).maximized, false);
    await page.locator('[data-studio-action="legacy"]').click(); assert.equal(await evaluate(() => SkyForgeCore.workspace.legacy), true);
    assert.equal(await page.locator('.rpanel .sf-outliner').count(), 1, 'original tools are restored in Legacy workspace');
    const legacyBox = await page.locator('.sf-3d-canvas').boundingBox(); assert.ok(legacyBox.width >= 300 && legacyBox.height >= 180, 'hidden Studio panels do not consume the original workspace grid');
    await page.locator('[data-studio-action="legacy"]').click();
    await page.locator('[data-vp="mode"]').click(); assert.equal(await page.locator('[data-studio-action="capture"]').isDisabled(), true, 'PNG capture is disabled in Legacy View');
    await page.locator('[data-vp="mode"]').click(); assert.equal(await page.locator('[data-studio-action="capture"]').isEnabled(), true);

    stage('create sphere, cube and plane; numeric transforms, gizmos and one Undo per gesture');
    await page.locator('[data-studio-preset="Sky"]').click();
    const exposureBefore = await read('camera.exposure'), exposureHistory = await history();
    await page.locator('#sf-studio-exposure').fill('1.4'); assert.equal(await read('camera.exposure'), 1.4); assert.equal(await history(), exposureHistory);
    assert.equal((await evaluate(() => SkyForgeCore.projects.createDocument())).payload.camera.exposure, exposureBefore, 'project saves the committed preview exposure');
    await page.locator('#sf-studio-exposure').press('Escape'); assert.equal(await read('camera.exposure'), exposureBefore); assert.equal(await history(), exposureHistory);
    await numeric('#sf-studio-exposure', 1.5); assert.equal(await history(), exposureHistory + 1);
    await page.locator('[data-studio-action="undo"]').click(); assert.equal(await read('camera.exposure'), exposureBefore);
    const ids = {};
    for (const type of ['sphere', 'cube', 'plane']) { await page.locator(`[data-studio-action="add-${type}"]`).click(); ids[type] = await selected(); assert.equal((await reference(ids[type])).type, type); }
    await page.locator(`[data-sf-reference-id="${ids.cube}"]`).click();
    await numeric('#sf-ins-name', 'Studio cube');
    assert.equal((await reference(ids.cube)).name, 'Studio cube');
    for (const [index, axis] of ['x', 'y', 'z'].entries()) await numeric(`#tri-pos-${axis}`, [3.125, -1.25, 1.5][index]);
    for (const [index, axis] of ['x', 'y', 'z'].entries()) await numeric(`#sf-ref-rotation-${axis}`, [10, 20, 35][index]);
    for (const [index, axis] of ['x', 'y', 'z'].entries()) await numeric(`#sf-ref-scale-${axis}`, [1.2, 0.8, 1.4][index]);
    let cube = await reference(ids.cube);
    assert.deepEqual(cube.position, [3.125, -1.25, 1.5]); assert.deepEqual(cube.rotation, [10, 20, 35]); assert.deepEqual(vector(cube.scale), [1.2, 0.8, 1.4]);
    await page.locator('[data-studio-action="frame"]').click(); await page.waitForTimeout(150);
    assert.deepEqual((await read('viewport.camera')).target, cube.position);
    const point = await canvasPoint(ids.cube); await evaluate(() => SkyForgeCore.store.set('scene.selectedReferenceId', null, { record: false }));
    await page.mouse.click(point.x, point.y); assert.equal(await selected(), ids.cube, 'GPU-visible object is picked by an actual canvas click');
    for (const [tool, property] of [['move', 'position'], ['rotate', 'rotation'], ['scale', 'scale']]) {
      await page.locator(`[data-studio-action="${tool}"]`).click(); await page.waitForTimeout(100);
      const before = await reference(ids.cube), count = await history();
      await dragTransform('x'); cube = await reference(ids.cube);
      assert.notDeepEqual(cube[property], before[property], `${tool} gizmo changes its actual transform`);
      assert.equal(await history(), count + 1, `${tool} gesture creates one Undo entry`);
      await page.locator('[data-studio-action="undo"]').click(); assert.deepEqual((await reference(ids.cube))[property], before[property]);
      await page.locator('[data-studio-action="redo"]').click(); assert.deepEqual((await reference(ids.cube))[property], cube[property]);
      const cancelBefore = await reference(ids.cube), cancelCount = await history(); await page.waitForTimeout(100); await dragTransform('x', true);
      assert.deepEqual(await reference(ids.cube), cancelBefore); assert.equal(await history(), cancelCount, `${tool} Escape preserves history`);
    }
    await page.locator('[data-studio-action="move"]').click(); await page.locator('[data-studio-space]').selectOption('local'); assert.equal(await read('viewport.transformSpace'), 'local');
    const localBefore = await reference(ids.cube); await page.waitForTimeout(100); await dragTransform('x'); const localAfter = await reference(ids.cube);
    assert.ok(localAfter.position.some((value, axis) => axis > 0 && Math.abs(value - localBefore.position[axis]) > .001), 'local X follows the rotated object rather than global X');
    await page.locator('[data-studio-action="undo"]').click(); assert.deepEqual((await reference(ids.cube)).position, localBefore.position);
    await page.locator('[data-studio-space]').selectOption('global');
    const cubeRow = page.locator(`[data-sf-reference-id="${ids.cube}"]`);
    await cubeRow.locator('.tri-lock').click(); assert.equal((await reference(ids.cube)).locked, true);
    const locked = await reference(ids.cube);
    if (await page.locator('#tri-pos-x').isEnabled()) await numeric('#tri-pos-x', 100);
    assert.deepEqual(await reference(ids.cube), locked, 'locked numeric edits cannot change a reference');
    await cubeRow.locator('.tri-lock').click(); await cubeRow.locator('.tri-eye').click(); assert.equal((await reference(ids.cube)).visible, false);
    await cubeRow.locator('.tri-eye').click(); assert.equal((await reference(ids.cube)).visible, true);
    await page.locator('button[onclick="sfDuplicateSelectedObject()"]').click(); const duplicate = await selected(); assert.notEqual(duplicate, ids.cube); assert.ok(await reference(duplicate));
    page.once('dialog', dialog => dialog.accept()); await page.locator('button.sf-mini-btn[onclick="sfDeleteSelectedObject()"]').click(); assert.equal(await reference(duplicate), undefined);
    await page.locator('[data-studio-action="undo"]').click(); assert.ok(await reference(duplicate)); await page.locator('[data-studio-action="redo"]').click(); assert.equal(await reference(duplicate), undefined);
    await cubeRow.click();
    const cameraBefore = await read('viewport.camera'), bounds = await page.locator('.sf-3d-canvas').boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .6); await page.keyboard.down('Alt'); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .65 + 35, bounds.y + bounds.height * .6 + 10, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Alt');
    assert.notEqual((await read('viewport.camera')).yaw, cameraBefore.yaw, 'Mac Option navigation survives Studio tools');
    await page.locator('[data-studio-action="undo"]').click();

    stage('node parameters, graph authority, sockets, rejection, drag, pan and zoom');
    await page.locator('[data-studio-preset="Nodes"]').click(); await page.getByRole('button', { name: 'Frame graph', exact: true }).click();
    await page.locator('[data-studio-action="use-graph"]').click(); assert.equal(await evaluate(() => SkyForgeCore.composition.authority), 'graph');
    await nodeParam('clouds', 'Clouds', 'coverage', 0);
    const pixelsBefore = await gpuPixels();
    await nodeParam('sun', 'Sun', 'elevation', 55); await nodeParam('sun', 'Sun', 'azimuth', 150); await nodeParam('sun', 'Sun', 'intensity', 4);
    assert.equal((await read('sun')).elevation, 55); assert.equal((await read('sun')).azimuth, 150); assert.equal((await read('sun')).intensity, 4);
    const sunPixels = await gpuPixels(); assert.equal(sunPixels.error, 0); assert.notDeepEqual(sunPixels.pixels, pixelsBefore.pixels, 'Sun node changes real framebuffer pixels');
    await nodeParam('atmosphere', 'Atmosphere', 'haze', .7); assert.equal((await read('atmosphere')).haze, .7);
    const atmospherePixels = await gpuPixels(); assert.notDeepEqual(atmospherePixels.pixels, sunPixels.pixels, 'Atmosphere node changes real framebuffer pixels');
    await nodeParam('clouds', 'Clouds', 'coverage', .85); await nodeParam('clouds', 'Clouds', 'density', 1.1); assert.equal((await read('clouds')).coverage, .85);
    const cloudPixels = await gpuPixels(); assert.notDeepEqual(cloudPixels.pixels, atmospherePixels.pixels, 'Clouds node affects the GPU preview');
    await nodeParam('color-grade', 'ColorGrade', 'exposure', -.8); assert.equal((await read('color')).exposure, -.8);
    const gradePixels = await gpuPixels(); assert.notDeepEqual(gradePixels.pixels, cloudPixels.pixels, 'ColorGrade has implemented visible output');
    const connections = await read('nodes.connections');
    await socket('sun', 'output', 'sun').click(); await socket('sky-scene', 'input', 'clouds').click(); assert.deepEqual(await read('nodes.connections'), connections);
    assert.match(await page.locator('.sf-ng-status').innerText(), /type mismatch/i);
    await socket('output', 'output', 'output').click(); await socket('color-grade', 'input', 'input').click(); assert.deepEqual(await read('nodes.connections'), connections);
    assert.match(await page.locator('.sf-ng-status').innerText(), /cycle/i);
    await nodeTitle('sky-scene').click(); await page.getByRole('button', { name: 'Disconnect clouds', exact: true }).click(); assert.equal((await read('nodes.connections')).length, connections.length - 1);
    await socket('clouds', 'output', 'clouds').click(); await socket('sky-scene', 'input', 'clouds').click(); assert.equal((await read('nodes.connections')).length, connections.length);
    const nodeBefore = (await read('nodes.nodes')).find(node => node.id === 'sun'), nodeBox = await nodeTitle('sun').boundingBox(), nodeHistory = await history();
    await page.mouse.move(nodeBox.x + 25, nodeBox.y + 10); await page.mouse.down(); await page.mouse.move(nodeBox.x + 60, nodeBox.y + 22, { steps: 5 }); await page.mouse.up();
    const movedNode = (await read('nodes.nodes')).find(node => node.id === 'sun'); assert.notDeepEqual(movedNode.position, nodeBefore.position); assert.equal(await history(), nodeHistory + 1);
    await page.locator('[data-studio-action="undo"]').click(); assert.deepEqual((await read('nodes.nodes')).find(node => node.id === 'sun').position, nodeBefore.position);
    await page.locator('[data-studio-action="redo"]').click(); assert.deepEqual((await read('nodes.nodes')).find(node => node.id === 'sun').position, movedNode.position);
    const nodeView = await evaluate(() => SkyForgeCore.nodePanel.view), nodeArea = await page.locator('.sf-ng-view').boundingBox();
    await page.mouse.move(nodeArea.x + nodeArea.width * .7, nodeArea.y + 15); await page.mouse.down({ button: 'middle' }); await page.mouse.move(nodeArea.x + nodeArea.width * .7 + 30, nodeArea.y + 30); await page.mouse.up({ button: 'middle' });
    assert.notEqual((await evaluate(() => SkyForgeCore.nodePanel.view)).x, nodeView.x);
    await page.mouse.wheel(0, -70); await page.waitForFunction(zoom => SkyForgeCore.nodePanel.view.zoom > zoom, nodeView.zoom);
    await page.locator('[data-studio-inspector="sky"]').click();
    await controlValue('[data-sf-core-path="sun.elevation"]', 30);
    assert.equal(await evaluate(() => SkyForgeCore.composition.authority), 'direct', 'a direct control explicitly takes authority away from the graph');
    await page.locator('[data-studio-action="use-graph"]').click(); assert.equal((await read('sun')).elevation, 55);

    stage('animate Sun, clouds, exposure and object transforms; key selection, drag, cancel, Undo/Redo and playback');
    await page.locator('[data-studio-preset="Animation"]').click();
    await numeric('.sf-studio-timeline input[aria-label="Start"]', 1); await numeric('.sf-studio-timeline input[aria-label="End"]', 48); await numeric('.sf-studio-timeline input[aria-label="FPS"]', 12);
    await page.locator('.sf-studio-timeline input[aria-label="Loop animation"]').uncheck();
    const transformPath = `scene.referenceObjects.${ids.cube}`;
    const animatedPaths = ['sun.azimuth', 'sun.elevation', 'sun.intensity', 'clouds.coverage', 'clouds.density', 'camera.exposure', `${transformPath}.position`, `${transformPath}.rotation`, `${transformPath}.scale`];
    for (const keyPath of animatedPaths) await addKey(keyPath, 1);
    // End poses come from implemented controls, then the UI inserts their values.
    await scrub(48); await page.locator('[data-studio-inspector="sky"]').click();
    await controlValue('[data-sf-core-path="sun.azimuth"]', 250); await addKey('sun.azimuth');
    await controlValue('[data-sf-core-path="sun.elevation"]', 40); await addKey('sun.elevation');
    await controlValue('[data-sf-core-path="sun.intensity"]', 2); await addKey('sun.intensity');
    await controlValue('[data-sf-core-path="clouds.coverage"]', .25); await addKey('clouds.coverage');
    await controlValue('[data-sf-core-path="clouds.density"]', .4); await addKey('clouds.density');
    await numeric('#sf-studio-exposure', 2); await addKey('camera.exposure');
    await cubeRow.click(); await numeric('#tri-pos-x', 5.5); await addKey(`${transformPath}.position`);
    await numeric('#sf-ref-rotation-z', 60); await addKey(`${transformPath}.rotation`);
    await numeric('#sf-ref-scale-x', 1.8); await addKey(`${transformPath}.scale`);
    const populatedKeys = await read('timeline.keyframes');
    for (const keyPath of animatedPaths) assert.equal(populatedKeys[keyPath].length, 2, `UI keys animate ${keyPath}`);
    await selectKey('sun.azimuth', 1); await page.locator('.sf-studio-timeline select[aria-label="Keyframe interpolation"]').selectOption('smooth'); assert.equal((await read('timeline.keyframes'))['sun.azimuth'][0].interpolation, 'smooth');
    await selectKey('sun.intensity', 1); await page.locator('.sf-studio-timeline select[aria-label="Keyframe interpolation"]').selectOption('step'); assert.equal((await read('timeline.keyframes'))['sun.intensity'][0].interpolation, 'step');
    await selectKey('sun.elevation', 1); await page.locator('.sf-studio-timeline select[aria-label="Keyframe interpolation"]').selectOption('linear');
    await scrub(24); const sampledSun = await read('sun.azimuth'); assert.ok(sampledSun > 150 && sampledSun < 250, 'scrub samples the edited animation tracks');
    const keyBefore = await read('timeline.keyframes'), keyHistory = await history(), keyBox = await page.locator('.sf-tl-key[data-path="sun.azimuth"][data-frame="48"]').boundingBox();
    await page.mouse.move(keyBox.x + keyBox.width / 2, keyBox.y + keyBox.height / 2); await page.mouse.down(); await page.mouse.move(keyBox.x + keyBox.width / 2 - 55, keyBox.y + keyBox.height / 2, { steps: 5 }); await page.mouse.up();
    const keysMoved = await read('timeline.keyframes'); assert.notDeepEqual(keysMoved, keyBefore); assert.equal(await history(), keyHistory + 1, 'keyframe drag creates one Undo entry');
    await page.locator('[data-studio-action="undo"]').click(); assert.deepEqual(await read('timeline.keyframes'), keyBefore);
    await page.locator('[data-studio-action="redo"]').click(); assert.deepEqual(await read('timeline.keyframes'), keysMoved);
    const movedFrame = keysMoved['sun.azimuth'][1].frame; await selectKey('sun.azimuth', movedFrame); await page.getByRole('button', { name: 'Delete keys', exact: true }).click(); assert.equal((await read('timeline.keyframes'))['sun.azimuth'].length, 1);
    await page.locator('[data-studio-action="undo"]').click(); assert.deepEqual(await read('timeline.keyframes'), keysMoved);
    const keyCancelBox = await page.locator(`.sf-tl-key[data-path="sun.azimuth"][data-frame="${movedFrame}"]`).boundingBox(), cancelKeys = await read('timeline.keyframes'), cancelHistory = await history();
    await page.mouse.move(keyCancelBox.x + keyCancelBox.width / 2, keyCancelBox.y + keyCancelBox.height / 2); await page.mouse.down(); await page.mouse.move(keyCancelBox.x - 20, keyCancelBox.y + 5); await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual(await read('timeline.keyframes'), cancelKeys); assert.equal(await history(), cancelHistory, 'Escape cancels a keyframe gesture');
    await scrub(1); await page.waitForTimeout(1000); const playHistory = await history(), playRequests = requests.length, playFrames = await frames();
    await page.getByRole('button', { name: 'Play', exact: true }).click(); await page.waitForFunction(() => SkyForgeCore.timeline.currentFrame >= 5); await page.getByRole('button', { name: 'Pause', exact: true }).click();
    assert.equal(await history(), playHistory, 'display frames never fill Undo history'); assert.ok(await frames() > playFrames);
    await page.waitForTimeout(500); assert.equal(requests.length, playRequests, 'animation adds no physical evaluation requests');
    assert.ok((await read('sun.azimuth')) !== 150, 'playback applies animated values');

    if (expectVolume) {
      stage('volumetric GPU quality, bounded buffers, wind/frame and layer fallback');
      await page.locator('[data-studio-preset="Sky"]').click();
      const hasQuality = await page.locator('[data-vp="cloudQuality"]').count(); assert.equal(hasQuality, 1, 'quality control is present');
      for (const quality of ['low', 'medium', 'high']) {
        await page.locator('[data-vp="cloudQuality"]').selectOption(quality);
        await page.waitForFunction(quality => SkyForgeCore.viewport.renderer.cloudMetrics?.quality === quality && SkyForgeCore.viewport.frame === null, quality);
        const sample = await evaluate(() => {
          const viewport = SkyForgeCore.viewport, gl = viewport.renderer.gl, pixel = new Uint8Array(4);
          const state = SkyForgeCore.store.snapshot(), timings = [];
          for (let index = 0; index < 6; index++) {
            const begin = performance.now(); viewport.renderer.draw(state, viewport.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            if (index) timings.push(performance.now() - begin); // Discard warmup.
          }
          const sorted = [...timings].sort((a, b) => a - b);
          return { ...viewport.renderer.cloudMetrics, drawReadbackMs: sorted[2], timings, error: gl.getError() };
        });
        assert.equal(sample.mode, 'volumetric'); assert.equal(sample.error, 0); assert.ok(sample.samples <= 44 && sample.shadowSamples <= 3); assert.ok(sample.pixels <= 900000); results.performance.push(sample);
      }
      await page.locator('[data-vp="cloudQuality"]').selectOption('low');
      const cloudBefore = await gpuPixels(); await draw(() => SkyForgeCore.timeline.seek(40)); const cloudAfter = await gpuPixels();
      assert.notDeepEqual(cloudAfter.pixels, cloudBefore.pixels, 'wind and timeline frame alter volume pixels');
      await page.locator('[data-vp="cloudMode"]').selectOption('layer'); await page.waitForFunction(() => SkyForgeCore.viewport.renderer.cloudMetrics?.mode === 'layer');
      assert.equal((await gpuPixels()).error, 0, 'existing cloud layer remains usable');
      await page.locator('[data-vp="cloudMode"]').selectOption('volumetric');
    }

    stage('save, reopen, autosave and workspace persistence');
    await page.locator('[data-studio-preset="Nodes"]').click();
    const saved = await snapshot(), savedLayout = await evaluate(() => SkyForgeCore.workspace.layout);
    const projectDownloadPromise = page.waitForEvent('download'); await page.locator('[data-studio-action="save"]').click(); const projectDownload = await projectDownloadPromise;
    assert.match(projectDownload.suggestedFilename(), /\.skyforge$/); const projectBuffer = await readDownload(projectDownload), document = JSON.parse(projectBuffer.toString());
    assert.equal(document.kind, 'skyforge.project'); assert.deepEqual(document.payload.scene.referenceObjects, saved.scene.referenceObjects); assert.deepEqual(document.payload.nodes, saved.nodes); assert.deepEqual(document.payload.timeline.keyframes, saved.keys);
    await page.locator('[data-studio-action="new"]').click(); assert.deepEqual(await read('scene.referenceObjects'), {});
    const fileChooserPromise = page.waitForEvent('filechooser'); await page.locator('[data-studio-action="open"]').click(); const chooser = await fileChooserPromise;
    await chooser.setFiles({ name: 'studio-flow.skyforge', mimeType: 'application/json', buffer: projectBuffer });
    await page.waitForFunction(objects => JSON.stringify(SkyForgeCore.store.get('scene.referenceObjects')) === JSON.stringify(objects), saved.scene.referenceObjects);
    assert.deepEqual(await read('nodes'), saved.nodes); assert.deepEqual(await read('timeline.keyframes'), saved.keys);
    const reopenedLayout = await evaluate(() => SkyForgeCore.workspace.layout);
    for (const key of ['preset', 'left', 'right', 'bottom', 'editor']) assert.deepEqual(reopenedLayout[key], savedLayout[key], 'project loading preserves workspace dimensions and editor choice');
    await evaluate(() => SkyForgeCore.store.persist());
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => globalThis.SkyForgeCore?.workspace && SkyForgeCore.viewport?.renderer?.frames > 0);
    await page.waitForTimeout(1000);
    const recoveryDismiss = page.locator('#sf-recovery-banner button[onclick="sfDismissLocalRecovery()"]');
    if (await recoveryDismiss.count()) {
      const legacyRecovery = await evaluate(() => localStorage.getItem('skyforge.localRecovery.v1'));
      await recoveryDismiss.click();
      assert.equal(await evaluate(() => localStorage.getItem('skyforge.localRecovery.v1')), legacyRecovery, 'dismissing the old recovery banner preserves its snapshot');
    }
    assert.deepEqual(await read('scene.referenceObjects'), saved.scene.referenceObjects); assert.deepEqual(await read('nodes'), saved.nodes); assert.deepEqual(await read('timeline.keyframes'), saved.keys);
    assert.deepEqual(await evaluate(() => SkyForgeCore.workspace.layout), reopenedLayout, 'panel layout and preset survive reload independently of project data');
    await page.waitForFunction(() => !globalThis.SkyForgeNaturalLightPreview?.getState?.()?.enabled || Boolean(SkyForgeNaturalLightPreview.getState().skyViewLut), null, { timeout: 40000 });
    await evaluate(() => { globalThis.__sfStudioGateIdle = null; });
    await page.waitForFunction(() => {
      const viewport = SkyForgeCore.viewport, count = viewport.renderer.frames, now = performance.now();
      if (!globalThis.__sfStudioGateIdle || globalThis.__sfStudioGateIdle.count !== count || viewport.frame !== null) {
        globalThis.__sfStudioGateIdle = { count, since: now }; return false;
      }
      return now - globalThis.__sfStudioGateIdle.since >= 800;
    }, null, { timeout: 15000 });
    const idleFrames = await frames(); await page.waitForTimeout(350); assert.equal(await frames(), idleFrames, 'idle Studio renders on demand');
    const documentBeforeUndo = await evaluate(() => SkyForgeCore.projects.createDocument());
    await cubeRow.click(); const oldX = (await reference(ids.cube)).position[0]; await numeric('#tri-pos-x', oldX + 1);
    await page.locator('[data-studio-action="undo"]').click(); assert.equal((await reference(ids.cube)).position[0], oldX);
    await page.locator('[data-studio-action="redo"]').click(); assert.equal((await reference(ids.cube)).position[0], oldX + 1);
    assert.deepEqual((await evaluate(() => SkyForgeCore.projects.createDocument())).payload.nodes, documentBeforeUndo.payload.nodes, 'transform history preserves reopened node graph');

    stage('hidden-window lifecycle pauses playback and demand rendering');
    await page.locator('[data-studio-preset="Animation"]').click(); await page.getByRole('button', { name: 'Play', exact: true }).click();
    await evaluate(() => {
      // Trigger the native visibility listener under its hidden-document condition.
      // Chrome headless keeps tabs visible, so the condition is controlled here.
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await evaluate(() => SkyForgeCore.timeline.playing), false);
    const hiddenFrames = await frames(); await evaluate(() => SkyForgeCore.viewport.invalidate()); await page.waitForTimeout(250);
    assert.equal(await frames(), hiddenFrames, 'hidden document does not submit GPU frames');
    await draw(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });

    stage('PNG preview capture and resource disposal');
    const pngDownloadPromise = page.waitForEvent('download'); await page.locator('[data-studio-action="capture"]').click(); const pngDownload = await pngDownloadPromise;
    assert.match(pngDownload.suggestedFilename(), /preview.*\.png$/i); const png = await readDownload(pngDownload);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]); assert.ok(png.length > 1000);
    results.png = { name: pngDownload.suggestedFilename(), bytes: png.length, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    assert.ok(results.png.width >= 100 && results.png.height >= 100);
    fs.writeFileSync(path.join(out, 'studio-webgl-preview.png'), png);
    const capture = await evaluate(() => SkyForgeCore.viewport.capturePreview({ download: false })); assert.equal(capture.label, 'SkyForge WebGL preview'); assert.ok(capture.dataUrl.startsWith('data:image/png;base64,'));
    const finalGpu = await gpuPixels(); assert.equal(finalGpu.error, 0); assert.ok(finalGpu.pixels.some((value, index) => index % 4 !== 3 && value > 0));
    await page.screenshot({ path: path.join(out, 'studio-workspace.png') });
    results.disposal = await evaluate(() => {
      const viewport = SkyForgeCore.viewport, renderer = viewport.renderer, gl = renderer.gl, buffers = [...renderer.resources];
      const programs = [renderer.sky, renderer.mesh, ...(renderer.cloudPrograms?.values?.() || [])].filter(Boolean);
      SkyForgeCore.dispose();
      return { remainingBuffers: buffers.filter(buffer => gl.isBuffer(buffer)).length,
        programsDeleted: programs.every(program => !gl.isProgram(program) || gl.getProgramParameter(program, gl.DELETE_STATUS)), pendingFrame: viewport.frame };
    });
    assert.equal(results.disposal.remainingBuffers, 0); assert.equal(results.disposal.programsDeleted, true); assert.equal(results.disposal.pendingFrame, null);
    assert.equal(await page.locator('.sf-3d-canvas').count(), 0); assert.equal(await page.locator('#sf-studio-toolbar').count(), 0);
    assert.equal(await evaluate(() => Boolean(globalThis.SkyForgeCore)), false);
    const fatal = errors.filter(error => error.type === 'pageerror' ? !/signal is aborted without reason/i.test(error.message) : /shader|WebGL.*INVALID|SkyViewportRenderer|Maximum call stack|state store listener failed|timeline listener failed|node graph listener failed/i.test(error.message));
    assert.deepEqual(fatal, [], 'no runtime, shader or synchronization errors');
    results.physicalRequests = requests.length; results.passed = true;
    console.log('Studio flow passed', JSON.stringify({ webgl: results.webgl, png: results.png, stages: results.stages.length, performance: results.performance }));
  };
  try { await timeout(run(), 12 * 60 * 1000, 'Studio browser gate'); }
  catch (error) { results.passed = false; results.failure = error.stack || error.message; throw error; }
  finally {
    try { fs.writeFileSync(path.join(out, 'studio-results.json'), JSON.stringify({ ...results, errors }, null, 2)); }
    finally {
      try { await timeout(browser.close(), 10000, 'Disconnect browser'); }
      finally {
        try { await timeout(ownedBrowser.close(), 45000, 'Browser shutdown'); results.cleanup = 'closed'; }
        catch (error) { await timeout(ownedBrowser.kill(), 10000, 'Terminate owned browser'); results.cleanup = 'owned browser terminated after shutdown timeout'; }
        fs.writeFileSync(path.join(out, 'studio-results.json'), JSON.stringify({ ...results, errors }, null, 2));
      }
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
