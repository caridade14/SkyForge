const { clientSource } = require('./helpers/client-source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = name => clientSource(name);
const url = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const cameraUrl = url(source('src/client/viewport/camera.js'));
const transformUrl = url(source('src/client/viewport/transform-math.js').replace("'./camera.js'", JSON.stringify(cameraUrl)));
const geometryUrl = url(source('src/client/viewport/reference-geometry.js').replace("'./camera.js'", JSON.stringify(cameraUrl)).replace("'./transform-math.js'", JSON.stringify(transformUrl)));
const cloudUrl = url(source('src/client/viewport/volumetric-clouds.js'));
const rendererModule = () => import(url(source('src/client/viewport/renderer.js').replace("'./camera.js'", JSON.stringify(cameraUrl)).replace("'./reference-geometry.js'", JSON.stringify(geometryUrl)).replace("'./transform-math.js'", JSON.stringify(transformUrl)).replace("'./volumetric-clouds.js'", JSON.stringify(cloudUrl))));
const modules = async () => ({ ...await import(cameraUrl), ...await import(geometryUrl) });
const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const object = (id, type, position = [0, 0, 0], options = {}) => ({ id, type, name: id, position, scale: 1, visible: true, locked: false, ...options });

test('reference meshes have actual triangles, unit normals and outward winding', async () => {
  const { shapeGeometry, outlineGeometry, REFERENCE_TYPES, cross, dot } = await modules();
  for (const type of REFERENCE_TYPES) {
    const mesh = shapeGeometry(type), outline = outlineGeometry(type);
    assert.ok(mesh instanceof Float32Array && mesh.length >= 54 && mesh.length % 27 === 0);
    assert.ok(outline.length > 0 && outline.length % 18 === 0);
    for (let index = 0; index < mesh.length; index += 9) {
      close(Math.hypot(...mesh.slice(index + 3, index + 6)), 1);
      if (type === 'sphere') close(Math.hypot(...mesh.slice(index, index + 3)), 1);
      if (type === 'cube') assert.ok([...mesh.slice(index, index + 3)].every(value => Math.abs(value) === 1));
      if (type === 'plane') { assert.equal(mesh[index + 2], 0); assert.equal(mesh[index + 5], 1); }
    }
    for (let index = 0; index < mesh.length; index += 27) {
      const a = [...mesh.slice(index, index + 3)], b = [...mesh.slice(index + 9, index + 12)], c = [...mesh.slice(index + 18, index + 21)];
      const normal = [...mesh.slice(index + 3, index + 6)];
      assert.ok(dot(cross(b.map((value, axis) => value - a[axis]), c.map((value, axis) => value - a[axis])), normal) >= -1e-6, 'surface winding agrees with lighting normal');
    }
  }
  assert.equal(shapeGeometry('cloud').length, 0);
});

test('sphere, cube and finite two-sided plane picking return the nearest visible surface', async () => {
  const { pickReferenceObject } = await modules();
  const sphere = object('sphere', 'sphere', [0, 0, 4]);
  const cube = object('cube', 'cube', [0, 0, 7], { locked: true });
  const plane = object('plane', 'plane', [0, 0, 9]);
  const ray = { origin: [0, 0, 0], direction: [0, 0, 1] };
  const first = pickReferenceObject({ cube, sphere, plane }, ray);
  assert.equal(first.object.id, 'sphere'); close(first.distance, 3);
  sphere.visible = false;
  const second = pickReferenceObject([sphere, cube, plane], ray);
  assert.equal(second.object.id, 'cube'); close(second.distance, 6);
  assert.equal(second.object.locked, true, 'locking blocks movement, not selection');
  cube.visible = false;
  const third = pickReferenceObject([sphere, cube, plane], ray);
  assert.equal(third.object.id, 'plane'); close(third.distance, 9);
  close(pickReferenceObject([plane], { origin: [0, 0, 12], direction: [0, 0, -1] }).distance, 3);
  assert.equal(pickReferenceObject([plane], { origin: [2.01, 0, 0], direction: [0, 0, 1] }), null);
  assert.equal(pickReferenceObject([plane], { origin: [0, 0, 0], direction: [0, 1, 0] }), null);
});

test('picking respects uniform scale, boundaries, inside rays and unsupported legacy types', async () => {
  const { pickReferenceObject } = await modules();
  const ray = { origin: [0, 0, 0], direction: [0, 1, 0] };
  close(pickReferenceObject([object('s', 'sphere', [0, 5, 0], { scale: 2 })], ray).distance, 3);
  close(pickReferenceObject([object('c', 'cube', [0, 5, 0], { scale: 2 })], ray).distance, 3);
  close(pickReferenceObject([object('s', 'sphere')], ray).distance, 1);
  close(pickReferenceObject([object('c', 'cube')], ray).distance, 1);
  assert.equal(pickReferenceObject([object('c', 'cube', [0, 5, 0])], { origin: [1.01, 0, 0], direction: ray.direction }), null);
  assert.equal(pickReferenceObject([object('cloud', 'CLOUD', [0, 5, 0])], ray), null);
  assert.equal(pickReferenceObject(undefined, ray), null);
  const sphere = object('s', 'sphere', [0, 5, 0]);
  close(pickReferenceObject([sphere], { origin: [1, 0, 0], direction: [0, 1, 0] }).distance, 5);
});

test('projected points roundtrip through camera rays and select actual world objects', async () => {
  const { normalizeCamera, projectPoint, rayAt, pickReferenceObject, add, mul } = await modules();
  for (const projection of ['perspective', 'orthographic']) for (const aspect of [0.7, 2]) {
    const camera = normalizeCamera({ projection }), point = [3, 2, 1];
    const ndc = projectPoint(point, camera, aspect, 60), ray = rayAt(camera, ndc.x, ndc.y, aspect, 60);
    assert.equal(ndc.behind, false);
    const directionPoint = add(ray.origin, mul(ray.direction, projection === 'orthographic' ? ndc.depth : Math.hypot(...point.map((value, index) => value - ray.origin[index]))));
    directionPoint.forEach((value, index) => close(value, point[index]));
    assert.equal(pickReferenceObject([object('target', 'sphere', point)], ray).object.id, 'target');
  }
});

test('frame selected preserves view orientation and fits bounds in portrait and landscape', async () => {
  const { normalizeCamera, frameObject, objectRadius, projectPoint, cameraBasis, add, mul } = await modules();
  for (const projection of ['perspective', 'orthographic']) for (const aspect of [0.5, 2]) for (const type of ['sphere', 'cube', 'plane']) {
    const before = normalizeCamera({ projection }), selected = object('target', type, [25, -13, 2], { scale: 3 });
    const framed = frameObject(before, selected, aspect, 60), basis = cameraBasis(framed);
    assert.deepEqual(framed.target, selected.position); assert.equal(framed.yaw, before.yaw); assert.equal(framed.pitch, before.pitch); assert.equal(framed.projection, projection);
    const radius = objectRadius(selected);
    for (const direction of [basis.right, basis.up]) for (const sign of [-1, 1]) {
      const point = projectPoint(add(selected.position, mul(direction, sign * radius)), framed, aspect, 60);
      assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && !point.behind);
    }
  }
});

test('axis drag stays on the chosen world axis in perspective and orthographic views', async () => {
  const { normalizeCamera, projectPoint, startAxisDrag, moveAxisDrag } = await modules();
  const axes = { x: 0, y: 1, z: 2 }, position = [3, -2, 1];
  for (const projection of ['perspective', 'orthographic']) for (const yaw of [-1, 0.55, 2]) for (const aspect of [0.7, 2]) for (const [axis, index] of Object.entries(axes)) {
    const camera = normalizeCamera({ projection, yaw, pitch: 0.3, target: position });
    const handle = [...position]; handle[index] += 0.8;
    const start = projectPoint(handle, camera, aspect, 60);
    const session = startAxisDrag(position, axis, camera, start.x, start.y, aspect, 60);
    assert.ok(session);
    const endpoint = [...handle]; endpoint[index] += 2.25;
    const end = projectPoint(endpoint, camera, aspect, 60), moved = moveAxisDrag(session, end.x, end.y);
    assert.ok(moved);
    moved.forEach((value, component) => close(value, position[component] + (component === index ? 2.25 : 0)));
    assert.deepEqual(session.position, position, 'frozen transaction origin remains unchanged');
  }
});

test('screen handles hide degenerate axes and produce bounded finite movement', async () => {
  const { normalizeCamera, axisSegments, startAxisDrag, moveAxisDrag } = await modules();
  for (const projection of ['perspective', 'orthographic']) {
    const camera = normalizeCamera({ projection, yaw: Math.PI / 2, pitch: 0, target: [0, 0, 0] });
    const segments = axisSegments([0, 0, 0], camera, 800, 600, 60);
    assert.equal(segments.find(segment => segment.axis === 'x').enabled, false);
    assert.equal(segments.find(segment => segment.axis === 'y').enabled, true);
    assert.equal(segments.find(segment => segment.axis === 'z').enabled, true);
    assert.equal(startAxisDrag([0, 0, 0], 'x', camera, 0, 0, 4 / 3, 60), null);
    const session = startAxisDrag([0, 0, 0], 'z', camera, 0, 0, 4 / 3, 60);
    const moved = moveAxisDrag(session, 0, 1e9);
    assert.ok(moved === null || moved.every(value => Number.isFinite(value) && Math.abs(value) <= 1e6), 'extreme pointers either reject the ray or stay bounded');
    assert.equal(moveAxisDrag(null, 0, 0), null);
  }
});

function mockGL() {
  let nextId = 1;
  const buffers = new Set(), uniforms = new Map(), draws = [], deleted = [];
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, STATIC_DRAW: 6,
    TEXTURE_2D: 7, TEXTURE_MIN_FILTER: 8, TEXTURE_MAG_FILTER: 9, TEXTURE_WRAP_S: 10, TEXTURE_WRAP_T: 11,
    NEAREST: 12, CLAMP_TO_EDGE: 13, RGBA: 14, UNSIGNED_BYTE: 15, FLOAT: 16, COLOR_BUFFER_BIT: 32,
    DEPTH_BUFFER_BIT: 64, DEPTH_TEST: 17, TRIANGLES: 18, LINES: 19, TEXTURE0: 20, POLYGON_OFFSET_FILL: 21,
    LEQUAL: 22, LESS: 23, HIGH_FLOAT: 24,
    createShader: () => ({ id: nextId++ }), createProgram: () => ({ id: nextId++ }), createTexture: () => ({ id: nextId++ }),
    getShaderParameter: () => true, getProgramParameter: () => true, getExtension: () => null, isContextLost: () => false,
    getShaderPrecisionFormat: () => ({ precision: 23 }),
    createBuffer: () => { const buffer = { id: nextId++ }; buffers.add(buffer); return buffer; },
    deleteBuffer: buffer => { buffers.delete(buffer); deleted.push(buffer); },
    getUniformLocation: (program, name) => name, getAttribLocation: (program, name) => ({ aPosition: 0, aNormal: 1, aColor: 2 })[name],
    uniform1f: (name, value) => uniforms.set(name, value), uniform3fv: (name, value) => uniforms.set(name, [...value]),
    uniform2fv() {}, uniform1i() {}, uniformMatrix4fv() {}, uniformMatrix3fv: (name, transpose, value) => uniforms.set(name, [...value]),
    drawArrays: (mode, first, count) => draws.push({ mode, count, offset: uniforms.get('uOffset'), scale: uniforms.get('uSize'), rotation: uniforms.get('uRotation'), lines: uniforms.get('uLines') })
  };
  for (const name of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteShader', 'deleteProgram', 'bindBuffer', 'bufferData', 'bindTexture', 'texParameteri', 'texImage2D', 'deleteTexture', 'viewport', 'clear', 'disable', 'enable', 'useProgram', 'enableVertexAttribArray', 'vertexAttribPointer', 'activeTexture', 'disableVertexAttribArray', 'polygonOffset', 'depthFunc']) gl[name] = () => {};
  return { gl, buffers, draws, deleted, uniforms };
}

test('renderer reuses geometry during moves, highlights selection and releases GPU buffers', async () => {
  const { normalizeCamera } = await modules();
  const { SkyViewportRenderer } = await rendererModule();
  const { gl, buffers, draws } = mockGL(), canvas = { getContext: () => gl, width: 800, height: 600 };
  const renderer = new SkyViewportRenderer(canvas), allocationCount = buffers.size;
  const selected = object('selected', 'cube', [3, 2, 1], { scale: 2 });
  const state = { viewport: { grid: false, referenceSphere: false }, scene: { referenceObjects: { selected, hidden: object('hidden', 'sphere', [0, 0, 0], { visible: false }) }, selectedReferenceId: 'selected' } };
  renderer.draw(state, normalizeCamera());
  assert.equal(draws.length, 3, 'sky, selected cube and depth-tested selection outline');
  assert.deepEqual(draws[1].offset, selected.position); assert.deepEqual(draws[1].scale, [2, 2, 2]); assert.equal(draws[2].lines, 1);
  selected.position = [5, 4, 2]; selected.scale = [2, 3, 4]; selected.rotation = [0, 0, 90]; renderer.draw(state, normalizeCamera());
  assert.equal(buffers.size, allocationCount, 'moving an object does not allocate geometry');
  assert.deepEqual(draws.at(-2).offset, selected.position);
  assert.deepEqual(draws.at(-2).scale, [2, 3, 4]);
  const { rotationMatrix3 } = await import(transformUrl);
  assert.deepEqual(draws.at(-2).rotation, rotationMatrix3(selected.rotation));
  assert.deepEqual(draws.at(-1).rotation, draws.at(-2).rotation, 'selection outline follows the rendered transform');
  assert.doesNotThrow(() => renderer.draw({}, normalizeCamera()), 'old projects retain the fixed reference sphere');
  renderer.dispose(); assert.equal(buffers.size, 0);
});

test('renderer applies graph grading and switches optical edits away from the cached physical baseline', async () => {
  const { normalizeCamera } = await modules(), { SkyViewportRenderer } = await rendererModule();
  const { gl, uniforms } = mockGL(), renderer = new SkyViewportRenderer({ getContext: () => gl, width: 800, height: 600 });
  const state = { viewport: { skySource:'backend', grid: false, referenceSphere: false }, sun: { elevation: 30, azimuth: 0 }, atmosphere: { haze: .3, turbidity: 2.4 }, camera: { exposure: 2 }, color: { exposure: 1, saturation: .5, contrast: 1.2 } };
  const payload = { evaluation: { solarPosition: { azimuthDeg: 0, apparentElevationDeg: 30 } }, skyViewLut: { layout: { width: 1, height: 1, channels: ['R', 'G', 'B'] }, pixels: [.1, .2, .3] } };
  renderer.setLut(payload, state.atmosphere); renderer.draw(state, normalizeCamera());
  assert.equal(renderer.usingLut, true);
  assert.equal(uniforms.get('uExposure'), 4); assert.equal(uniforms.get('uContrast'), 1.2); assert.equal(uniforms.get('uSaturation'), .5);
  state.atmosphere.turbidity = 8; renderer.draw(state, normalizeCamera()); assert.equal(renderer.usingLut, false);
  assert.equal(uniforms.get('uTurbidity'), 8);
  state.atmosphere.turbidity = 2.4; renderer.draw(state, normalizeCamera()); assert.equal(renderer.usingLut, true);
  renderer.dispose();
});
