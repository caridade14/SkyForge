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
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launch.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (process.env.SKYFORGE_WEBGL_BACKEND !== 'native') launch.args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const studioCommand=async(menu,action)=>{await page.locator(`[data-studio-menu="${menu}"]`).click();await page.locator(`#sf-studio-menus [aria-label="${menu}"] [data-studio-command="${action}"]`).click();};
  const errors = [];
  page.on('pageerror', e => errors.push(e.stack || e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const requests = [];
  page.on('request', r => { if (r.url().includes('/api/lighting/preview')) requests.push(r.postData()); });
  const readCamera = () => page.evaluate(() => SkyForgeCore.store.get('viewport.camera'));
  const readSun = () => page.evaluate(() => SkyForgeCore.store.get('sun'));
  const readReferences = () => page.evaluate(() => SkyForgeCore.store.get('scene.referenceObjects') || {});
  const readReference = id => page.evaluate(id => SkyForgeCore.store.get(`scene.referenceObjects.${id}`), id);
  const selectedReference = () => page.evaluate(() => SkyForgeCore.store.get('scene.selectedReferenceId'));
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
    // Let finite startup/resize/LUT work settle even on the software CI GPU.
    // A continuous render loop cannot satisfy the quiet interval.
    await page.evaluate(() => { globalThis.__sfGateIdle = null; });
    await page.waitForFunction(() => {
      const viewport = SkyForgeCore.viewport, count = viewport.renderer.frames, now = performance.now();
      if (!globalThis.__sfGateIdle || globalThis.__sfGateIdle.count !== count || viewport.frame !== null) {
        globalThis.__sfGateIdle = { count, since: now }; return false;
      }
      return now - globalThis.__sfGateIdle.since >= 800;
    }, null, { timeout: 15000 });
    const frames = await frameCount();
    await page.waitForTimeout(350);
    assert.equal(await frameCount(), frames, 'rendering sleeps after the gesture');
  };
  const referenceScreenPoint = id => page.evaluate(async id => {
    const { projectPoint } = await import('/src/client/viewport/reference-geometry.js');
    const viewport = SkyForgeCore.viewport, rect = viewport.canvas.getBoundingClientRect();
    const object = SkyForgeCore.store.get(`scene.referenceObjects.${id}`);
    const point = projectPoint(object.position, viewport.camera, rect.width / rect.height, SkyForgeCore.store.get('camera.fov'));
    return { x: rect.x + (point.x + 1) * rect.width / 2,
      y: rect.y + (1 - point.y) * rect.height / 2, behind: point.behind };
  }, id);
  const assertReferenceInspector = async (id, object) => {
    const ui = await page.evaluate(id => ({
      selected: SkyForgeCore.store.get('scene.selectedReferenceId'),
      position: ['x', 'y', 'z'].map(axis => Number(document.getElementById(`tri-pos-${axis}`)?.value)),
      name: document.getElementById('tri-selected-object')?.textContent,
      rowSelected: document.querySelector(`[data-sf-reference-id="${id}"]`)?.classList.contains('sel')
    }), id);
    const diagnostics = JSON.stringify({ id, desired: object, ui });
    assert.equal(ui.selected, id, `reference selection matches Store: ${diagnostics}`);
    assert.equal(ui.rowSelected, true, `outliner selection follows Store: ${diagnostics}`);
    assert.ok(ui.name?.includes(object.name), `inspector identifies the selected reference: ${diagnostics}`);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(ui.position[axis] - object.position[axis]) < 0.001, `Z-up inspector preserves position precision: ${diagnostics}`);
    }
  };
  const startReferenceDrag = async (axis, distance = 32) => {
    const handle = await page.evaluate(axis => {
      const viewport = SkyForgeCore.viewport, rect = viewport.canvas.getBoundingClientRect();
      const segment = viewport.referenceGizmo.segments.find(segment => segment.axis === axis && segment.enabled !== false);
      if (!segment) return null;
      const dx = segment.end[0] - segment.start[0], dy = segment.end[1] - segment.start[1], length = Math.hypot(dx, dy);
      return { x: rect.x + segment.start[0] + dx * 0.72, y: rect.y + segment.start[1] + dy * 0.72,
        dx: dx / length, dy: dy / length };
    }, axis);
    assert.ok(handle, `${axis.toUpperCase()} translation handle is available`);
    await page.mouse.move(handle.x, handle.y); await page.mouse.down({ button: 'left' });
    assert.equal(await page.evaluate(() => Boolean(SkyForgeCore.viewport.referenceGizmo.drag)), true, `${axis} handle begins translation`);
    const before = await frameCount();
    await page.mouse.move(handle.x + handle.dx * distance, handle.y + handle.dy * distance, { steps: 6 });
    await nextFrame(before);
    return handle;
  };
  const referenceGpuPixels = id => page.evaluate(async id => {
    const { projectPoint } = await import('/src/client/viewport/reference-geometry.js');
    const viewport = SkyForgeCore.viewport, rect = viewport.canvas.getBoundingClientRect();
    const object = SkyForgeCore.store.get(`scene.referenceObjects.${id}`);
    const point = projectPoint(object.position, viewport.camera, rect.width / rect.height, SkyForgeCore.store.get('camera.fov'));
    // Sample actual framebuffer pixels in the same animation frame as the draw,
    // before preserveDrawingBuffer:false allows the browser to clear its buffer.
    return new Promise(resolve => {
      viewport.invalidate();
      requestAnimationFrame(() => {
        const gl = viewport.renderer.gl, pixels = new Uint8Array(16 * 16 * 4);
        const x = Math.max(0, Math.min(viewport.canvas.width - 16, Math.round((point.x + 1) * viewport.canvas.width / 2) - 8));
        const y = Math.max(0, Math.min(viewport.canvas.height - 16, Math.round((point.y + 1) * viewport.canvas.height / 2) - 8));
        gl.readPixels(x, y, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        resolve({ pixels: [...pixels], error: gl.getError() });
      });
    });
  }, id);
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.SkyForgeCore?.viewport?.renderer?.frames > 0, {}, { timeout: 30000 });
    // Exercise the detailed legacy/navigation regressions in their original layout.
    await page.waitForFunction(() => !SkyForgeCore.workspace || getComputedStyle(document.getElementById('sf-studio-toolbar')).display === 'flex');
    await page.evaluate(() => { SkyForgeCore.workspace?.setLegacy(true); SkyForgeCore.store.set('viewport.cloudMode', 'layer', { transient: true, record: false }); });
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
    await page.getByLabel('Sky lighting source',{exact:true}).selectOption('backend');
    await studioCommand('Sky','physical');
    await page.waitForFunction(() => SkyForgeCore.viewport.renderer.usingLut === true, {}, { timeout: 10000 });
    const solar = await page.evaluate(() => SkyForgeCore.viewport.payload.evaluation.solarPosition);
    assert.equal((await readSun()).azimuth, solar.azimuthDeg);
    assert.equal((await readSun()).elevation, solar.apparentElevationDeg);
    await assertSunUI(await readSun());
    await page.screenshot({ path: path.join(out, 'viewport-physical-lut.png') });

    // Geometry visibility needs a deterministic daytime fixture. The physical
    // evaluation above follows the current date/time and can legitimately be
    // dark at night; the preview/UI gate verifies that night behavior separately.
    await mutateAndDraw(() => SkyForgeCore.store.set('sun', {
      ...SkyForgeCore.store.get('sun'), azimuth: 215, elevation: 45,
      intensity: 1.8, temperature: 6500
    }, { record: false }));
    assert.equal(await page.evaluate(() => SkyForgeCore.viewport.renderer.usingLut), false);

    // Reference geometry is created through the existing Object Builder, picked
    // with real pointer rays and translated through the visible XYZ handles.
    console.log('Checking reference creation');
    const referenceRequests = requests.length, referenceIds = {};
    const positions = { sphere: [-3, 0, 1.5], cube: [3, 0, 1], plane: [0, 4, 0.05] };
    for (const type of ['sphere', 'cube', 'plane']) {
      const previous = await readReferences(), name = `WebGL reference ${type}`;
      await page.locator('#sf-new-type').selectOption(type.toUpperCase());
      await page.locator('#sf-new-name').fill(name);
      const createFrame = await frameCount();
      await page.locator('button[onclick="sfCreateObjectFromPanel()"]').click();
      await nextFrame(createFrame);
      const references = await readReferences(), ids = Object.keys(references).filter(id => !previous[id]);
      assert.equal(ids.length, 1, `${type} Object Builder creates one canonical reference`);
      const id = referenceIds[type] = ids[0];
      assert.equal(references[id].type, type); assert.equal(references[id].name, name);
      assert.equal(await selectedReference(), id, 'creation selects the new reference');
      assert.equal(await page.locator(`[data-sf-reference-id="${id}"]`).count(), 1, 'creation adds its outliner row');
      const positionFrame = await frameCount();
      for (const [index, axis] of ['x', 'y', 'z'].entries()) {
        await page.locator(`#tri-pos-${axis}`).fill(String(positions[type][index]));
        await page.locator(`#tri-pos-${axis}`).press('Tab');
      }
      if (JSON.stringify(references[id].position) !== JSON.stringify(positions[type])) await nextFrame(positionFrame);
      assert.deepEqual((await readReference(id)).position, positions[type], 'numeric inspector edits world positions in metres');
      await assertReferenceInspector(id, await readReference(id));
    }
    console.log('Checking reference picking and pixels');
    for (const type of ['sphere', 'cube', 'plane']) {
      const id = referenceIds[type];
      await page.locator(`[data-sf-reference-id="${id}"]`).click();
      const frameBefore = await frameCount();
      await studioCommand('Scene','frame'); await nextFrame(frameBefore);
      assert.deepEqual((await readCamera()).target, (await readReference(id)).position, 'toolbar frames the selected reference');
      await mutateAndDraw(() => SkyForgeCore.store.set('scene.selectedReferenceId', null, { record: false }));
      const point = await referenceScreenPoint(id);
      assert.equal(point.behind, false); assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      const selectFrame = await frameCount();
      await page.mouse.click(point.x, point.y); await nextFrame(selectFrame);
      assert.equal(await selectedReference(), id, `viewport ray picks the actual ${type}`);
      await assertReferenceInspector(id, await readReference(id));
      await mutateAndDraw(id => SkyForgeCore.store.set(`scene.referenceObjects.${id}.visible`, false, { record: false }), id);
      const background = await referenceGpuPixels(id);
      await mutateAndDraw(id => SkyForgeCore.store.set(`scene.referenceObjects.${id}.visible`, true, { record: false }), id);
      const geometry = await referenceGpuPixels(id);
      assert.equal(background.error, 0); assert.equal(geometry.error, 0);
      assert.notDeepEqual(geometry.pixels, background.pixels, `GPU framebuffer contains the lit ${type} mesh`);
    }
    console.log('Checking reference gestures');
    const cubeId = referenceIds.cube;
    await page.locator(`[data-sf-reference-id="${cubeId}"]`).click();
    const precisePosition = [2.125, -0.875, 1.375], preciseFrame = await frameCount();
    for (const [index, axis] of ['x', 'y', 'z'].entries()) {
      await page.locator(`#tri-pos-${axis}`).fill(String(precisePosition[index]));
      await page.locator(`#tri-pos-${axis}`).press('Tab');
    }
    await nextFrame(preciseFrame);
    assert.deepEqual((await readReference(cubeId)).position, precisePosition, 'inspector retains sub-metre precision');
    await assertReferenceInspector(cubeId, await readReference(cubeId));
    const inspectorFrame = await frameCount();
    await page.locator('[data-ref-action="frame"]').click(); await nextFrame(inspectorFrame);
    assert.deepEqual((await readCamera()).target, precisePosition, 'inspector frames the selected reference');
    await mutateAndDraw(() => SkyForgeCore.store.set('viewport.camera', { ...SkyForgeCore.store.get('viewport.camera'), distance: 15 }));
    await canvas.focus();
    const keyboardFrame = await frameCount();
    await page.keyboard.press('f'); await nextFrame(keyboardFrame);
    assert.deepEqual((await readCamera()).target, precisePosition); assert.ok((await readCamera()).distance < 15, 'F fits the selected reference');
    const referenceSun = await readSun(), referenceCamera = await readCamera();
    for (const [index, axis] of ['x', 'y', 'z'].entries()) {
      const objectBefore = await readReference(cubeId), historyBefore = await historyLength();
      await startReferenceDrag(axis);
      const objectPreview = await readReference(cubeId);
      assert.ok(Math.abs(objectPreview.position[index] - objectBefore.position[index]) > 0.001, `${axis} handle changes its world axis`);
      for (let other = 0; other < 3; other++) {
        if (other !== index) assert.equal(objectPreview.position[other], objectBefore.position[other], 'axis translation preserves the other coordinates');
      }
      assert.equal(await historyLength(), historyBefore, 'translation preview adds no history');
      assert.equal(await page.evaluate(() => SkyForgeCore.store.activeEdit?.path), `scene.referenceObjects.${cubeId}.position`);
      assert.deepEqual(await readCamera(), referenceCamera, 'object translation preserves navigation state');
      assert.deepEqual(await readSun(), referenceSun, 'object translation preserves manual/physical sun state');
      await assertReferenceInspector(cubeId, objectPreview);
      const committedPosition = await page.evaluate(id => {
        SkyForgeCore.store.persist();
        return { project: SkyForgeCore.projects.createDocument().payload.scene.referenceObjects[id].position,
          autosave: JSON.parse(localStorage.getItem(SkyForgeCore.store.storageKey)).scene.referenceObjects[id].position };
      }, cubeId);
      assert.deepEqual(committedPosition.project, objectBefore.position, 'project export excludes live object translation');
      assert.deepEqual(committedPosition.autosave, objectBefore.position, 'autosave excludes live object translation');
      await page.mouse.up({ button: 'left' });
      assert.equal(await historyLength(), historyBefore + 1, 'one axis gesture creates exactly one undo entry');
      const objectAfter = await readReference(cubeId);
      assert.deepEqual(objectAfter.position, objectPreview.position);
      // Exercise both portable Ctrl and Mac Cmd shortcuts through the actual UI.
      for (const modifier of ['Control', 'Meta']) {
        await canvas.focus();
        const undoFrame = await frameCount();
        await page.keyboard.press(`${modifier}+z`); await nextFrame(undoFrame);
        assert.deepEqual((await readReference(cubeId)).position, objectBefore.position, `${modifier}+Z restores the entire axis gesture`);
        await assertReferenceInspector(cubeId, await readReference(cubeId));
        const redoFrame = await frameCount();
        await page.keyboard.press(`${modifier}+Shift+z`); await nextFrame(redoFrame);
        assert.deepEqual((await readReference(cubeId)).position, objectAfter.position, `${modifier}+Shift+Z reapplies the gesture`);
      }
    }
    const canceledObject = await readReference(cubeId), canceledHistory = await historyLength();
    await startReferenceDrag('x');
    await page.keyboard.press('Escape'); await page.mouse.up({ button: 'left' });
    assert.deepEqual(await readReference(cubeId), canceledObject, 'Escape restores object translation');
    assert.equal(await historyLength(), canceledHistory, 'Escape adds no object history');
    assert.equal(await page.evaluate(() => SkyForgeCore.store.activeEdit), null);
    await assertReferenceInspector(cubeId, canceledObject);
    for (const button of ['left', 'middle']) {
      const point = await referenceScreenPoint(cubeId), referencesBeforeNavigation = await readReferences(), cameraBeforeNavigation = await readCamera();
      await page.mouse.move(point.x, point.y);
      if (button === 'left') await page.keyboard.down('Alt');
      await page.mouse.down({ button }); await page.mouse.move(point.x + 28, point.y + 12, { steps: 4 });
      assert.equal(await page.evaluate(() => SkyForgeCore.viewport.referenceGizmo.drag), null, 'navigation over a reference does not capture its transform');
      await page.mouse.up({ button }); if (button === 'left') await page.keyboard.up('Alt');
      assert.notEqual((await readCamera()).yaw, cameraBeforeNavigation.yaw, `${button === 'left' ? 'Option/Alt+LMB' : 'MMB'} navigates over selected geometry`);
      assert.deepEqual(await readReferences(), referencesBeforeNavigation, 'navigation preserves reference positions');
      assert.deepEqual(await readSun(), referenceSun);
    }
    await assertIdle();
    assert.equal(requests.length, referenceRequests, 'creation, selection, XYZ edits, framing and object history do not reevaluate Natural Light');
    await page.screenshot({ path: path.join(out, 'viewport-reference-objects.png') });
    const referencesBeforeLegacyCreate = await readReferences();
    await page.locator('#sf-new-type').selectOption('CLOUD');
    await page.locator('#sf-new-name').fill('Existing legacy cloud');
    await page.locator('button[onclick="sfCreateObjectFromPanel()"]').click();
    assert.deepEqual(await readReferences(), referencesBeforeLegacyCreate, 'unsupported Object Builder types stay outside reference geometry');
    const unsupportedRow = page.locator('#outliner-list .tri-out-extra').filter({ hasText: 'Existing legacy cloud' });
    assert.equal(await unsupportedRow.count(), 1);
    assert.equal(await unsupportedRow.locator('.tri-out-type').innerText(), 'CLOUD', 'existing cloud remains a legacy scene object');
    assert.equal(await unsupportedRow.getAttribute('data-sf-reference-id'), null);
    await page.locator(`[data-sf-reference-id="${cubeId}"]`).click();
    const savedReferences = await readReferences();
    const referenceDocument = await page.evaluate(() => SkyForgeCore.projects.createDocument());
    await mutateAndDraw(() => SkyForgeCore.store.set('scene.referenceObjects', {}));
    await mutateAndDraw(doc => SkyForgeCore.projects.loadDocument(doc), referenceDocument);
    assert.deepEqual(await readReferences(), savedReferences, 'portable project reload restores every reference object');
    await assertReferenceInspector(cubeId, await readReference(cubeId));
    await mutateAndDraw(() => SkyForgeCore.projects.loadDocument({ scene: {
      metadata: { upAxis: 'Y', units: 'meters' },
      objects: [
        { key: 'old-cube', type: 'CUBE', name: 'Old cube', x: 2.5, y: 4.5, z: 6.5, visible: true },
        { key: 'old-cloud', type: 'CLOUD', name: 'Legacy cloud', x: 7, y: 8, z: 9, visible: true, props: { coverage: 0.42 } }
      ]
    } }));
    const migratedReferences = Object.values(await readReferences());
    assert.equal(migratedReferences.length, 1, 'old projects import only supported reference geometry');
    assert.equal(migratedReferences[0].type, 'cube');
    assert.deepEqual(migratedReferences[0].position, [2.5, 6.5, 4.5], 'legacy Y-up positions migrate to Z-up metres');
    assert.equal(await page.locator('[data-sf-key="old-cloud"] .tri-out-type').innerText(), 'CLOUD', 'legacy cloud remains in the outliner after migration');
    assert.equal(await page.locator('[data-sf-key="old-cloud"]').getAttribute('data-sf-reference-id'), null);
    const retainedLegacyCloud = await page.evaluate(() => SkyForgeCore.store.get('objects').find(object => object.key === 'old-cloud'));
    assert.deepEqual(retainedLegacyCloud.props, { coverage: 0.42 }, 'legacy properties survive project migration');
    assert.equal(retainedLegacyCloud.x, 7); assert.equal(retainedLegacyCloud.y, 8); assert.equal(retainedLegacyCloud.z, 9);
    await mutateAndDraw(doc => SkyForgeCore.projects.loadDocument(doc), referenceDocument);
    assert.deepEqual(await readReferences(), savedReferences);
    await assertSunUI(await readSun());

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
      delete doc.checksum; delete doc.payload.viewport; delete doc.payload.scene;
      doc.version = 2; doc.payload.schemaVersion = 2;
      SkyForgeCore.projects.loadDocument(doc);
    }, currentDocument);
    assert.equal(await page.evaluate(() => SkyForgeCore.viewport.active), true);
    assert.deepEqual(await readSun(), currentDocument.payload.sun, 'old project sun survives loading');
    assert.deepEqual(await readReferences(), {}, 'Core projects predating reference objects load an empty reference collection');
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
    await page.waitForFunction(references => {
      const saved = JSON.parse(localStorage.getItem(SkyForgeCore.store.storageKey) || 'null');
      return JSON.stringify(saved?.scene?.referenceObjects) === JSON.stringify(references);
    }, savedReferences);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.SkyForgeCore?.viewport?.active && SkyForgeCore.viewport.renderer.frames > 0);
    await page.waitForFunction(() => !SkyForgeCore.workspace || getComputedStyle(document.getElementById('sf-studio-toolbar')).display === 'flex');
    await page.evaluate(() => { SkyForgeCore.workspace?.setLegacy(true); SkyForgeCore.store.set('viewport.cloudMode', 'layer', { transient: true, record: false }); });
    assert.equal((await readCamera()).yaw, 1.234, 'autosave restores camera after reload');
    assert.deepEqual(await readSun(), savedSun, 'autosave restores committed sun gesture after reload');
    assert.deepEqual(await readReferences(), savedReferences, 'autosave restores reference objects and translated positions after reload');
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
    console.log('PASS: real WebGL, lit sphere/cube/plane reference meshes, ray selection, XYZ translation, inspector, framing, project persistence, sun gizmo, bidirectional controls, single Undo, Escape, Cmd/Ctrl shortcuts, Option/Alt navigation, perspective/orthographic, offscreen marker, manual/physical separation, LUT, autosave, old projects, idle rendering, no physical request loop, fallback, context recovery and dispose');
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
        references: globalThis.SkyForgeCore?.store?.get('scene.referenceObjects'), selectedReference: globalThis.SkyForgeCore?.store?.get('scene.selectedReferenceId'),
        referenceDrag: Boolean(viewport?.referenceGizmo?.drag), translationSegments: viewport?.referenceGizmo?.segments,
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
