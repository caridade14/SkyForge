import { add, mul, dot, unit, clamp, cameraBasis, normalizeCamera, rayAt } from './camera.js';

// Reference objects use metres in the viewport's Z-up world. Geometry is shared
// between objects; only a uniform translation and scalar scale change per draw.
export const REFERENCE_TYPES = Object.freeze(['sphere', 'cube', 'plane']);
const axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const scaleOf = object => clamp(Number(object?.scale) > 0 ? Number(object.scale) : 1, 0.01, 100000);
const positionOf = object => [0, 1, 2].map(index => Number.isFinite(Number(object?.position?.[index])) ? Number(object.position[index]) : 0);
const tangent = fov => Math.tan(clamp(Number(fov) || 60, 15, 120) * Math.PI / 360);

export function shapeGeometry(type) {
  const vertices = [], color = [0.4, 0.4, 0.4];
  const push = (point, normal) => vertices.push(...point, ...normal, ...color);
  if (type === 'sphere') {
    const point = (longitude, latitude) => [Math.sin(latitude) * Math.cos(longitude), Math.sin(latitude) * Math.sin(longitude), Math.cos(latitude)];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) {
      const a = x / 24 * Math.PI * 2, b = y / 16 * Math.PI;
      const c = (x + 1) / 24 * Math.PI * 2, d = (y + 1) / 16 * Math.PI;
      [point(a, b), point(a, d), point(c, d), point(a, b), point(c, d), point(c, b)].forEach(point => push(point, point));
    }
  } else if (type === 'cube') {
    const faces = [
      [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
      [[-1, 0, 0], [[-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1]]],
      [[0, 1, 0], [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]]],
      [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
      [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
      [[0, 0, -1], [[-1, 1, -1], [1, 1, -1], [1, -1, -1], [-1, -1, -1]]]
    ];
    for (const [normal, corners] of faces) [0, 1, 2, 0, 2, 3].forEach(index => push(corners[index], normal));
  } else if (type === 'plane') {
    const corners = [[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]];
    [0, 1, 2, 0, 2, 3].forEach(index => push(corners[index], [0, 0, 1]));
  }
  return new Float32Array(vertices);
}

export function outlineGeometry(type) {
  const vertices = [], push = point => vertices.push(...point, 0, 0, 1, 1, 0.62, 0.16);
  if (type === 'sphere') {
    for (let axis = 0; axis < 3; axis++) for (let index = 0; index < 64; index++) {
      for (const angle of [index / 64 * Math.PI * 2, (index + 1) / 64 * Math.PI * 2]) {
        const point = [0, 0, 0]; point[(axis + 1) % 3] = Math.cos(angle); point[(axis + 2) % 3] = Math.sin(angle); push(point);
      }
    }
  } else if (type === 'cube') {
    for (let axis = 0; axis < 3; axis++) for (const a of [-1, 1]) for (const b of [-1, 1]) {
      for (const value of [-1, 1]) {
        const point = [0, 0, 0]; point[axis] = value; point[(axis + 1) % 3] = a; point[(axis + 2) % 3] = b; push(point);
      }
    }
  } else if (type === 'plane') {
    const corners = [[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]];
    for (let index = 0; index < 4; index++) { push(corners[index]); push(corners[(index + 1) % 4]); }
  }
  return new Float32Array(vertices);
}

export function objectRadius(object) {
  return scaleOf(object) * (object?.type === 'cube' ? Math.sqrt(3) : object?.type === 'plane' ? Math.sqrt(8) : 1);
}

// x/y are normalized device coordinates (+Y up), matching rayAt and WebGL.
export function projectPoint(position, camera, aspect = 1, fov = 60) {
  const basis = cameraBasis(camera), relative = subtract(position, basis.eye);
  const depth = dot(relative, basis.forward), t = tangent(fov);
  const divisor = camera.projection === 'orthographic' ? camera.distance : Math.max(1e-8, depth);
  return { x: dot(relative, basis.right) / (divisor * Math.max(1e-8, aspect) * t),
    y: dot(relative, basis.up) / (divisor * t), depth, behind: depth <= 0.05 };
}

function hitSphere(origin, direction, radius) {
  const b = dot(origin, direction), discriminant = b * b - dot(origin, origin) + radius * radius;
  if (discriminant < 0) return null;
  const near = -b - Math.sqrt(discriminant), far = -b + Math.sqrt(discriminant);
  return near > 1e-5 ? near : far > 1e-5 ? far : null;
}
function hitCube(origin, direction, half) {
  let near = -Infinity, far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-9) { if (Math.abs(origin[axis]) > half) return null; continue; }
    const a = (-half - origin[axis]) / direction[axis], b = (half - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
    if (far < near) return null;
  }
  return near > 1e-5 ? near : far > 1e-5 ? far : null;
}
function hitPlane(origin, direction, half) {
  if (Math.abs(direction[2]) < 1e-9) return null;
  const distance = -origin[2] / direction[2];
  if (distance <= 1e-5) return null;
  const point = add(origin, mul(direction, distance));
  return Math.abs(point[0]) <= half && Math.abs(point[1]) <= half ? distance : null;
}

export function pickReferenceObject(mapOrValues, ray) {
  let best = null;
  for (const object of Array.isArray(mapOrValues) ? mapOrValues : Object.values(mapOrValues || {})) {
    if (!object || object.visible === false || !REFERENCE_TYPES.includes(object.type)) continue;
    const origin = subtract(ray.origin, positionOf(object)), scale = scaleOf(object);
    const distance = object.type === 'sphere' ? hitSphere(origin, ray.direction, scale)
      : object.type === 'cube' ? hitCube(origin, ray.direction, scale) : hitPlane(origin, ray.direction, scale * 2);
    if (distance !== null && (!best || distance < best.distance)) best = { object, distance };
  }
  return best;
}

export function frameObject(camera, object, aspect = 1, fov = 60) {
  const t = tangent(fov) * Math.min(1, Math.max(0.05, aspect));
  const radius = objectRadius(object) * 1.3;
  const distance = camera.projection === 'orthographic' ? radius / t : radius * Math.sqrt(1 + t * t) / t;
  return normalizeCamera({ ...camera, target: positionOf(object), distance });
}

// Screen-space handles maintain an approximately 80px length. A near-parallel
// axis is unavailable instead of amplifying tiny drags into huge translations.
export function axisSegments(position, camera, width, height, fov = 60) {
  const aspect = width / Math.max(1, height), origin = projectPoint(position, camera, aspect, fov);
  const pixels = point => [(point.x + 1) * width / 2, (1 - point.y) * height / 2];
  const depth = camera.projection === 'orthographic' ? camera.distance : Math.max(0.05, origin.depth);
  const lengthWorld = 160 * depth * tangent(fov) / Math.max(1, height);
  return Object.entries(axes).map(([axis, vector]) => {
    const endpoint = projectPoint(add(position, mul(vector, lengthWorld)), camera, aspect, fov);
    const start = pixels(origin), end = pixels(endpoint);
    return { axis, start, end, lengthWorld, enabled: !origin.behind && !endpoint.behind && Math.hypot(end[0] - start[0], end[1] - start[1]) >= 10 };
  });
}

function planeAtRay(ray, position, normal) {
  const denominator = dot(ray.direction, normal);
  if (Math.abs(denominator) < 1e-6) return null;
  const distance = dot(subtract(position, ray.origin), normal) / denominator;
  if (distance <= 0 || !Number.isFinite(distance)) return null;
  return add(ray.origin, mul(ray.direction, distance));
}

export function startAxisDrag(position, axis, camera, xNdc, yNdc, aspect = 1, fov = 60) {
  const vector = axes[axis]; if (!vector) return null;
  const forward = cameraBasis(camera).forward;
  const normal = subtract(forward, mul(vector, dot(forward, vector)));
  if (Math.hypot(...normal) < 0.1) return null;
  const normalized = unit(normal), frozenCamera = normalizeCamera(camera);
  const start = planeAtRay(rayAt(frozenCamera, xNdc, yNdc, aspect, fov), position, normalized);
  return start ? { position: [...position], axis: vector, normal: normalized, start, camera: frozenCamera, aspect, fov } : null;
}

export function moveAxisDrag(session, xNdc, yNdc) {
  if (!session) return null;
  const hit = planeAtRay(rayAt(session.camera, xNdc, yNdc, session.aspect, session.fov), session.position, session.normal);
  if (!hit) return null;
  const amount = dot(subtract(hit, session.start), session.axis);
  if (!Number.isFinite(amount)) return null;
  return session.position.map((value, index) => clamp(value + session.axis[index] * amount, -1e6, 1e6));
}
