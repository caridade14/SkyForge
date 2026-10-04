import { dot, add, mul, unit, cameraBasis, rayAt } from './camera.js';
const rad = Math.PI / 180;
const bounded = (v, a, b, fallback = 0) => Math.max(a, Math.min(b, Number.isFinite(Number(v)) ? Number(v) : fallback));
export const scaleVector = object => [0, 1, 2].map(i => bounded(Array.isArray(object?.scale) ? object.scale[i] : object?.scale, .01, 100000, 1));
export function rotationMatrix3(rotation = []) {
  const [x, y, z] = [0, 1, 2].map(i => bounded(rotation[i], -1e6, 1e6) * rad);
  const sx = Math.sin(x), cx = Math.cos(x), sy = Math.sin(y), cy = Math.cos(y), sz = Math.sin(z), cz = Math.cos(z);
  return [cz*cy, sz*cy, -sy, cz*sy*sx-sz*cx, sz*sy*sx+cz*cx, cy*sx, cz*sy*cx+sz*sx, sz*sy*cx-cz*sx, cy*cx];
}
export const rotateVector = (v, m) => [0, 1, 2].map(i => m[i]*v[0] + m[3+i]*v[1] + m[6+i]*v[2]);
export const inverseRotateVector = (v, m) => [0, 1, 2].map(i => dot(v, m.slice(i*3, i*3+3)));
export function multiplyRotation(a, b) { return [0, 1, 2].flatMap(i => rotateVector(b.slice(i*3, i*3+3), a)); }
export function matrixEuler(m) {
  const y = Math.asin(bounded(-m[2], -1, 1)), cy = Math.cos(y);
  return [(Math.abs(cy) > 1e-6 ? Math.atan2(m[5], m[8]) : 0) / rad, y / rad,
    (Math.abs(cy) > 1e-6 ? Math.atan2(m[1], m[0]) : Math.atan2(-m[3], m[4])) / rad];
}
export function rotatedEuler(before, axis, angle, local = false) {
  const delta = [0, 0, 0]; delta[['x','y','z'].indexOf(axis)] = angle;
  const base = rotationMatrix3(before), turn = rotationMatrix3(delta);
  return matrixEuler(local ? multiplyRotation(base, turn) : multiplyRotation(turn, base));
}
export function pointOnPlane(ray, point, normal) {
  const divisor = dot(ray.direction, normal); if (Math.abs(divisor) < 1e-7) return null;
  const t = dot(point.map((v, i) => v - ray.origin[i]), normal) / divisor;
  return t > 0 && Number.isFinite(t) ? add(ray.origin, mul(ray.direction, t)) : null;
}
export function rotationDrag(position, vector, camera, x, y, aspect, fov) {
  const normal = unit(vector), start = pointOnPlane(rayAt(camera, x, y, aspect, fov), position, normal);
  if (!start || Math.abs(dot(normal, cameraBasis(camera).forward)) < .1) return null;
  const direction = unit(start.map((v, i) => v - position[i]));
  return { position, normal, direction, camera, aspect, fov };
}
export function rotationAmount(session, x, y) {
  const point = pointOnPlane(rayAt(session.camera, x, y, session.aspect, session.fov), session.position, session.normal);
  if (!point) return null;
  const a = session.direction, b = unit(point.map((v, i) => v - session.position[i]));
  const cross = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  return Math.atan2(dot(session.normal, cross), dot(a, b)) / rad;
}
