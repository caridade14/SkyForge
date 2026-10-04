// The legacy scene is Y-up with +Z north; the viewport is Z-up with +Y north.
// Swap Y/Z to preserve geographic meaning. Generate meshes in viewport space:
// this permutation changes handedness and must not be applied to triangle winding.
export const REFERENCE_TYPES = Object.freeze(['sphere', 'cube', 'plane']);
const typeOf = value => String(value || '').toLowerCase();
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const size = value => Math.max(.01, Math.min(100000, finite(value, 1)));
const uniformSize = value => Array.isArray(value) ? Math.max(...value.map(size)) : size(value);
const resizedUniformly = (object, value) => {
  const next = size(value);
  if (!Array.isArray(object.scale)) return next;
  const previous = uniformSize(object.scale);
  return object.scale.map(component => size(size(component) * next / previous));
};
const referenceTransform = value => ({ upAxis: 'Z', rotation: value.rotation || [0,0,0], scale: value.scale });
export const legacyToViewportPosition = value => Array.isArray(value)
  ? [finite(value[0]), finite(value[2]), finite(value[1])]
  : [finite(value?.x), finite(value?.z), finite(value?.y)];
export const viewportToLegacyPosition = value => ({ x: finite(value?.[0]), y: finite(value?.[2]), z: finite(value?.[1]) });
export function normalizeReferenceObject(value, id = value?.id) {
  const type = typeOf(value?.type);
  if (!id || !REFERENCE_TYPES.includes(type)) return null;
  return {
    id: String(id), type, name: String(value.name || `Reference ${type}`),
    position: [0, 1, 2].map(index => Math.max(-1e6, Math.min(1e6, finite(value.position?.[index])))),
    ...(Array.isArray(value.rotation) ? {rotation:[0,1,2].map(i=>Math.max(-1e6,Math.min(1e6,finite(value.rotation[i]))))} : {}),
    scale: Array.isArray(value.scale) ? [0,1,2].map(i=>size(value.scale[i])) : size(value.scale), visible: value.visible !== false, locked: value.locked === true
  };
}
export function referenceFromLegacy(value) {
  const type = typeOf(value?.type);
  if (!REFERENCE_TYPES.includes(type)) return null;
  // Old ROT rotates a Canvas symbol. Retain its angle as viewport RZ when no
  // explicit 3D transform exists; metadata owns all three Euler components.
  const transform = value.referenceTransform?.upAxis === 'Z' ? value.referenceTransform
    : value.rot !== undefined ? { rotation: [0, 0, finite(value.rot)] } : {};
  return normalizeReferenceObject({ ...value, ...transform, type, position: legacyToViewportPosition(value) }, value.key || value.id);
}
export function referenceToLegacy(value, previous = {}) {
  return { ...previous, key: value.id, type: value.type.toUpperCase(), name: value.name,
    ...viewportToLegacyPosition(value.position), scale: uniformSize(value.scale), rot: value.rotation?.[2] || 0, referenceTransform: referenceTransform(value),
    visible: value.visible, locked: value.locked, added: true, props: {} };
}

// ProjectService clones the input before calling this migration. Keep every raw
// legacy record for Legacy View, and add only the supported explicit types.
export function prepareReferenceScene(payload) {
  const legacy = Array.isArray(payload.objects) ? payload.objects : payload.scene?.objects;
  if (!payload.scene || typeof payload.scene !== 'object' || Array.isArray(payload.scene)) payload.scene = {};
  if (Array.isArray(legacy) && !Array.isArray(payload.scene.legacyObjects)) payload.scene.legacyObjects = legacy.filter(value => !REFERENCE_TYPES.includes(typeOf(value?.type)));
  if (!payload.scene.referenceObjects || typeof payload.scene.referenceObjects !== 'object' || Array.isArray(payload.scene.referenceObjects)) {
    const objects = {};
    if (Array.isArray(legacy)) for (const [index, value] of legacy.entries()) {
      if (!REFERENCE_TYPES.includes(typeOf(value?.type))) continue;
      const object = referenceFromLegacy({ ...value, key: value.key || value.id || `legacy-ref-${index}` });
      if (object) objects[object.id] = object;
    }
    payload.scene.referenceObjects = objects;
    const selected = Array.isArray(legacy) ? legacy.findIndex(value => value?.selected && REFERENCE_TYPES.includes(typeOf(value.type))) : -1;
    payload.scene.selectedReferenceId = selected >= 0 ? (legacy[selected].key || legacy[selected].id || `legacy-ref-${selected}`) : null;
  }
  const normalized = {};
  for (const [id, value] of Object.entries(payload.scene.referenceObjects)) {
    const object = normalizeReferenceObject(value, id);
    if (object) normalized[id] = object;
  }
  payload.scene.referenceObjects = normalized;
  if (!normalized[payload.scene.selectedReferenceId]) payload.scene.selectedReferenceId = null;
  return payload;
}

/** Explicit boundary between Core references and the existing DOM scene tools. */
export class SceneObjectAdapter {
  constructor(store, { root = globalThis, onFrame = () => {} } = {}) {
    Object.assign(this, { store, root, onFrame });
    this.document = root.document; this.originals = new Map(); this.listeners = [];
    this.applying = false; this.disposed = false; this.signature = '';
  }
  objects(state = this.store.snapshot()) { return state.scene?.referenceObjects || {}; }
  rows() { return [...(this.list?.querySelectorAll('.tri-out-extra') || [])]; }
  row(id) { return this.rows().find(row => row.dataset.sfKey === id) || null; }
  rowId(row) {
    return row && REFERENCE_TYPES.includes(typeOf(row.children?.[2]?.textContent)) && this.objects()[row.dataset.sfKey]
      ? row.dataset.sfKey : null;
  }
  selectedRow() { return this.root.sfGetSelectedOutlinerRow?.() || this.list?.querySelector('.tri-out-extra.sel'); }
  selectedObject(row = this.selectedRow()) { return this.objects()[this.rowId(row)] || null; }
  on(target, type, fn, capture = false) { target?.addEventListener(type, fn, capture); this.listeners.push([target, type, fn, capture]); }
  wrap(name, fn) {
    const original = this.root[name];
    if (typeof original !== 'function') return;
    const adapter = this;
    const wrapped = function (...args) { return fn.call(adapter, original, this, args); };
    this.originals.set(name, { original, wrapped }); this.root[name] = wrapped;
  }
  call(name, ...args) {
    const entry = this.originals.get(name);
    return entry ? entry.original.apply(this.root, args) : this.root[name]?.(...args);
  }
  init() {
    this.list = this.document?.getElementById('outliner-list');
    if (!this.list || this.disposed) return this;
    this.installWrappers();
    this.createInspectorUI();
    // Existing legacy scene files may already contain explicit reference types.
    if (!Object.keys(this.objects()).length && this.rows().some(row => REFERENCE_TYPES.includes(typeOf(row.children[2]?.textContent)))) {
      this.importRows({ record: false, transient: true });
    }
    this.unsubscribe = this.store.subscribe((state, change) => this.sync(state, change));
    if (this.root.MutationObserver) {
      this.observer = new this.root.MutationObserver(() => {
        if (this.applying || this.disposed) return;
        // Legacy startup clears its DOM scene after some module load orders.
        // Autosaved Core references remain authoritative during that bootstrap.
        if (this.root.SF_STARTUP_EMPTY_LOCK) { this.signature = ''; this.sync(this.store.snapshot()); }
        else this.importRows();
      });
      this.observer.observe(this.list, { childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['class', 'data-sf-x', 'data-sf-y', 'data-sf-z', 'data-sf-scale', 'data-sf-rot', 'data-sf-props', 'data-sf-group'] });
    }
    this.on(this.root, 'mousedown', event => {
      if (!this.root.SF_VIEWPORT_3D_ACTIVE && event.button === 0 && event.target?.closest?.('#vp')) this.legacyPointer = true;
    }, true);
    this.on(this.root, 'mouseup', () => this.finishLegacyEdit(false), true);
    this.on(this.root, 'blur', () => this.finishLegacyEdit(true));
    this.on(this.root, 'keydown', event => {
      if (event.key !== 'Escape') return;
      // Let the legacy controller also discard its private drag state after the
      // Store cancels; otherwise subsequent mousemoves could restart the edit.
      if (this.legacyEdit?.active) { event.preventDefault(); this.finishLegacyEdit(true); }
      if (event.target?.matches?.('[data-studio-transform]') && this.selectedObject()) {
        event.preventDefault(); event.stopImmediatePropagation(); this.finishNumericEdit(true);this.syncTransform(this.selectedRow());event.target.blur?.();return;
      }
      if (event.target?.matches?.('#tri-pos-x,#tri-pos-y,#tri-pos-z,#tri-scale') && this.selectedObject()) {
        event.preventDefault(); event.stopImmediatePropagation(); this.syncTransform(this.selectedRow()); event.target.blur?.();
      }
    }, true);
    // Capture reference eye/lock clicks before legacy document listeners capture
    // their own history. Other object types retain the legacy handlers.
    this.on(this.root, 'click', event => {
      const control = event.target?.closest?.('#outliner-list .tri-eye,#outliner-list .tri-lock');
      if (!control) return;
      const row = control?.closest?.('.tri-out-extra'), object = this.selectedObject(row);
      if (!object || this.applying) return;
      event.preventDefault(); event.stopImmediatePropagation(); this.select(object.id);
      const key = control.classList.contains('tri-eye') ? 'visible' : 'locked';
      this.store.set(['scene', 'referenceObjects', object.id, key], !object[key], { label: `Toggle reference ${key}` });
    }, true);
    this.sync(this.store.snapshot());
    return this;
  }
  createInspectorUI() {
    const grid = this.document.querySelector('.tri-transform-grid');
    if (!grid) return;
    this.note = this.document.createElement('div'); this.note.id = 'sf-reference-coordinate-note';
    this.note.className = 'sf-inspector-readout'; this.note.hidden = true;
    this.note.textContent = 'Reference position · metres · Z up'; grid.insertAdjacentElement('afterend', this.note);
    this.frameButton = this.document.createElement('button'); this.frameButton.className = 'sf-mini-btn';
    this.frameButton.dataset.refAction = 'frame'; this.frameButton.textContent = 'Frame selected (F)';
    this.frameButton.hidden = true; this.frameButton.onclick = () => this.root.sfFocusOutlinerRow?.(this.selectedRow());
    this.note.insertAdjacentElement('afterend', this.frameButton);
    this.createTransformInspector();
  }
  createTransformInspector() {
    this.transformInspector=this.document.createElement('div');this.transformInspector.className='sf-reference-transforms';this.transformInspector.hidden=true;
    this.transformInspector.innerHTML='<div class="sf-inspector-readout">Rotation · XYZ degrees · scale in local dimensions</div>'+['rotation','scale'].map(key=>'<div class="tri-transform-grid">'+['x','y','z'].map(axis=>`<label class="tri-transform-field"><b>${key==='rotation'?'R':'S'}${axis.toUpperCase()}</b><input id="sf-ref-${key}-${axis}" data-studio-transform="${key}" data-axis="${axis}" type="number" step="${key==='scale'?'.05':'1'}" ${key==='scale'?'min=".01" max="100000"':''} aria-label="${key} ${axis.toUpperCase()}"></label>`).join('')+'</div>').join('');
    this.frameButton.insertAdjacentElement('afterend',this.transformInspector);
    for(const input of this.transformInspector.querySelectorAll('input')){
      this.on(input,'focus',()=>this.startNumericEdit(input));
      this.on(input,'input',()=>this.previewNumericEdit(input));
      this.on(input,'change',()=>{this.previewNumericEdit(input);this.finishNumericEdit(false);});
      this.on(input,'blur',()=>this.finishNumericEdit(false));
    }
  }
  startNumericEdit(input){
    const object=this.selectedObject();if(!object||object.locked)return;
    this.finishNumericEdit(false);this.numericObjectId=object.id;this.numericKey=input.dataset.studioTransform;this.numericStartedVisible=object.visible!==false;
    this.numericEdit=this.store.beginEdit(['scene','referenceObjects',object.id,this.numericKey],{label:`Edit reference ${this.numericKey}`});
  }
  previewNumericEdit(input){
    if(input.value===''||!Number.isFinite(Number(input.value)))return;
    const object=this.selectedObject();if(!object||object.locked)return;
    if(!this.numericEdit?.active)this.startNumericEdit(input);
    const values=this.numericKey==='rotation'?[...(object.rotation||[0,0,0])]:Array.isArray(object.scale)?[...object.scale]:[object.scale,object.scale,object.scale];
    values[['x','y','z'].indexOf(input.dataset.axis)]=this.numericKey==='scale'?size(input.value):Math.max(-1e6,Math.min(1e6,Number(input.value)));
    this.numericEdit?.preview(values);
  }
  finishNumericEdit(cancel){const edit=this.numericEdit;this.numericEdit=null;this.numericObjectId=null;this.numericKey=null;this.numericStartedVisible=null;if(cancel)edit?.cancel();else edit?.commit();}
  add(type, name, options = {}) {
    type = typeOf(type);
    if (!REFERENCE_TYPES.includes(type)) return null;
    const id = `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const object = normalizeReferenceObject({ id, type, name: name || `Reference ${type[0].toUpperCase()}${type.slice(1)}`,
      position: options.position ? legacyToViewportPosition(options.position) : [3, 0, type === 'plane' ? 0 : 1],
      rotation: options.rotation || [0,0,0], scale: options.scale ?? 1, visible: options.visible, locked: false });
    this.pendingGroup = options.groupKey;
    this.store.batch(`Add reference ${type}`, draft => {
      draft.scene ||= {}; draft.scene.referenceObjects ||= {};
      draft.scene.referenceObjects[id] = object; draft.scene.selectedReferenceId = id;
    });
    this.pendingGroup = null;
    return this.row(id);
  }
  select(id) {
    id = id && this.objects()[id] ? id : null;
    this.store.set('scene.selectedReferenceId', id, { label: 'Select reference object', record: false });
  }
  update(object, patch, label) {
    if (object.locked) { this.syncTransform(this.row(object.id)); return false; }
    return this.store.set(['scene', 'referenceObjects', object.id], normalizeReferenceObject({ ...object, ...patch }), { label });
  }
  finishLegacyEdit(cancel) {
    this.legacyPointer = false;
    const edit = this.legacyEdit; this.legacyEdit = null; this.legacyObjectId = null;
    if (cancel) edit?.cancel(); else edit?.commit();
    this.observer?.takeRecords();
  }
  setLegacyTransform(object, field, value, label) {
    if (object.locked) return false;
    if (!this.legacyPointer) return this.update(object, { [field]: value }, label);
    if (!this.legacyEdit?.active) {
      this.legacyObjectId = object.id;
      this.legacyEdit = this.store.beginEdit(['scene', 'referenceObjects', object.id], { label });
    }
    return this.legacyEdit.preview(normalizeReferenceObject({ ...object, [field]: value }));
  }
  installWrappers() {
    this.wrap('sfInitCleanStartupScene', function (original, receiver, args) {
      this.applying = true;
      try { return original.apply(receiver, args); }
      finally { this.applying = false; this.observer?.takeRecords(); this.signature = ''; this.sync(this.store.snapshot()); }
    });
    this.wrap('sfAddSceneObject', function (original, receiver, args) {
      return REFERENCE_TYPES.includes(typeOf(args[0])) ? this.add(args[0], args[1], args[2]) : original.apply(receiver, args);
    });
    for (const name of ['triSelectOut', 'sfClearSceneSelection']) this.wrap(name, function (original, receiver, args) {
      const result = original.apply(receiver, args);
      if (!this.applying) this.select(name === 'triSelectOut' ? this.rowId(args[0]) : null);
      this.syncTransform(name === 'triSelectOut' ? args[0] : null);
      return result;
    });
    this.wrap('sfSyncTransformPanel', function (original, receiver, args) {
      return this.selectedObject(args[0]) ? this.syncTransform(args[0]) : (this.syncTransform(null), original.apply(receiver, args));
    });
    this.wrap('sfSetSelectedTransformFromInputs', function (original, receiver, args) {
      const object = this.selectedObject(); if (!object) return original.apply(receiver, args);
      const position = ['x', 'y', 'z'].map(axis => finite(this.document.getElementById(`tri-pos-${axis}`)?.value));
      const scale = resizedUniformly(object, finite(this.document.getElementById('tri-scale')?.value, uniformSize(object.scale)));
      return this.update(object, { position, scale }, 'Edit reference transform');
    });
    this.wrap('sfGetRowPosition', function (original, receiver, args) {
      const object = this.selectedObject(args[0]); return object ? viewportToLegacyPosition(object.position) : original.apply(receiver, args);
    });
    this.wrap('sfGetRowScale', function (original, receiver, args) {
      const object=this.selectedObject(args[0]);return object ? uniformSize(object.scale) : original.apply(receiver, args);
    });
    this.wrap('sfSetRowPosition', function (original, receiver, args) {
      const object = this.selectedObject(args[0]); if (!object || this.applying) return original.apply(receiver, args);
      if (object.locked) return;
      const position = legacyToViewportPosition(args[1]);
      return this.setLegacyTransform(object, 'position', position, 'Move reference object');
    });
    this.wrap('sfSetRowScale', function (original, receiver, args) {
      const object = this.selectedObject(args[0]);
      return object && !this.applying ? this.setLegacyTransform(object, 'scale', resizedUniformly(object, args[1]), 'Scale reference object') : original.apply(receiver, args);
    });
    this.wrap('sfSetRowRotation', function (original, receiver, args) {
      const object=this.selectedObject(args[0]);if(object && !this.applying) return this.setLegacyTransform(object,'rotation',[...(object.rotation||[0,0,0]).slice(0,2),finite(args[1])],'Rotate reference object');
      return original.apply(receiver, args);
    });
    this.wrap('sfFocusOutlinerRow', function (original, receiver, args) {
      return this.root.SF_VIEWPORT_3D_ACTIVE && this.selectedObject(args[0] || this.selectedRow()) ? this.onFrame() : original.apply(receiver, args);
    });
    this.wrap('sfUpdateSelectedFromInspector', function (original, receiver, args) {
      const object = this.selectedObject(); if (!object || this.applying) return original.apply(receiver, args);
      if (args[0] === 'name') return this.update(object, { name: String(args[1] || '').trim() || object.name }, 'Rename reference object');
      if (args[0] === 'type' && REFERENCE_TYPES.includes(typeOf(args[1]))) return this.update(object, { type: typeOf(args[1]) }, 'Change reference geometry');
      const result = original.apply(receiver, args); this.importRows(); return result;
    });
    this.wrap('sfRenameSelectedObject', function (original, receiver, args) {
      const object = this.selectedObject(args[0] || this.selectedRow()); if (!object) return original.apply(receiver, args);
      if (object.locked) return;
      const name = this.root.prompt?.('Rename object:', object.name);
      return name?.trim() ? this.update(object, { name: name.trim() }, 'Rename reference object') : undefined;
    });
    this.wrap('sfDuplicateSelectedObject', function (original, receiver, args) {
      const object = this.selectedObject(args[0] || this.selectedRow()); if (!object) return original.apply(receiver, args);
      return this.add(object.type, `${object.name} Copy`, { position: viewportToLegacyPosition([object.position[0] + 1, object.position[1] + 1, object.position[2]]),
        rotation: object.rotation || [0,0,0], scale: object.scale, visible: object.visible });
    });
    this.wrap('sfDeleteSelectedObject', function (original, receiver, args) {
      const object = this.selectedObject(args[0] || this.selectedRow()); if (!object) return original.apply(receiver, args);
      if (object.locked || !this.root.confirm?.(`Delete "${object.name}"?`)) return;
      this.store.batch('Delete reference object', draft => {
        delete draft.scene.referenceObjects[object.id];
        if (draft.scene.selectedReferenceId === object.id) draft.scene.selectedReferenceId = null;
      });
    });
    for (const [name, key] of [['sfToggleSelectedVisibility', 'visible'], ['sfToggleSelectedLock', 'locked']]) this.wrap(name, function (original, receiver, args) {
      const object = this.selectedObject();
      return object ? this.store.set(['scene', 'referenceObjects', object.id, key], !object[key], { label: `Toggle reference ${key}` }) : original.apply(receiver, args);
    });
    this.wrap('sfHistoryCapture', function (original, receiver, args) {
      if (!this.applying && this.selectedObject() && /^(Move object|Transform object|Scale object|Rotate object)$/.test(args[0])) return;
      return original.apply(receiver, args);
    });
    for (const [name, method] of [['sfUndo', 'undo'], ['sfRedo', 'redo']]) this.wrap(name, function (original, receiver, args) {
      const change = (method === 'undo' ? this.store.history : this.store.future).at(-1);
      const referenceChange = change?.path?.startsWith('scene.referenceObjects') || (change?.type === 'batch' && !equal(change.before?.scene?.referenceObjects, change.after?.scene?.referenceObjects));
      return this.selectedObject() || referenceChange ? this.store[method]() : original.apply(receiver, args);
    });
    this.wrap('sfCollectOutlinerObjects', function (original, receiver, args) {
      const committed = this.objects(this.store.snapshot({ committed: true }));
      return original.apply(receiver, args).map(value => committed[value.key] ? referenceToLegacy(committed[value.key], value) : value);
    });
    this.wrap('sfRestoreOutlinerObjects', function (original, receiver, args) {
      this.finishNumericEdit(true); this.finishLegacyEdit(true); this.applying = true;
      let result;
      try { result = original.apply(receiver, args); } finally { this.applying = false; }
      if (Array.isArray(args[0])) {
        for (const value of args[0]) { const row=this.row(value.key||value.id);if(row&&value.referenceTransform)row.dataset.sfReferenceTransform=JSON.stringify(value.referenceTransform); }
        this.importRows({ record: false });
      }
      this.observer?.takeRecords(); this.signature = ''; this.sync(this.store.snapshot());
      return result;
    });
  }
  readRow(row) {
    return referenceFromLegacy({ key: row.dataset.sfKey, type: row.children[2]?.textContent, name: row.children[1]?.textContent,
      x: row.dataset.sfX, y: row.dataset.sfY, z: row.dataset.sfZ, rot: row.dataset.sfRot, scale: row.dataset.sfScale, referenceTransform: (()=>{try{return JSON.parse(row.dataset.sfReferenceTransform||'null');}catch{return null;}})(),
      visible: row.querySelector('.tri-eye')?.classList.contains('on') !== false,
      locked: row.querySelector('.tri-lock')?.classList.contains('on') === true });
  }
  importRows(options = {}) {
    if (this.applying || this.disposed) return;
    const objects = {};
    for (const row of this.rows()) { const object = this.readRow(row); if (object) objects[object.id] = object; }
    const selected = this.rows().find(row => row.classList.contains('sel'))?.dataset.sfKey;
    const id = objects[selected] ? selected : null;
    this.mirrorLegacyObjects(options);
    if (equal(objects, this.objects())) {
      if (id !== (this.store.get('scene.selectedReferenceId') || null)) this.select(id);
      return;
    }
    this.store.batch('Edit reference objects from outliner', draft => {
      draft.scene ||= {}; draft.scene.referenceObjects = objects; draft.scene.selectedReferenceId = id;
    }, options);
  }
  mirrorLegacyObjects(options = {}) {
    // Legacy collection upgrades groups as a side effect. Drain those read-time
    // mutations so the observer cannot repeatedly collect its own normalization.
    let collected;
    this.applying = true;
    try { collected = this.call('sfCollectOutlinerObjects'); }
    finally { this.applying = false; this.observer?.takeRecords(); }
    if (!Array.isArray(collected)) return;
    const previous = this.store.get('scene.legacyObjects') || [];
    const legacy = collected.filter(value => !REFERENCE_TYPES.includes(typeOf(value?.type))).map(value => {
      const old = previous.find(record => record.key === value.key);
      return { ...old, ...value, props: { ...old?.props, ...value.props } };
    });
    if (equal(legacy, previous)) return;
    this.legacySignature = JSON.stringify(legacy);
    this.store.set('scene.legacyObjects', legacy, { record: false, transient: options.transient, label: 'Preserve legacy scene objects' });
  }
  syncTransform(row) {
    const object = this.selectedObject(row);
    if (this.note) this.note.hidden = !object;
    if (this.frameButton) this.frameButton.hidden = !object;
    for (const [index, axis] of ['x', 'y', 'z'].entries()) {
      const input = this.document?.getElementById(`tri-pos-${axis}`); if (!input) continue;
      input.step = object ? '0.1' : '10';
      const label = input.parentElement?.querySelector('b'); if (label) label.textContent = axis.toUpperCase() + (object && axis === 'z' ? ' ↑' : '');
      if (object) input.value = object.position[index];
    }
    const rotation = this.document?.getElementById('tri-rot'), scale = this.document?.getElementById('tri-scale');
    if (rotation) { rotation.disabled = Boolean(object); if (object) rotation.value = object.rotation?.[2] || 0; }
    if (scale) { scale.min = object ? '.01' : '.1'; scale.max = object ? '100000' : '5'; if (object) scale.value = uniformSize(object.scale); }
    if(this.transformInspector){
      this.transformInspector.hidden=!object;
      for(const input of this.transformInspector.querySelectorAll('[data-studio-transform]')){
        const values=input.dataset.studioTransform==='rotation' ? object?.rotation||[0,0,0] : Array.isArray(object?.scale)?object.scale:[object?.scale||1,object?.scale||1,object?.scale||1];
        input.disabled=Boolean(object?.locked);
        if(!(this.document.activeElement===input&&this.numericEdit?.active))input.value=values[['x','y','z'].indexOf(input.dataset.axis)];
      }
    }
    const readout = this.document?.getElementById('sf-ins-readout');
    if (object && readout) readout.textContent = `${object.visible ? 'visible' : 'hidden'}, ${object.locked ? 'locked' : 'editable'} · position ${object.position.join(' / ')} m · Z up`;
  }
  sync(state) {
    if (!this.list || this.disposed) return;
    const legacy = Array.isArray(state.scene?.legacyObjects) ? state.scene.legacyObjects : Array.isArray(state.objects) ? state.objects : state.scene?.objects;
    if (Array.isArray(legacy) && JSON.stringify(legacy) !== this.legacySignature) {
      this.legacySignature = JSON.stringify(legacy); this.applying = true;
      try {
        if (Array.isArray(state.groups)) this.root.sfRestoreOutlinerGroups?.(state.groups);
        // Missing reference keys from very old records receive deterministic IDs.
        this.call('sfRestoreOutlinerObjects', legacy.map((object, index) => REFERENCE_TYPES.includes(typeOf(object?.type))
          ? { ...object, key: object.key || object.id || `legacy-ref-${index}` } : object));
      } finally { this.applying = false; this.observer?.takeRecords(); }
      this.signature = '';
    }
    const objects = this.objects(state), selected = state.scene?.selectedReferenceId || null;
    const numericObject = objects[this.numericObjectId];
    if (this.numericEdit?.active && (!numericObject || numericObject.locked || (this.numericStartedVisible && numericObject.visible === false) || selected !== this.numericObjectId)) {
      this.finishNumericEdit(true);
      // Cancellation notifies synchronously. Read the restored state instead of
      // continuing with the stale preview snapshot supplied to this subscriber.
      this.sync(this.store.snapshot()); return;
    }
    const edited = objects[this.legacyObjectId];
    if (this.legacyEdit?.active && (!edited || edited.locked || !edited.visible || selected !== this.legacyObjectId)) {
      this.finishLegacyEdit(true); return;
    }
    const signature = JSON.stringify([objects, selected]);
    if (signature === this.signature) return;
    this.signature = signature; this.applying = true;
    try {
      const hadReferenceSelection = this.rows().some(row => REFERENCE_TYPES.includes(typeOf(row.children[2]?.textContent)) && row.classList.contains('sel'));
      for (const row of this.rows()) {
        if (REFERENCE_TYPES.includes(typeOf(row.children[2]?.textContent)) && !objects[row.dataset.sfKey]) row.remove();
      }
      for (const [id, raw] of Object.entries(objects)) {
        const object = normalizeReferenceObject(raw, id); if (!object) continue;
        let row = this.row(id);
        if (!row) {
          row = this.root.sfCreateOutlinerRow?.(referenceToLegacy(object)); if (!row) continue;
          const group = this.pendingGroup ? this.root.sfFindGroupByKey?.(this.pendingGroup) : this.root.sfCurrentTargetGroup?.(object.type.toUpperCase());
          if (this.root.sfInsertRowIntoGroup) this.root.sfInsertRowIntoGroup(row, group); else this.list.appendChild(row);
        }
        row.dataset.sfReferenceId = id; row.dataset.sfAdded = '1';
        const position = viewportToLegacyPosition(object.position);
        row.dataset.sfX = String(position.x); row.dataset.sfY = String(position.y); row.dataset.sfZ = String(position.z);
        row.dataset.sfScale = String(uniformSize(object.scale)); row.dataset.sfRot = String(object.rotation?.[2]||0); row.dataset.sfReferenceTransform=JSON.stringify(referenceTransform(object));
        if (row.children[1].textContent !== object.name) row.children[1].textContent = object.name;
        row.children[2].textContent = object.type.toUpperCase();
        const eye = row.querySelector('.tri-eye'), lock = row.querySelector('.tri-lock');
        eye?.classList.toggle('on', object.visible); if (eye) eye.textContent = object.visible ? '*' : 'o';
        lock?.classList.toggle('on', object.locked); if (lock) lock.textContent = object.locked ? '*' : 'o';
        row.classList.toggle('hidden-object', !object.visible);
      }
      const selectedRow = this.row(selected);
      if (selectedRow && !selectedRow.classList.contains('sel')) this.call('triSelectOut', selectedRow);
      if (!selectedRow) for (const row of this.rows()) if (this.rowId(row)) row.classList.remove('sel');
      if (!selectedRow && hadReferenceSelection && !this.selectedRow()) this.call('sfClearSceneSelection');
      if (selectedRow) {
        const name = this.document.getElementById('tri-selected-object'), type = this.document.getElementById('tri-selected-type');
        if (name) name.textContent = objects[selected].name;
        if (type) type.textContent = objects[selected].type.toUpperCase();
      }
      this.root.sfRefreshOutlinerCounts?.();
      this.root.sfRefreshAllGroupVisibilityStates?.();
      if (selectedRow) this.root.sfRefreshOutlinerInspector?.(selectedRow);
      this.syncTransform(selectedRow || this.selectedRow());
    } finally { this.applying = false; this.observer?.takeRecords(); }
  }
  dispose() {
    this.finishNumericEdit(true);this.finishLegacyEdit(true); this.disposed = true; this.unsubscribe?.(); this.observer?.disconnect();
    for (const [target, type, fn, capture] of this.listeners) target?.removeEventListener(type, fn, capture);
    for (const [name, { original, wrapped }] of this.originals) if (this.root[name] === wrapped) this.root[name] = original;
    this.note?.remove(); this.frameButton?.remove();this.transformInspector?.remove(); this.originals.clear(); this.listeners = [];
  }
}
