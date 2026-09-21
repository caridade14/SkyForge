// Z-up world: +X east, +Y north, +Z up. Distances are metres.
export const DEFAULT_CAMERA = Object.freeze({ yaw: 0.55, pitch: 0.22, distance: 12, target: [0, 0, 1.5], projection: 'perspective' });
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const mul = (a, s) => a.map(v => v * s);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const unit = a => mul(a, 1 / Math.max(1e-12, Math.hypot(...a)));
export function normalizeCamera(value = {}) {
  const d = DEFAULT_CAMERA;
  return {
    yaw: ((finite(value.yaw, d.yaw) + Math.PI) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI) - Math.PI,
    pitch: clamp(finite(value.pitch, d.pitch), -Math.PI/2 + 0.001, Math.PI/2 - 0.001),
    distance: clamp(finite(value.distance, d.distance), 0.25, 100000),
    target: [0,1,2].map(i => clamp(finite(value.target?.[i], d.target[i]), -1e6, 1e6)),
    projection: value.projection === 'orthographic' ? 'orthographic' : 'perspective'
  };
}
export function cameraBasis(value) {
  const c = normalizeCamera(value), cp = Math.cos(c.pitch);
  const back = [Math.sin(c.yaw)*cp, -Math.cos(c.yaw)*cp, Math.sin(c.pitch)];
  const forward = mul(back, -1), right = unit(cross(forward, [0,0,1])), up = cross(right, forward);
  return { eye: add(c.target, mul(back, c.distance)), forward, right, up };
}
export function orbit(camera, dx, dy) {
  return normalizeCamera({ ...camera, yaw: camera.yaw - dx*0.006, pitch: camera.pitch + dy*0.006 });
}
export function pan(camera, dx, dy, height, fov = 60) {
  const {right, up} = cameraBasis(camera);
  const scale = 2 * camera.distance * Math.tan(clamp(fov, 15, 120)*Math.PI/360) / Math.max(height, 1);
  return normalizeCamera({ ...camera, target: add(camera.target, add(mul(right, -dx*scale), mul(up, dy*scale))) });
}
export function dolly(camera, delta) {
  return normalizeCamera({ ...camera, distance: camera.distance * Math.exp(clamp(delta, -1000, 1000)*0.002) });
}
export function axisView(camera, view, opposite = false) {
  const sign = opposite ? -1 : 1;
  if (view === 'home') return normalizeCamera();
  if (view === 'front') return normalizeCamera({ ...camera, yaw: opposite ? Math.PI : 0, pitch: 0, projection: 'orthographic' });
  if (view === 'right') return normalizeCamera({ ...camera, yaw: sign*Math.PI/2, pitch: 0, projection: 'orthographic' });
  if (view === 'top') return normalizeCamera({ ...camera, yaw: 0, pitch: sign*Math.PI/2, projection: 'orthographic' });
  return normalizeCamera(camera);
}
export function rayAt(camera, x, y, aspect = 1, fov = 60) {
  const b = cameraBasis(camera), tangent = Math.tan(clamp(fov,15,120)*Math.PI/360);
  const offset = add(mul(b.right,x*aspect*tangent), mul(b.up,y*tangent));
  return camera.projection === 'orthographic'
    ? { origin: add(b.eye,mul(offset,camera.distance)), direction: b.forward }
    : { origin: b.eye, direction: unit(add(b.forward,offset)) };
}
export function sunDirection(sun = {}) {
  const a = finite(sun.azimuth, 215)*Math.PI/180, e = clamp(finite(sun.elevation,7),-90,90)*Math.PI/180;
  return [Math.cos(e)*Math.sin(a),Math.cos(e)*Math.cos(a),Math.sin(e)];
}
// Column-major matrices for WebGL geometry; sky rays use the same camera basis.
export function viewProjection(camera, aspect, fov = 60) {
  const {eye, right:r, up:u, forward:f} = cameraBasis(camera);
  const view = [r[0],u[0],-f[0],0,r[1],u[1],-f[1],0,r[2],u[2],-f[2],0,-dot(r,eye),-dot(u,eye),dot(f,eye),1];
  const t = Math.tan(clamp(fov,15,120)*Math.PI/360), n = 0.05, far = 200000;
  const h = camera.distance*t;
  const p = camera.projection === 'orthographic'
    ? [1/(h*aspect),0,0,0,0,1/h,0,0,0,0,-2/(far-n),0,0,0,-(far+n)/(far-n),1]
    : [1/(t*aspect),0,0,0,0,1/t,0,0,0,0,-(far+n)/(far-n),-1,0,0,-2*far*n/(far-n),0];
  const out = new Float32Array(16);
  for(let col=0;col<4;col++) for(let row=0;row<4;row++) for(let k=0;k<4;k++) out[col*4+row]+=p[k*4+row]*view[col*4+k];
  return out;
}
