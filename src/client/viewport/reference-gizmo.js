import { rayAt, dot } from './camera.js';
import { axisSegments, rotationSegments, startAxisDrag, moveAxisDrag, pickReferenceObject, frameObject } from './reference-geometry.js';
import { rotationMatrix3, scaleVector, rotatedEuler, rotationDrag, rotationAmount } from './transform-math.js';

const editable = target => Boolean(target?.closest?.('input,textarea,select,[contenteditable="true"]'));
const editor = target => Boolean(target?.closest?.('.sf-studio-nodes,.sf-studio-timeline'));
const colors = { x: '#ff8178', y: '#79e69e', z: '#82bcff' };
function lineDistance(point, a, b, omitOrigin = false) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  // The common origin remains available for selecting the object itself.
  return omitOrigin && t < 0.18 ? Infinity : Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}
function segmentDistance(point, segment) {
  if (segment.points) return Math.min(...segment.points.slice(1).map((p, i) => lineDistance(point, segment.points[i], p)));
  return lineDistance(point, segment.start, segment.end, true);
}

export class ReferenceGizmo {
  constructor(canvas, overlay, { store, getCamera, getFov, isActive, invalidate, commitCamera, beforeFrame = () => {}, root = globalThis }) {
    Object.assign(this, { canvas, overlay, store, getCamera, getFov, isActive, invalidate, commitCamera, beforeFrame, root });
    this.drag = null; this.listeners = []; this.segments = [];
    // Sun owns its marker first; this owner precedes navigation and all Legacy listeners.
    this.listen('pointerdown', e => {
      if (e.target !== canvas || !isActive() || e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || this.drag) return;
      canvas.focus({ preventScroll: true });
      if (['orbit','pan','dolly'].includes(store.get('viewport.navigationTool'))) return;
      const r = canvas.getBoundingClientRect(), p = [e.clientX - r.left, e.clientY - r.top];
      const selected = this.selected();
      const mode = this.mode(), space = this.space();
      const segments = this.handles(selected, getCamera(), r.width, r.height, getFov());
      const hit = segments.filter(s => s.enabled).map(segment => ({ segment, distance: segmentDistance(p, segment) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (hit?.distance <= 9) {
        const ndc = this.pointer(e, r);
        const args = [selected.position, hit.segment.vector, getCamera(), ndc[0], ndc[1], r.width / Math.max(1, r.height), getFov()];
        const session = mode === 'rotate' ? rotationDrag(...args) : startAxisDrag(...args);
        if (session) {
          const field = mode === 'rotate' ? 'rotation' : mode === 'scale' ? 'scale' : 'position';
          const label = mode === 'rotate' ? 'Rotate' : mode === 'scale' ? 'Scale' : 'Move';
          const edit = store.beginEdit(['scene', 'referenceObjects', selected.id, field], { label: `${label} ${selected.name} ${hit.segment.axis.toUpperCase()}` });
          this.drag = { id: e.pointerId, objectId: selected.id, edit, session, mode, space, axis: hit.segment.axis,
            lengthWorld: hit.segment.lengthWorld, before: field === 'scale' ? scaleVector(selected) : [...(selected[field] || [0, 0, 0])],
            x: e.clientX, y: e.clientY, lastAngle: 0, angle: 0 };
          canvas.setPointerCapture?.(e.pointerId); this.eat(e); return;
        }
      }
      const ndc = this.pointer(e, r);
      const ray = rayAt(getCamera(), ndc[0], ndc[1], r.width / Math.max(1, r.height), getFov());
      const hitObject = pickReferenceObject(store.get('scene.referenceObjects') || {}, ray);
      const aid = store.get('viewport.referenceSphere') !== false
        ? pickReferenceObject([{ type: 'sphere', position: [0, 0, 1.2], scale: 1.2 }], ray) : null;
      const object = hitObject && (!aid || hitObject.distance < aid.distance) ? hitObject.object : null;
      store.set('scene.selectedReferenceId', object?.id || null, { record: false, label: 'Select reference object' });
      this.eat(e);
    });
    this.listen('pointermove', e => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const object = this.selected();
      if (!d.edit.active || object?.id !== d.objectId || object.visible === false || object.locked || this.mode() !== d.mode || this.space() !== d.space) { this.finish(true); return; }
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 2 && !d.moved) { this.eat(e); return; }
      const ndc = this.pointer(e);
      let value;
      if (d.mode === 'rotate') {
        const angle = rotationAmount(d.session, ndc[0], ndc[1]);
        if (angle !== null) {
          let delta = angle - d.lastAngle;
          if (delta > 180) delta -= 360; else if (delta < -180) delta += 360;
          d.angle += delta; d.lastAngle = angle;
          value = rotatedEuler(d.before, d.axis, d.angle, d.space === 'local');
        }
      } else {
        const position = moveAxisDrag(d.session, ndc[0], ndc[1]);
        if (position && d.mode === 'scale') {
          const amount = dot(position.map((v, i) => v - d.session.position[i]), d.session.axis);
          const ratio = 1 + amount / d.lengthWorld, index = ['x', 'y', 'z'].indexOf(d.axis);
          value = d.before.map((v, i) => i === index ? Math.max(.01, Math.min(100000, v * ratio)) : v);
        } else value = position;
      }
      if (value?.every(Number.isFinite)) {
        d.moved = true; d.edit.preview(value);
      }
      this.eat(e);
    });
    this.listen('pointerup', e => { if (this.drag?.id === e.pointerId) { this.finish(false); this.eat(e); } });
    this.listen('pointercancel', e => { if (this.drag?.id === e.pointerId) { this.finish(true); this.eat(e); } });
    this.listen('lostpointercapture', e => { if (this.drag?.id === e.pointerId) this.finish(true); });
    this.listen('wheel', e => { if (e.target === canvas) this.finish(true); });
    this.listen('blur', () => this.finish(true));
    this.listen('keydown', e => {
      if (this.drag) {
        if (e.key === 'Escape') { this.finish(true); this.eat(e); return; }
        if (e.metaKey || e.ctrlKey || ['Home', 'Numpad1', 'Numpad3', 'Numpad7', 'Numpad5', 'NumpadDecimal'].includes(e.code)) this.finish(true);
      }
      if (editable(e.target) || editor(e.target)) return;
      const key = String(e.key || '').toLowerCase(), mod = e.metaKey || e.ctrlKey;
      const redo = key === 'y' || e.shiftKey;
      const change = (redo ? store.future : store.history).at(-1);
      const referenceChange = change?.path?.startsWith('scene.referenceObjects') || (change?.type === 'batch' &&
        JSON.stringify(change.before?.scene?.referenceObjects) !== JSON.stringify(change.after?.scene?.referenceObjects));
      // One history owner avoids simultaneous Core and Legacy document handlers.
      if ((isActive() || this.selected() || referenceChange) && mod && (key === 'z' || key === 'y')) {
        beforeFrame();
        if (redo) store.redo(); else store.undo();
        this.eat(e); return;
      }
      if (isActive() && key === 'f' && !mod && !e.altKey && this.selected()) { this.frameSelected(); this.eat(e); }
      if (isActive() && !mod && !e.altKey && this.selected() && ['g', 'r', 's'].includes(key) &&
        (e.target === canvas || e.target?.closest?.('.sf-3d-host'))) {
        this.finish(true);
        store.set('viewport.navigationTool','transform',{record:false,label:'Choose transform tool'});
        store.set('viewport.transformTool', { g: 'move', r: 'rotate', s: 'scale' }[key], { record: false, label: 'Transform tool' });
        this.invalidate(); this.eat(e);
      }
    });
  }
  listen(type, fn) { this.root.addEventListener(type, fn, { capture: true, passive: false }); this.listeners.push([type, fn]); }
  eat(e) { e.preventDefault(); e.stopImmediatePropagation(); }
  selected() { const id = this.store.get('scene.selectedReferenceId'); return id ? this.store.get(['scene', 'referenceObjects', id]) : null; }
  mode() { const value = this.store.get('viewport.transformTool'); return ['move', 'rotate', 'scale'].includes(value) ? value : 'move'; }
  space() { return this.store.get('viewport.transformSpace') === 'local' ? 'local' : 'global'; }
  handles(object, camera, width, height, fov) {
    if (!object || object.visible === false || object.locked || this.store.get('viewport.navigationTool') === 'select') return [];
    const mode = this.mode(), orientation = mode === 'scale' || this.space() === 'local' ? rotationMatrix3(object.rotation) : null;
    return (mode === 'rotate' ? rotationSegments : axisSegments)(object.position, camera, width, height, fov, orientation);
  }
  pointer(e, r = this.canvas.getBoundingClientRect()) { return [2 * (e.clientX - r.left) / Math.max(1, r.width) - 1, 1 - 2 * (e.clientY - r.top) / Math.max(1, r.height)]; }
  frameSelected() {
    this.finish(true); this.beforeFrame();
    const object = this.selected(); if (!object) return false;
    const r = this.canvas.getBoundingClientRect();
    this.commitCamera(frameObject(this.getCamera(), object, r.width / Math.max(1, r.height), this.getFov()), 'Frame selected reference');
    this.canvas.focus({ preventScroll: true }); return true;
  }
  update(camera, width, height, fov) {
    const current = this.selected();
    if (this.drag && (!this.drag.edit.active || current?.id !== this.drag.objectId || current.visible === false || current.locked || this.mode() !== this.drag.mode || this.space() !== this.drag.space)) this.finish(true);
    const object = this.selected();
    const mode = this.mode();
    this.segments = this.handles(object, camera, width, height, fov);
    this.overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.overlay.innerHTML = this.segments.filter(s => s.enabled).map(s => {
      const color = colors[s.axis], [x, y] = s.end;
      if (s.points) {
        const label = s.points[24];
        return `<g stroke="${color}" fill="${color}"><polyline points="${s.points.map(p => p.join(',')).join(' ')}" fill="none" stroke-width="3"/><text x="${label[0] + 8}" y="${label[1]}" stroke="none">${s.axis.toUpperCase()}</text></g>`;
      }
      const end = mode === 'scale' ? `<rect x="${x - 5}" y="${y - 5}" width="10" height="10"/>` : `<circle cx="${x}" cy="${y}" r="5"/>`;
      return `<g stroke="${color}" fill="${color}"><line x1="${s.start[0]}" y1="${s.start[1]}" x2="${x}" y2="${y}" stroke-width="3"/>${end}<text x="${x + 9}" y="${y + 4}" stroke="none">${s.axis.toUpperCase()}</text></g>`;
    }).join('');
    const action = mode === 'rotate' ? 'Rotate' : mode === 'scale' ? 'Scale' : 'Move';
    this.overlay.setAttribute('aria-label', object ? `${action} ${object.name} along X, Y or Z (${mode === 'scale' ? 'local' : this.space()}); Escape cancels` : 'No reference selected');
  }
  finish(cancel) {
    const d = this.drag; if (!d) return;
    this.drag = null;
    if (cancel || !d.moved) d.edit.cancel(); else d.edit.commit();
    if (this.canvas.hasPointerCapture?.(d.id)) this.canvas.releasePointerCapture(d.id);
    this.invalidate();
  }
  dispose() { this.finish(true); for (const [type, fn] of this.listeners) this.root.removeEventListener(type, fn, true); this.listeners = []; }
}
