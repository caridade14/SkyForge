// Integration gate against the real gateway, shaders and legacy page. No mocked renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SKYFORGE_TEST_URL || 'http://127.0.0.1:3000';
const out = process.env.SKYFORGE_TEST_OUTPUT || '/tmp/skyforge-viewport-browser';
fs.mkdirSync(out, { recursive: true });

(async () => {
  // CI uses Chromium's actual WebGL implementation with a software GPU. On a Mac,
  // PLAYWRIGHT_CHANNEL=chrome selects installed Chrome; SKYFORGE_WEBGL_BACKEND=native
  // omits the software-GPU flags to exercise its native backend.
  const launch = { headless: true };
  if (process.env.PLAYWRIGHT_CHANNEL) launch.channel = process.env.PLAYWRIGHT_CHANNEL;
  if (process.env.SKYFORGE_WEBGL_BACKEND !== 'native') launch.args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const requests = [];
  page.on('request', r => { if (r.url().includes('/api/lighting/preview')) requests.push(r.postData()); });
  const readCamera = () => page.evaluate(() => SkyForgeCore.store.get('viewport.camera'));
  const readSun = () => page.evaluate(() => SkyForgeCore.store.get('sun'));
  const historyLength = () => page.evaluate(() => SkyForgeCore.store.history.length);
  const frameCount = () => page.evaluate(() => SkyForgeCore.viewport.renderer.frames);
  // A prior pending draw can finish between reading the counter and making a
  // mutation. Also wait for the newly invalidated frame to finish, so marker
  // geometry is sampled from the same rendered Store state.
  const nextFrame = async before => page.waitForFunction(count =>
    SkyForgeCore.viewport.renderer.frames > count && SkyForgeCore.viewport.frame === null, before);
  const mutateAndDraw = async (fn, arg) => {
    const before = await frameCount();
    await page.evaluate(fn, arg);
    await nextFrame(before);
  };
  const marker = () => page.evaluate(() => {
    const gizmo = SkyForgeCore.viewport.sunGizmo;
    const rect = gizmo.marker.getBoundingClientRect();
    const canvas = SkyForgeCore.viewport.canvas.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
      offscreen: gizmo.marker.classList.contains('sf-sun-offscreen'),
      pointerEvents: getComputedStyle(gizmo.marker).pointerEvents,
      aria: gizmo.marker.getAttribute('aria-label'),
      canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height } };
  });
  const assertSunUI = async sun => {
    const ui = await page.evaluate(() => ({
      controls: [...document.querySelectorAll('[data-sf-core-path="sun.elevation"],[data-sf-core-path="sun.azimuth"]')].map(control => ({
        axis: control.dataset.sfCorePath.split('.')[1], value: Number(control.value),
        label: control.closest('.sl-wrap,.s-row,.tog-row,.prefs-field,.rp-sec')?.querySelector('.sl-val')?.textContent
      })),
      elevation: document.getElementById('v-elev')?.textContent,
      azimuth: document.getElementById('v-az')?.textContent
    }));
    const diagnostics = JSON.stringify({ desired: sun, ui });
    for (const axis of ['azimuth', 'elevation']) {
      assert.ok(ui.controls.some(control => control.axis === axis), `${axis} controls are bound`);
      assert.ok(Math.abs(parseFloat(ui[axis]) - sun[axis]) <= 0.101, `${axis} readout tracks Store: ${diagnostics}`);
    }
    for (const control of ui.controls) {
      assert.ok(Math.abs(control.value - sun[control.axis]) <= 0.101, `${control.axis} slider tracks Store at its 0.1° step: ${diagnostics}`);
      if (control.label) assert.ok(Math.abs(parseFloat(control.label) - sun[control.axis]) <= 0.101, `${control.axis} .sl-val tracks Store: ${diagnostics}`);
    }
  };
  const placeSunAtCenter = async () => {
    await mutateAndDraw(() => {
      const camera = SkyForgeCore.viewport.camera;
      SkyForgeCore.store.set('sun', { ...SkyForgeCore.store.get('sun'),
        azimuth: ((-camera.yaw * 180 / Math.PI) % 360 + 360) % 360,
        elevation: -camera.pitch * 180 / Math.PI });
      SkyForgeCore.viewport.invalidate();
    });
    return marker();
  };
  const startSunDrag = async (dx = 55, dy = -25) => {
    const position = await marker();
    await page.mouse.move(position.x, position.y);
    await page.mouse.down({ button: 'left' });
    assert.equal(await page.evaluate(() => Boolean(SkyForgeCore.viewport.sunGizmo.drag)), true, 'LMB marker hit starts a sun gesture');
    const before = await frameCount();
    await page.mouse.move(position.x + dx, position.y + dy, { steps: 4 });
    await nextFrame(before);
    return position;
  };
  const assertIdle = async () => {
    await page.waitForTimeout(180);
    const frames = await frameCount();
    await page.waitForTimeout(350);
    assert.equal(await frameCount(), frames, 'rendering sleeps after the gesture');
  };
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.SkyForgeCore?.viewport?.renderer?.frames > 0, {}, { timeout: 30000 });
    assert.equal(await page.evaluate(() => SkyForgeCore.viewport.active), true, 'WebGL initializes on the real page');
    const webgl = await page.evaluate(() => {
      const gl = SkyForgeCore.viewport.renderer.gl;
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { version: gl.getParameter(gl.VERSION), vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL || gl.VENDOR),
        renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL || gl.RENDERER), error: gl.getError() };
    });
    console.log('Real WebGL', webgl, 'browser channel:', process.env.PLAYWRIGHT_CHANNEL || 'chromium');
    fs.writeFileSync(path.join(out, 'webgl.json'), JSON.stringify(webgl, null, 2));
    assert.equal(webgl.error, 0, 'No WebGL errors');
    const canvas = page.locator('.sf-3d-canvas');
    const box = await canvas.boundingBox();
    assert.ok(box && box.width > 0);
    const cx = box.x + box.width * 0.5, cy = box.y + box.height * 0.55;
    const original = await readCamera();
    console.log('Viewport initialized', box);
    const before = await canvas.screenshot();
    await page.screenshot({ path: path.join(out, 'viewport-initial.png') });
    await page.mouse.move(cx, cy); await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + 90, cy + 30, { steps: 6 }); await page.mouse.up({ button: 'middle' });
    const orbited = await readCamera();
    assert.notEqual(orbited.yaw, original.yaw, 'MMB orbits');
    await page.evaluate(() => SkyForgeCore.store.undo());
    assert.deepEqual(await readCamera(), original, 'one navigation gesture = one undo step');
    await page.evaluate(() => SkyForgeCore.store.redo());
    assert.deepEqual(await readCamera(), orbited);
    await page.keyboard.down('Shift'); await page.mouse.move(cx, cy); await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + 35, cy - 25, { steps: 4 }); await page.mouse.up({ button: 'middle' }); await page.keyboard.up('Shift');
    const panned = await readCamera();
    assert.notDeepEqual(panned.target, orbited.target); assert.equal(panned.yaw, orbited.yaw);
    await page.mouse.wheel(0, -150); await page.waitForTimeout(150);
    assert.ok((await readCamera()).distance < panned.distance);
    const beforeAlt = await readCamera();
    await page.keyboard.down('Alt'); await page.mouse.down(); await page.mouse.move(cx - 45, cy + 10, { steps: 4 });
    await page.mouse.up(); await page.keyboard.up('Alt');
    assert.notEqual((await readCamera()).yaw, beforeAlt.yaw, 'Mac Option/Alt emulation orbits');
    await canvas.focus(); await page.keyboard.press('Numpad7');
    assert.equal((await readCamera()).projection, 'orthographic'); assert.ok((await readCamera()).pitch > 1.5);
    await page.screenshot({ path: path.join(out, 'viewport-top.png') });
    await page.keyboard.press('Numpad5'); assert.equal((await readCamera()).projection, 'perspective');
    await page.keyboard.press('Home'); assert.deepEqual(await readCamera(), original);
    const history = await historyLength();
    await page.mouse.move(cx, cy); await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + 60, cy + 10, { steps: 4 }); await page.keyboard.press('Escape'); await page.mouse.up({ button: 'middle' });
    assert.deepEqual(await readCamera(), original); assert.equal(await historyLength(), history);

    // Store edits, timeline seek and project reload all update the same renderer.
    await mutateAndDraw(() => {
      SkyForgeCore.store.set('sun.elevation', 55); SkyForgeCore.store.set('clouds.coverage', 0.1); SkyForgeCore.store.set('camera.exposure', 2);
    });
    assert.notDeepEqual(await canvas.screenshot(), before, 'scene controls affect rendered pixels');
    const serialized = await page.evaluate(() => SkyForgeCore.projects.createDocument());
    await page.evaluate(doc => SkyForgeCore.projects.loadDocument(doc), serialized);
    assert.equal((await readSun()).elevation, 55);
    await page.waitForFunction(() => SkyForgeNaturalLightPreview.getState().skyViewLut !== null, {}, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const requestCount = requests.length;
    await page.mouse.move(cx, cy); await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + 50, cy + 20, { steps: 5 }); await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(700);
    assert.equal(requests.length, requestCount, 'camera navigation does not evaluate Natural Light');
    await assertIdle();

    // Both control directions use real legacy inputs and readouts, with no synthetic renderer.
    const oldMarker = await marker();
    await mutateAndDraw(() => {
      for (const [axis, value] of [['azimuth', 330.2], ['elevation', -8.3]]) {
        const control = document.querySelector(`[data-sf-core-path="sun.${axis}"]`);
        control.value = value; control.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    const controlledSun = await readSun();
    assert.equal(controlledSun.azimuth, 330.2); assert.equal(controlledSun.elevation, -8.3);
    const controlledMarker = await marker();
    assert.ok(Math.hypot(controlledMarker.x - oldMarker.x, controlledMarker.y - oldMarker.y) > 2, 'controls move the sun marker');
    assert.equal(controlledMarker.pointerEvents, 'none', 'overlay leaves pointer arbitration to the canvas');
    await assertSunUI(controlledSun);
    // Native range keyboard events have browser-defined input/change dispatch;
    // they must stay synchronized after every legacy listener has run.
    await page.locator('[data-sf-core-path="sun.azimuth"]').first().focus();
    const nativeFrame = await frameCount();
    await page.keyboard.press('ArrowRight');
    await nextFrame(nativeFrame);
    const nativeSun = await readSun();
    assert.ok(Math.abs(nativeSun.azimuth - controlledSun.azimuth - 0.1) < 1e-8, 'native ArrowRight updates azimuth by its 0.1° step');
    assert.equal(nativeSun.elevation, controlledSun.elevation);
    await assertSunUI(nativeSun);
    await mutateAndDraw(() => {
      SkyForgeCore.store.set('sun.azimuth', 329.25); SkyForgeCore.store.set('sun.elevation', -4.25);
    });
    await assertSunUI(await readSun());
    assert.match((await marker()).aria, /azimuth 329\.3.*elevation -4\.3/);

    // First marker gesture begins while a sun control owns focus (blur must not cancel it).
    const initialMarker = await placeSunAtCenter();
    const initialSun = await readSun(), gestureCamera = await readCamera(), gestureHistory = await historyLength();
    await page.locator('[data-sf-core-path="sun.azimuth"]').first().evaluate(control => control.focus());
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.sfCorePath), 'sun.azimuth', 'sun slider owns focus before the first marker gesture');
    await page.mouse.move(initialMarker.x, initialMarker.y); await page.mouse.down({ button: 'left' });
    assert.equal(await page.evaluate(() => Boolean(SkyForgeCore.viewport.sunGizmo.drag)), true, 'focused slider does not cancel marker pointerdown');
    const dragRequests = requests.length;
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(initialMarker.x + i * 7, initialMarker.y - i * 3.5, { steps: 2 });
      await page.waitForTimeout(175);
    }
    const previewSun = await readSun();
    assert.notDeepEqual(previewSun, initialSun, 'drag updates Store before pointerup');
    assert.deepEqual(await readCamera(), gestureCamera, 'sun drag preserves camera');
    assert.equal(await historyLength(), gestureHistory, 'drag preview adds no undo entries');
    assert.equal(await page.evaluate(() => SkyForgeCore.store.activeEdit?.path), 'sun');
    assert.equal(await page.evaluate(() => SkyForgeCore.viewport.renderer.usingLut), false, 'manual sun uses analytic preview without moving the physical evaluation');
    await assertSunUI(previewSun);
    const movingMarker = await marker();
    assert.ok(Math.hypot(movingMarker.x - initialMarker.x - 70, movingMarker.y - initialMarker.y + 35) < 2, 'marker follows live pointer');
    const exportedSun = await page.evaluate(() => {
      SkyForgeCore.store.persist();
      return { project: SkyForgeCore.projects.createDocument().payload.sun,
        autosave: JSON.parse(localStorage.getItem(SkyForgeCore.store.storageKey)).sun };
    });
    assert.deepEqual(exportedSun.project, initialSun, 'project export excludes unfinished gesture');
    assert.deepEqual(exportedSun.autosave, initialSun, 'autosave excludes unfinished gesture');
    assert.equal(requests.length, dragRequests, 'prolonged manual drag does not request physical evaluations');
    await page.mouse.up({ button: 'left' });
    assert.equal(await historyLength(), gestureHistory + 1, 'one sun gesture creates exactly one undo entry');
    assert.equal(await page.evaluate(() => SkyForgeCore.viewport.sunGizmo.drag), null);
    assert.equal(await page.evaluate(() => SkyForgeCore.store.activeEdit), null);
    const committedSun = await readSun();
    assert.deepEqual(committedSun, previewSun);
    await mutateAndDraw(() => SkyForgeCore.store.undo());
    assert.deepEqual(await readSun(), initialSun, 'Undo restores both angles together');
    await assertSunUI(initialSun);
    assert.ok(Math.hypot((await marker()).x - initialMarker.x, (await marker()).y - initialMarker.y) < 2, 'Undo restores marker');
    await mutateAndDraw(() => SkyForgeCore.store.redo());
    assert.deepEqual(await readSun(), committedSun, 'Redo restores both angles together');
    await assertSunUI(committedSun);
    await assertIdle();
    assert.equal(requests.length, dragRequests, 'commit, Undo and Redo do not restart physical evaluation');
    await page.screenshot({ path: path.join(out, 'viewport-sun-gizmo.png') });

    const escapeSun = await readSun(), escapeHistory = await historyLength();
    await startSunDrag(); await page.keyboard.press('Escape'); await page.mouse.up({ button: 'left' });
    assert.deepEqual(await readSun(), escapeSun, 'Escape restores both angles');
    assert.equal(await historyLength(), escapeHistory, 'Escape adds no history');
    assert.equal(await page.evaluate(() => SkyForgeCore.store.activeEdit), null);
    await assertSunUI(escapeSun);

    // Navigation wins over the marker for Option/Alt+LMB and MMB.
    for (const button of ['left', 'middle']) {
      const position = await placeSunAtCenter();
      const sun = await readSun(), camera = await readCamera();
      await page.mouse.move(position.x, position.y);
      if (button === 'left') await page.keyboard.down('Alt');
      await page.mouse.down({ button }); await page.mouse.move(position.x + 40, position.y + 20, { steps: 4 });
      assert.equal(await page.evaluate(() => SkyForgeCore.viewport.sunGizmo.drag), null, `${button} navigation does not capture sun`);
      await page.mouse.up({ button }); if (button === 'left') await page.keyboard.up('Alt');
      assert.notEqual((await readCamera()).yaw, camera.yaw, `${button === 'left' ? 'Option/Alt+LMB' : 'MMB'} over marker orbits camera`);
      assert.deepEqual(await readSun(), sun, 'marker navigation preserves sun angles');
    }
    await page.locator('[data-vp=projection]').click();
    assert.equal((await readCamera()).projection, 'orthographic');
    await placeSunAtCenter();
    const orthoSun = await readSun(), orthoCamera = await readCamera(), orthoHistory = await historyLength();
    await startSunDrag(60, -35); await page.mouse.up({ button: 'left' });
    assert.notDeepEqual(await readSun(), orthoSun, 'orthographic drag changes sun direction');
    assert.deepEqual(await readCamera(), orthoCamera);
    assert.equal(await historyLength(), orthoHistory + 1);
    await assertSunUI(await readSun());
    await page.locator('[data-vp=projection]').click();

    await mutateAndDraw(() => {
      const camera = SkyForgeCore.viewport.camera;
      SkyForgeCore.store.set('sun', { ...SkyForgeCore.store.get('sun'),
        azimuth: ((180 - camera.yaw * 180 / Math.PI) % 360 + 360) % 360,
        elevation: camera.pitch * 180 / Math.PI });
    });
    const outsideMarker = await marker();
    assert.equal(outsideMarker.offscreen, true, 'sun behind the camera retains an edge marker');
    assert.ok(outsideMarker.x >= box.x && outsideMarker.x <= box.x + box.width && outsideMarker.y >= box.y && outsideMarker.y <= box.y + box.height);
    const outsideHistory = await historyLength();
    await page.mouse.move(outsideMarker.x, outsideMarker.y); await page.mouse.down({ button: 'left' });
    const outsideFrame = await frameCount();
    await page.mouse.move(cx, box.y + box.height / 2, { steps: 8 }); await page.mouse.up({ button: 'left' }); await nextFrame(outsideFrame);
    assert.equal((await marker()).offscreen, false, 'drag brings offscreen sun into view');
    assert.equal(await historyLength(), outsideHistory + 1);

    // Physical evaluation remains explicit and uses its existing LUT once angles match.
    await page.locator('[data-vp=sun]').click();
    await page.waitForFunction(() => SkyForgeCore.viewport.renderer.usingLut === true, {}, { timeout: 10000 });
    const solar = await page.evaluate(() => SkyForgeCore.viewport.payload.evaluation.solarPosition);
    assert.equal((await readSun()).azimuth, solar.azimuthDeg);
    assert.equal((await readSun()).elevation, solar.apparentElevationDeg);
    await assertSunUI(await readSun());
    await page.screenshot({ path: path.join(out, 'viewport-physical-lut.png') });

    // Mode switches cancel a live gesture before recording the mode itself.
    await placeSunAtCenter();
    const modeSun = await readSun(), modeSunEdits = await page.evaluate(() => SkyForgeCore.store.history.filter(change => change.path === 'sun').length);
    await startSunDrag(); await page.evaluate(() => SkyForgeCore.viewport.action('mode')); await page.mouse.up({ button: 'left' });
    assert.equal(await page.evaluate(() => SkyForgeCore.viewport.active), false);
    assert.equal(await page.locator('#vp-canvas').isVisible(), true, 'legacy renderer stays available');
    assert.deepEqual(await readSun(), modeSun, 'mode switch cancels preview');
    assert.equal(await page.evaluate(() => SkyForgeCore.store.history.filter(change => change.path === 'sun').length), modeSunEdits);
    await page.locator('[data-vp=mode]').click();
    assert.equal(await page.evaluate(() => SkyForgeCore.viewport.active), true);

    // Actual GPU context loss during a gesture cancels it, then recovers the renderer.
    await placeSunAtCenter();
    const lossSun = await readSun(), lossHistory = await historyLength();
    await startSunDrag();
    await page.evaluate(() => {
      window.testLoss = SkyForgeCore.viewport.renderer.gl.getExtension('WEBGL_lose_context');
      if (!testLoss) throw new Error('WEBGL_lose_context extension is unavailable');
      testLoss.loseContext();
    });
    await page.waitForFunction(() => !SkyForgeCore.viewport.active);
    await page.mouse.up({ button: 'left' });
    assert.deepEqual(await readSun(), lossSun, 'context loss cancels sun preview');
    assert.equal(await historyLength(), lossHistory);
    assert.equal(await page.locator('#vp-canvas').isVisible(), true);
    await page.evaluate(() => testLoss.restoreContext());
    await page.waitForFunction(() => SkyForgeCore.viewport.active && SkyForgeCore.viewport.renderer.frames > 0);
    assert.equal(await page.evaluate(() => SkyForgeCore.viewport.renderer.gl.getError()), 0);

    // Pre-viewport project files retain their sun and receive the default camera.
    const currentDocument = await page.evaluate(() => SkyForgeCore.projects.createDocument());
    await mutateAndDraw(doc => {
      delete doc.checksum; delete doc.payload.viewport;
      doc.version = 2; doc.payload.schemaVersion = 2;
      SkyForgeCore.projects.loadDocument(doc);
    }, currentDocument);
    assert.equal(await page.evaluate(() => SkyForgeCore.viewport.active), true);
    assert.deepEqual(await readSun(), currentDocument.payload.sun, 'old project sun survives loading');
    assert.equal(await page.evaluate(() => SkyForgeCore.viewport.camera.projection), 'perspective');
    await assertSunUI(await readSun());
    await mutateAndDraw(doc => SkyForgeCore.projects.loadDocument(doc), currentDocument);

    // Natural autosave after a committed gesture restores both sun and camera on reload.
    await placeSunAtCenter(); await startSunDrag(35, -20); await page.mouse.up({ button: 'left' });
    const savedSun = await readSun();
    await page.evaluate(() => SkyForgeCore.store.set('viewport.camera', { ...SkyForgeCore.store.get('viewport.camera'), yaw: 1.234 }));
    await page.waitForFunction(sun => {
      const saved = JSON.parse(localStorage.getItem(SkyForgeCore.store.storageKey) || 'null');
      return saved?.viewport?.camera?.yaw === 1.234 && JSON.stringify(saved.sun) === JSON.stringify(sun);
    }, savedSun);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.SkyForgeCore?.viewport?.active && SkyForgeCore.viewport.renderer.frames > 0);
    assert.equal((await readCamera()).yaw, 1.234, 'autosave restores camera after reload');
    assert.deepEqual(await readSun(), savedSun, 'autosave restores committed sun gesture after reload');
    await assertSunUI(savedSun);
    await page.waitForFunction(() => SkyForgeNaturalLightPreview.getState().skyViewLut !== null, {}, { timeout: 30000 });
    await page.waitForTimeout(1200); await assertIdle();

    await placeSunAtCenter();
    const disposeSun = await readSun(), disposeHistory = await historyLength();
    await startSunDrag(); await page.evaluate(() => SkyForgeCore.viewport.dispose()); await page.mouse.up({ button: 'left' });
    assert.deepEqual(await readSun(), disposeSun, 'dispose cancels in-progress sun gesture');
    assert.equal(await historyLength(), disposeHistory);
    assert.equal(await page.locator('.sf-3d-host').count(), 0);
    assert.equal(await page.evaluate(() => SF_VIEWPORT_3D_ACTIVE), false);
    const fallback = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await fallback.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (type === 'webgl' || type === 'webgl2') return null;
        return original.call(this, type, ...args);
      };
    });
    await fallback.goto(base, { waitUntil: 'domcontentloaded' });
    await fallback.waitForFunction(() => globalThis.SkyForgeCore?.viewport);
    assert.equal(await fallback.evaluate(() => SkyForgeCore.viewport.active), false);
    assert.equal(await fallback.locator('#vp-canvas').isVisible(), true);
    assert.match(await fallback.locator('.sf-3d-message').innerText(), /WebGL unavailable/);
    await fallback.close();
    assert.ok(!errors.some(e => /Shader|WebGL.*INVALID|viewport\/|SkyViewportRenderer|SunGizmo|sun-gizmo|store listener failed/.test(e)), errors.join('\n'));
    console.log('PASS: real WebGL, sun gizmo, bidirectional controls, single Undo, Escape, Option/Alt navigation, perspective/orthographic, offscreen marker, manual/physical separation, LUT, autosave, old projects, idle rendering, no physical request loop, fallback, context recovery and dispose');
  } catch (error) {
    console.error('Browser diagnostics', errors);
    console.error('Viewport state', await page.evaluate(async () => {
      const viewport = globalThis.SkyForgeCore?.viewport;
      const sun = globalThis.SkyForgeCore?.store?.get('sun');
      let projectedSun = null;
      if (viewport?.canvas && sun) {
        const rect = viewport.canvas.getBoundingClientRect();
        try {
          const { projectSun } = await import('/src/client/viewport/sun-gizmo.js');
          projectedSun = projectSun(sun, viewport.camera, rect.width / Math.max(1, rect.height), SkyForgeCore.store.get('camera.fov'));
        } catch (error) { projectedSun = { error: error.message }; }
      }
      return {
        active: viewport?.active, error: viewport?.error, sun,
        camera: viewport?.camera, committedCamera: globalThis.SkyForgeCore?.store?.get('viewport.camera'), projectedSun,
        marker: viewport?.sunGizmo?.marker && {
          left: viewport.sunGizmo.marker.style.left, top: viewport.sunGizmo.marker.style.top,
          offscreen: viewport.sunGizmo.marker.classList.contains('sf-sun-offscreen'), aria: viewport.sunGizmo.marker.getAttribute('aria-label')
        },
        solar: viewport?.payload?.evaluation?.solarPosition,
        usingLut: viewport?.renderer?.usingLut, frame: viewport?.frame,
        drag: Boolean(viewport?.sunGizmo?.drag), activeEdit: globalThis.SkyForgeCore?.store?.activeEdit?.path
      };
    }).catch(() => null));
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    try { fs.writeFileSync(path.join(out, 'browser-errors.json'), JSON.stringify(errors, null, 2)); }
    finally { await browser.close(); }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
