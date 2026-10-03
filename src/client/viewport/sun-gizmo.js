import { cameraBasis, sunDirection, dot, unit, clamp } from './camera.js';

const radians = Math.PI / 180;
const tangent = fov => Math.tan(clamp(Number(fov) || 60, 15, 120) * radians / 2);

// A direction has no world-space position. Perspective follows the sky ray;
// orthographic places it on a unit orientation hemisphere around the view target.
export function projectSun(sun, camera, aspect = 1, fov = 60) {
  const direction = sunDirection(sun), basis = cameraBasis(camera);
  const depth = dot(direction, basis.forward), t = tangent(fov);
  const divisor = camera.projection === 'orthographic' ? 1 : Math.max(1e-6, Math.abs(depth));
  return { x: dot(direction, basis.right) / (divisor * aspect * t),
    y: dot(direction, basis.up) / (divisor * t), behind: depth <= 0 };
}

export function sunAtPointer(camera, x, y, aspect = 1, fov = 60, previousAzimuth = 0) {
  const basis = cameraBasis(camera), t = tangent(fov);
  let horizontal = x * aspect * t, vertical = y * t;
  let forward = 1;
  if (camera.projection === 'orthographic') {
    const length = Math.hypot(horizontal, vertical);
    if (length > 1) { horizontal /= length; vertical /= length; }
    forward = Math.sqrt(Math.max(0, 1 - horizontal * horizontal - vertical * vertical));
  }
  const direction = unit(basis.forward.map((v, i) => v * forward + basis.right[i] * horizontal + basis.up[i] * vertical));
  const azimuth = Math.hypot(direction[0], direction[1]) < 1e-8 ? previousAzimuth
    : ((Math.atan2(direction[0], direction[1]) / radians) % 360 + 360) % 360;
  return { azimuth, elevation: Math.asin(clamp(direction[2], -1, 1)) / radians };
}

export function sunMarker(sun, camera, width, height, fov = 60) {
  const projected = projectSun(sun, camera, width / Math.max(1, height), fov);
  const margin = Math.min(24, width / 4, height / 4), top = Math.min(70, height / 4);
  let x = width * (projected.x + 1) / 2, y = height * (1 - projected.y) / 2;
  const offscreen = projected.behind || x < margin || x > width - margin || y < top || y > height - margin;
  if (offscreen) {
    let dx = projected.x, dy = -projected.y;
    if (Math.hypot(dx, dy) < 1e-6) dx = 1;
    const scale = Math.min((width / 2 - margin) / Math.max(1e-6, Math.abs(dx)),
      (height / 2 - (dy < 0 ? top : margin)) / Math.max(1e-6, Math.abs(dy)));
    x = width / 2 + dx * scale; y = height / 2 + dy * scale;
  }
  return { x, y, offscreen, angle: Math.atan2(y - height / 2, x - width / 2) / radians };
}

export class SunGizmo {
  constructor(canvas, marker, { store, getCamera, getFov, isActive, invalidate, root = globalThis }) {
    Object.assign(this, { canvas, marker, store, getCamera, getFov, isActive, invalidate, root });
    this.drag = null; this.listeners = [];
    // Register before navigation so only a plain LMB hit owns the sun gesture.
    this.listen('pointerdown', e => {
      if (e.target !== canvas || !isActive() || e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || this.drag) return;
      const rect = canvas.getBoundingClientRect(), camera = getCamera();
      const position = sunMarker(store.get('sun'), camera, rect.width, rect.height, getFov());
      if (Math.hypot(e.clientX - rect.left - position.x, e.clientY - rect.top - position.y) > 22) return;
      // Focus may blur a previously edited slider. Do this before opening a gesture.
      canvas.focus({ preventScroll: true });
      const edit = store.beginEdit('sun', { label: 'Move sun direction' });
      const before = store.get('sun') || {};
      this.drag = { id: e.pointerId, edit, before, camera, fov: getFov(),
        x: e.clientX, y: e.clientY, offsetX: position.offscreen ? 0 : e.clientX - rect.left - position.x,
        offsetY: position.offscreen ? 0 : e.clientY - rect.top - position.y };
      canvas.setPointerCapture?.(e.pointerId);
      marker.classList.add('sf-sun-dragging'); this.eat(e);
    });
    this.listen('pointermove', e => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      if (!d.edit.active) { this.finish(true); return; }
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 2 && !d.moved) { this.eat(e); return; }
      d.moved = true;
      const r = canvas.getBoundingClientRect();
      const x = 2 * (e.clientX - r.left - d.offsetX) / Math.max(1, r.width) - 1;
      const y = 1 - 2 * (e.clientY - r.top - d.offsetY) / Math.max(1, r.height);
      d.edit.preview({ ...d.before, ...sunAtPointer(d.camera, x, y, r.width / Math.max(1, r.height), d.fov, d.before.azimuth) });
      this.eat(e);
    });
    this.listen('pointerup', e => { if (this.drag?.id === e.pointerId) { this.finish(false); this.eat(e); } });
    this.listen('pointercancel', e => { if (this.drag?.id === e.pointerId) { this.finish(true); this.eat(e); } });
    this.listen('lostpointercapture', e => { if (this.drag?.id === e.pointerId) this.finish(true); });
    this.listen('keydown', e => {
      if (!this.drag) return;
      if (e.key === 'Escape') { this.finish(true); this.eat(e); }
      else if (e.metaKey || e.ctrlKey || ['Home', 'Numpad1', 'Numpad3', 'Numpad7', 'Numpad5', 'NumpadDecimal'].includes(e.code)) this.finish(true);
    });
    this.listen('wheel', e => { if (e.target === canvas) this.finish(true); });
    this.listen('blur', () => this.finish(true));
  }
  listen(type, fn) { this.root.addEventListener(type, fn, { capture: true, passive: false }); this.listeners.push([type, fn]); }
  eat(e) { e.preventDefault(); e.stopImmediatePropagation(); }
  update(sun, camera, width, height, fov) {
    if (this.drag && !this.drag.edit.active) this.finish(true);
    const position = sunMarker(sun, camera, width, height, fov);
    this.marker.style.left = `${position.x}px`; this.marker.style.top = `${position.y}px`;
    this.marker.style.setProperty('--sf-sun-angle', `${position.angle}deg`);
    this.marker.classList.toggle('sf-sun-offscreen', position.offscreen);
    this.marker.setAttribute('aria-label', `Sun direction: azimuth ${Number(sun?.azimuth || 0).toFixed(1)}°, elevation ${Number(sun?.elevation || 0).toFixed(1)}°. Drag with left mouse button; Escape cancels.`);
    this.marker.title = position.offscreen ? 'Sun outside view · drag to place in view' : 'Drag sun direction · Escape cancels · Alt drag navigates';
  }
  finish(cancel) {
    const d = this.drag; if (!d) return;
    this.drag = null;
    if (cancel || !d.moved) d.edit.cancel(); else d.edit.commit();
    if (this.canvas.hasPointerCapture?.(d.id)) this.canvas.releasePointerCapture(d.id);
    this.marker.classList.remove('sf-sun-dragging'); this.invalidate();
  }
  dispose() { this.finish(true); for (const [type, fn] of this.listeners) this.root.removeEventListener(type, fn, true); this.listeners = []; }
}
