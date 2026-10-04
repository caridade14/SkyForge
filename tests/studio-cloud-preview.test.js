const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/client/viewport/volumetric-clouds.js'), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const modules = () => import(moduleUrl);

test('cloud preview budgets cap Retina and large window costs with a low default', async () => {
  const { CLOUD_QUALITIES, cloudPreviewSettings, cloudPreviewResolution } = await modules();
  assert.deepEqual(cloudPreviewSettings({}).quality, 'low');
  assert.equal(cloudPreviewSettings({ viewport: { cloudMode: 'layer', cloudQuality: 'invalid' } }).mode, 'layer');
  for (const [quality, settings] of Object.entries(CLOUD_QUALITIES)) {
    assert.equal(cloudPreviewSettings({ viewport: { cloudQuality: quality } }).samples, settings.samples);
    for (const size of [[848, 669, 2], [3840, 2160, 3], [2000, 200, 2], [1, 1e12, 1]]) {
      const resolution = cloudPreviewResolution(...size, settings);
      assert.ok(resolution.width * resolution.height <= settings.maxPixels);
      assert.ok(resolution.width <= size[0] * settings.maxDpr);
      assert.ok(resolution.height <= size[1] * settings.maxDpr);
      assert.ok(resolution.width >= 1 && resolution.height >= 1);
    }
  }
});

test('cloud uniforms preserve wind timing, thickness and zero values while bounding corrupted projects', async () => {
  const { cloudUniforms } = await modules();
  const uniforms = cloudUniforms({ clouds: { coverage: 0, density: 0, altitude: 1234, thickness: 345, windSpeed: 12, windDirection: 90, erosion: .2, detail: .8 }, timeline: { currentFrame: 120, fps: 30 } });
  assert.equal(uniforms.uTime, 4);
  assert.equal(uniforms.uWindDirection, Math.PI / 2);
  assert.equal(uniforms.uThickness, 345);
  assert.equal(uniforms.uCoverage, 0);
  assert.equal(uniforms.uDensity, 0);
  const bad = cloudUniforms({ clouds: { coverage: 5, density: -5, altitude: Infinity, thickness: NaN, windSpeed: 1e20 }, timeline: { fps: 0 } });
  assert.equal(bad.uCoverage, 1); assert.equal(bad.uDensity, 0);
  assert.equal(bad.uAltitude, 2400); assert.equal(bad.uThickness, 800);
  assert.equal(bad.uWindSpeed, 200);
  assert.ok(Object.values(bad).every(Number.isFinite));
});

test('volumetric quality uses constant WebGL1 loop bounds and 3D density with bounded shadow sampling', async () => {
  const { CLOUD_QUALITIES, volumetricCloudFunctions } = await modules();
  for (const [quality, settings] of Object.entries(CLOUD_QUALITIES)) {
    const shader = volumetricCloudFunctions(quality);
    assert.ok(shader.includes(`sampleIndex<${settings.samples}`));
    assert.ok(shader.includes(`lightIndex<${settings.shadowSamples}`));
    assert.ok(shader.includes('cloudDensity(vec3 point)'));
    assert.ok(shader.includes('point.z-uAltitude'));
    assert.ok(shader.includes('point+uSun*lightStep'));
    assert.ok(shader.includes('uTime*uWindSpeed'));
    assert.ok(shader.includes('transmittance<0.015'));
  }
});

const root = path.join(__dirname, '..');
const dataUrl = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const rendererModule = async () => {
  const camera = dataUrl(read('src/client/viewport/camera.js'));
  const transform = dataUrl(read('src/client/viewport/transform-math.js').replace("'./camera.js'", JSON.stringify(camera)));
  const geometry = dataUrl(read('src/client/viewport/reference-geometry.js').replace("'./transform-math.js'", JSON.stringify(transform)).replace("'./camera.js'", JSON.stringify(camera)));
  return import(dataUrl(read('src/client/viewport/renderer.js').replace("'./camera.js'", JSON.stringify(camera)).replace("'./reference-geometry.js'", JSON.stringify(geometry)).replace("'./volumetric-clouds.js'", JSON.stringify(moduleUrl)).replace("'./transform-math.js'", JSON.stringify(transform))));
};

class TestGL {
  constructor({ highPrecision = true, rejectVolume = false } = {}) {
    Object.assign(this, { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, HIGH_FLOAT: 3, COMPILE_STATUS: 4, LINK_STATUS: 5, ARRAY_BUFFER: 6, STATIC_DRAW: 7, TEXTURE_2D: 8, TEXTURE_MIN_FILTER: 9, TEXTURE_MAG_FILTER: 10, NEAREST: 11, TEXTURE_WRAP_S: 12, TEXTURE_WRAP_T: 13, CLAMP_TO_EDGE: 14, RGBA: 15, UNSIGNED_BYTE: 16, FLOAT: 17, COLOR_BUFFER_BIT: 18, DEPTH_BUFFER_BIT: 19, DEPTH_TEST: 20, TRIANGLES: 21, LINES: 22, TEXTURE0: 23, POLYGON_OFFSET_FILL: 24, LEQUAL: 25, LESS: 26, highPrecision, rejectVolume });
    this.next = 0; this.buffers = new Set(); this.programs = new Set(); this.shaders = new Set(); this.textures = new Set(); this.sources = []; this.uniforms = new Map(); this.matrixUniforms = new Map(); this.lost = false;
  }
  getShaderPrecisionFormat() { return { precision: this.highPrecision ? 23 : 0 }; }
  getExtension() { return null; }
  isContextLost() { return this.lost; }
  createShader(type) { const shader = { id: ++this.next, type }; this.shaders.add(shader); return shader; }
  shaderSource(shader, value) { shader.source = value; this.sources.push(value); }
  compileShader(shader) { shader.failed = this.rejectVolume && shader.source.includes('marchClouds'); }
  getShaderParameter(shader) { return !shader.failed; }
  getShaderInfoLog() { return 'Driver rejected volumetric shader'; }
  deleteShader(shader) { this.shaders.delete(shader); }
  createProgram() { const program = { id: ++this.next }; this.programs.add(program); return program; }
  attachShader() {} linkProgram() {} getProgramParameter() { return true; }
  deleteProgram(program) { this.programs.delete(program); }
  createBuffer() { const buffer = { id: ++this.next }; this.buffers.add(buffer); return buffer; }
  deleteBuffer(buffer) { this.buffers.delete(buffer); }
  createTexture() { const texture = { id: ++this.next }; this.textures.add(texture); return texture; }
  deleteTexture(texture) { this.textures.delete(texture); }
  getUniformLocation(program, name) { return `${program.id}:${name}`; }
  uniform1f(location, value) { this.uniforms.set(location, value); }
  uniform1i(location, value) { this.uniforms.set(location, value); }
  uniform2fv(location, value) { this.uniforms.set(location, [...value]); }
  uniform3fv(location, value) { this.uniforms.set(location, [...value]); }
  uniformMatrix3fv(location, transpose, value) { this.matrixUniforms.set(location, [...value]); }
  uniformMatrix4fv() {} useProgram() {} bindBuffer() {} bufferData() {} bindTexture() {} texParameteri() {} texImage2D() {} viewport() {} clear() {} disable() {} enable() {} getAttribLocation() { return 0; } enableVertexAttribArray() {} vertexAttribPointer() {} activeTexture() {} drawArrays() {} disableVertexAttribArray() {} polygonOffset() {} depthFunc() {}
}
const testState = () => ({ viewport: { cloudQuality: 'low', cloudMode: 'volumetric', grid: false, referenceSphere: false }, sun: { azimuth: 0, elevation: 30, intensity: 1 }, atmosphere: { haze: .3, turbidity: 2.4 }, clouds: { coverage: .7, density: .6 }, camera: { exposure: 1 }, timeline: { currentFrame: 1, fps: 24 }, scene: { referenceObjects: {}, selectedReferenceId: null } });
const testCamera = { yaw: .55, pitch: .22, distance: 12, target: [0, 0, 1.5], projection: 'perspective' };
const makeRenderer = (Renderer, options) => { const gl = new TestGL(options); const canvas = { width: 1, height: 1, getContext: () => gl }; return { renderer: new Renderer(canvas), gl }; };

test('unsupported precision and shader failures retain the cloud layer without recompilation loops', async () => {
  const { SkyViewportRenderer } = await rendererModule();
  for (const options of [{ highPrecision: false }, { rejectVolume: true }]) {
    const { renderer, gl } = makeRenderer(SkyViewportRenderer, options);
    renderer.resize(848, 669, 2);
    for (let i = 0; i < 5; i++) renderer.draw(testState(), testCamera);
    assert.equal(renderer.cloudMetrics.mode, 'layer');
    assert.ok(renderer.cloudFallbackReason.includes('cloud layer'));
    assert.equal(gl.sources.filter(source => source.includes('marchClouds')).length, options.rejectVolume ? 1 : 0);
    assert.equal(gl.shaders.size, 0, 'compiled or rejected shaders are immediately released');
    renderer.dispose(); assert.equal(gl.buffers.size, 0); assert.equal(gl.programs.size, 0); assert.equal(gl.textures.size, 0);
  }
});

test('quality programs cache independently, apply grading and release all GPU resources', async () => {
  const { SkyViewportRenderer } = await rendererModule();
  const { renderer, gl } = makeRenderer(SkyViewportRenderer);
  const state = testState(); state.camera.exposure = 2; state.color = { exposure: 1, contrast: 1.2, saturation: .5 };
  renderer.resize(848, 669, 2);
  for (const quality of ['low', 'medium', 'high', 'low']) {
    state.viewport.cloudQuality = quality; renderer.draw(state, testCamera);
    const program = renderer.cloudPrograms.get(quality);
    assert.equal(renderer.cloudMetrics.mode, 'volumetric');
    assert.equal(gl.uniforms.get(`${program.id}:uExposure`), 4);
    assert.equal(gl.uniforms.get(`${program.id}:uContrast`), 1.2);
    assert.equal(gl.uniforms.get(`${program.id}:uSaturation`), .5);
    assert.equal(renderer.cloudMetrics.quality, quality);
    assert.ok(renderer.cloudMetrics.pixels <= (await modules()).CLOUD_QUALITIES[quality].maxPixels);
  }
  assert.equal(renderer.cloudPrograms.size, 3);
  assert.equal(gl.sources.filter(source => source.includes('marchClouds')).length, 3);
  renderer.dispose(); assert.equal(gl.buffers.size, 0); assert.equal(gl.programs.size, 0); assert.equal(gl.textures.size, 0); assert.equal(renderer.locations.size, 0);
  const lost = makeRenderer(SkyViewportRenderer); lost.renderer.draw(testState(), testCamera); lost.gl.lost = true; lost.renderer.dispose(); assert.equal(lost.renderer.resources.length, 0); assert.equal(lost.renderer.cloudPrograms.size, 0);
});

test('manual optical changes invalidate the physical LUT baseline without evaluating Natural Light', async () => {
  const { SkyViewportRenderer, lutMatchesAtmosphere } = await rendererModule();
  const { renderer } = makeRenderer(SkyViewportRenderer); const state = testState();
  const payload = { input: { aerosolOpticalDepth550: .3 }, evaluation: { solarPosition: { azimuthDeg: 0, apparentElevationDeg: 30 } }, skyViewLut: { layout: { width: 1, height: 1, channels: ['R', 'G', 'B'] }, pixels: [.1, .2, .3] } };
  renderer.setLut(payload, state.atmosphere); renderer.draw(state, testCamera); assert.equal(renderer.usingLut, true);
  state.atmosphere.turbidity = 5; renderer.draw(state, testCamera); assert.equal(renderer.usingLut, false);
  state.atmosphere.turbidity = 2.4; renderer.draw(state, testCamera); assert.equal(renderer.usingLut, true);
  assert.equal(lutMatchesAtmosphere(payload, { aerosolOpticalDepth550: .6 }), false);
  assert.equal(lutMatchesAtmosphere(payload, { aerosolOpticalDepth550: Infinity }), false);
  assert.equal(lutMatchesAtmosphere({}, { haze: .3 }), true, 'older payloads preserve the supported physical Sun path');
  renderer.dispose();
});
