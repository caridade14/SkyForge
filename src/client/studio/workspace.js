import { LightingWorkbench } from './lighting-workbench.js';
const STORAGE_KEY = 'skyforge.studio.layout.v1';
const PRESETS = Object.freeze({
  Sky: { left: 240, right: 292, bottom: 190, editor: 'timeline', inspector: 'sky', bottomCollapsed: true },
  Animation: { left: 230, right: 288, bottom: 290, editor: 'timeline', inspector: 'selection', bottomCollapsed: false },
  Nodes: { left: 220, right: 270, bottom: 340, editor: 'nodes', inspector: 'sky', bottomCollapsed: false }
});
const bounded = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;

// Every Studio command below owns a current Core service. The complete legacy
// menubar is retained with its original DOM/listeners in Legacy workspace.
const MENUS = {
  File: [['new', 'New project'], ['open', 'Open .skyforge…'], ['save', 'Save .skyforge'], ['capture', 'Save preview PNG…']],
  Edit: [['undo', 'Undo'], ['redo', 'Redo'], ['duplicate', 'Duplicate selected reference'], ['delete', 'Delete selected reference']],
  View: [['home', 'Reset camera'], ['projection', 'Perspective / Orthographic'], ['grid', 'Toggle grid'], ['shadows', 'Toggle object Sun shadows'], ['overlays', 'Toggle overlays'], ['left', 'Outliner'], ['right', 'Inspector'], ['bottom', 'Editors'], ['maximize', 'Maximize viewport'], ['reset', 'Reset workspace'], ['legacy', 'Legacy workspace']],
  Sky: [['sky-sun', 'Sun & atmosphere'], ['sky-clouds', 'Clouds'], ['sky-location', 'Location'], ['sky-lighting', 'Lighting bench'], ['physical', 'Use evaluated physical sun'], ['engine', 'Physical engine status']],
  Scene: [['add-sphere', 'Add sphere'], ['add-cube', 'Add cube'], ['add-plane', 'Add plane'], ['lookdev', 'Add lighting reference bench'], ['frame', 'Frame selection']],
  Animation: [['timeline', 'Open timeline'], ['play', 'Play / pause'], ['add-key', 'Insert key for active track'], ['previous-key', 'Previous keyframe'], ['next-key', 'Next keyframe'], ['delete-keys', 'Delete selected keys']],
  Nodes: [['nodes', 'Open node editor'], ['frame-graph', 'Frame graph'], ['from-controls', 'Copy sky controls to graph'], ['direct', 'Use direct controls'], ['graph', 'Use node graph'], ['default-graph', 'Create default graph']],
  Help: [['hub', 'Core Command Center'], ['bridge', 'Blender Bridge'], ['help', 'Navigation & preview guide'], ['legacy', 'Legacy workspace']]
};

export function normalizeStudioLayout(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const preset = Object.hasOwn(PRESETS, value.preset) ? value.preset : 'Sky';
  const defaults = PRESETS[preset];
  return { version: 1, preset,
    left: bounded(value.left, 170, 420, defaults.left),
    right: bounded(value.right, 220, 480, defaults.right),
    bottom: bounded(value.bottom, 150, 620, defaults.bottom),
    editor: ['timeline', 'nodes'].includes(value.editor) ? value.editor : defaults.editor,
    inspector: ['selection', 'sky'].includes(value.inspector) ? value.inspector : defaults.inspector,
    leftCollapsed: value.leftCollapsed === true, rightCollapsed: value.rightCollapsed === true,
    bottomCollapsed: typeof value.bottomCollapsed === 'boolean' ? value.bottomCollapsed : defaults.bottomCollapsed,
    maximized: value.maximized === true };
}
export function studioPreset(name, previous = {}) {
  const preset = Object.hasOwn(PRESETS, name) ? name : 'Sky';
  return normalizeStudioLayout({ ...previous, ...PRESETS[preset], preset, leftCollapsed: false, rightCollapsed: false, maximized: false });
}
export function resizeStudioLayout(layout, edge, delta) {
  const next = normalizeStudioLayout(layout);
  if (edge === 'left') next.left += delta;
  if (edge === 'right') next.right -= delta;
  if (edge === 'bottom') next.bottom -= delta;
  return normalizeStudioLayout(next);
}
export function readStudioLayout(storage) {
  try { return normalizeStudioLayout(JSON.parse(storage?.getItem(STORAGE_KEY) || '{}')); }
  catch { return normalizeStudioLayout(); }
}
export function writeStudioLayout(storage, layout) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(normalizeStudioLayout(layout))); return true; }
  catch { return false; }
}

const ICONS = {
  move: '<path d="M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3m-9-9-3 3 3 3m12-6 3 3-3 3"/>',
  rotate: '<path d="M20 11a8 8 0 1 0-2 7M20 4v7h-7"/>',
  scale: '<path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5M5 5l5 5m4 4 5 5"/>',
  frame: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5"/><circle cx="12" cy="12" r="3"/>',
  save: '<path d="M4 3h14l3 3v15H3V3zm3 0v7h10V3M7 21v-7h10v7"/>',
  open: '<path d="M3 7V4h7l3 3h8v4M3 7v14h16l3-10H6z"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>',
  redo: '<path d="m16 4 5 5-5 5m5-5H11a7 7 0 0 0 0 14"/>',
  capture: '<path d="M3 7h5l2-3h4l2 3h5v14H3z"/><circle cx="12" cy="14" r="4"/>',
  maximize: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  nodes: '<rect x="2" y="3" width="7" height="6" rx="1"/><rect x="15" y="15" width="7" height="6" rx="1"/><path d="M9 6h5v12h1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  timeline: '<path d="M3 5h18M3 12h18M3 19h18m-13-17v20"/><path d="m15 9 3 3-3 3-3-3z"/>',
  cube: '<path d="m12 2 9 5v10l-9 5-9-5V7zm0 10 9-5m-9 5L3 7m9 5v10"/>',
  sphere: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  plane: '<path d="m3 15 10-9 8 4-10 9z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  new: '<path d="M6 2h8l4 4v16H6zm8 0v5h4m-6 4v7m-3-3h6"/>'
};
export function studioIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.panel}</svg>`;
}

/** Reparents existing editors without cloning their controls or service state. */
export class StudioWorkspace {
  constructor(api, { root = globalThis } = {}) {
    Object.assign(this, { api, root, document: root.document, moves: [], listeners: [], legacy: false });
    this.layout = readStudioLayout(root.localStorage);
  }
  on(target, type, handler, capture = false) {
    target?.addEventListener(type, handler, capture); this.listeners.push([target, type, handler, capture]);
  }
  button(action, label, icon, title = label) {
    return `<button type="button" data-studio-action="${action}" title="${title}" aria-label="${title}">${studioIcon(icon)}<span>${label}</span></button>`;
  }
  init() {
    const doc = this.document;
    this.grid = doc?.querySelector('.workspace'); this.center = doc?.getElementById('vp')?.closest('.center-col');
    if (!this.grid || !this.center || doc.getElementById('sf-studio-toolbar')) return this;
    this.originalTitle = doc.title; doc.title = 'SkyForge Studio — WebGL Sky and Scene Editor';
    this.sidebar = this.grid.querySelector('.sidebar'); this.rpanel = this.grid.querySelector('.rpanel');
    this.outliner = doc.querySelector('.sf-outliner');
    this.builder = doc.getElementById('sf-new-type')?.closest('.sf-outliner-panel');
    this.css = doc.createElement('link'); this.css.rel = 'stylesheet';
    this.css.href = new URL('./studio.css', import.meta.url).href; doc.head.append(this.css);
    this.toolbar = doc.createElement('div'); this.toolbar.id = 'sf-studio-toolbar'; this.toolbar.className = 'sf-studio-toolbar';
    this.toolbar.setAttribute('role', 'toolbar'); this.toolbar.setAttribute('aria-label', 'SkyForge Studio workspace');
    this.toolbar.innerHTML = `<strong>STUDIO</strong><div class="sf-studio-presets" aria-label="Workspace layout">${['Sky', 'Animation', 'Nodes'].map(name => `<button type="button" data-studio-preset="${name}">${name}</button>`).join('')}</div><div class="sf-studio-file">${this.button('new', 'New', 'new')}${this.button('open', 'Open', 'open')}${this.button('save', 'Save', 'save')}${this.button('undo', 'Undo', 'undo')}${this.button('redo', 'Redo', 'redo')}</div><div class="sf-studio-tools">${this.button('move', 'Move', 'move', 'Move references (G)')}${this.button('rotate', 'Rotate', 'rotate', 'Rotate references (R)')}${this.button('scale', 'Scale', 'scale', 'Scale references (S)')}<label class="sf-studio-space">Axes<select data-studio-space aria-label="Transform orientation"><option value="global">Global</option><option value="local">Local</option></select></label>${this.button('frame', 'Frame', 'frame', 'Frame selected (F)')}</div><div class="sf-studio-view-actions">${this.button('capture', 'Preview PNG', 'capture', 'Save a PNG image of the WebGL preview')}${this.button('left', 'Outliner', 'panel')}${this.button('right', 'Inspector', 'panel')}${this.button('bottom', 'Editors', 'timeline')}${this.button('maximize', 'Maximize', 'maximize', 'Maximize viewport (Shift Space)')}${this.button('hub', 'Core', 'nodes', 'Open Core Command Center')}${this.button('legacy', 'Legacy workspace', 'panel', 'Restore the original workspace and all legacy tools')}</div>`;
    this.grid.before(this.toolbar);
    this.statusbar = doc.querySelector('.statusbar');
    if (this.statusbar) {
      this.legacyStatus = doc.createElement('div'); this.legacyStatus.className = 'sf-studio-legacy-status'; this.legacyStatus.hidden = true;
      this.statusChildren = [...this.statusbar.children]; this.legacyStatus.append(...this.statusChildren);
      this.studioStatus = doc.createElement('div'); this.studioStatus.className = 'sf-studio-status'; this.studioStatus.setAttribute('role', 'status');
      this.statusbar.append(this.legacyStatus, this.studioStatus);
    }
    this.left = doc.createElement('aside'); this.left.className = 'sf-studio-left'; this.left.setAttribute('aria-label', 'Scene outliner');
    this.left.innerHTML = '<header class="sf-studio-panel-heading">Scene Outliner</header><div class="sf-studio-outliner"></div><div class="sf-studio-add" aria-label="Add reference geometry"></div><div class="sf-studio-builder"></div>';
    this.left.querySelector('.sf-studio-add').innerHTML = ['sphere', 'cube', 'plane'].map(type => this.button(`add-${type}`, type[0].toUpperCase() + type.slice(1), type)).join('');
    this.right = doc.createElement('aside'); this.right.className = 'sf-studio-right'; this.right.setAttribute('aria-label', 'Contextual inspector');
    this.right.innerHTML = '<header class="sf-studio-panel-heading"><button type="button" data-studio-inspector="selection">Selection</button><button type="button" data-studio-inspector="sky">Sky</button></header><div class="sf-studio-selection"></div><div class="sf-studio-sky"><div class="sf-studio-sky-controls"><label>Preview exposure ×<input id="sf-studio-exposure" type="number" min="0.01" max="32" step="0.1" aria-label="Preview exposure multiplier" title="Display preview exposure multiplier. Escape cancels the edit."></label></div></div>';
    this.exposure = this.right.querySelector('#sf-studio-exposure');
    this.bottom = doc.createElement('section'); this.bottom.className = 'sf-studio-bottom'; this.bottom.setAttribute('aria-label', 'Timeline and node editors');
    this.bottom.innerHTML = `<header class="sf-studio-panel-heading"><button type="button" data-studio-editor-tab="timeline">${studioIcon('timeline')}Timeline</button><button type="button" data-studio-editor-tab="nodes">${studioIcon('nodes')}Nodes</button><span class="sf-studio-bottom-hint">Shared project state</span></header><div class="sf-studio-editor" data-studio-editor="timeline"></div><div class="sf-studio-editor" data-studio-editor="nodes"></div>`;
    this.editors = { timeline: this.bottom.querySelector('[data-studio-editor="timeline"]'), nodes: this.bottom.querySelector('[data-studio-editor="nodes"]') };
    this.handles = ['left', 'right', 'bottom'].map(edge => {
      const handle = doc.createElement('div'); handle.className = `sf-studio-resize sf-studio-resize-${edge}`; handle.dataset.studioResize = edge;
      handle.tabIndex = 0; handle.setAttribute('role', 'separator'); handle.setAttribute('aria-label', `Resize ${edge} panel`);
      handle.setAttribute('aria-orientation', edge === 'bottom' ? 'horizontal' : 'vertical'); return handle;
    });
    this.grid.append(this.left, this.right, this.bottom, ...this.handles);
    this.move(this.outliner, this.left.querySelector('.sf-studio-outliner'));
    this.move(this.builder, this.left.querySelector('.sf-studio-builder'));
    this.move(this.rpanel, this.right.querySelector('.sf-studio-selection'));
    this.move(this.sidebar, this.right.querySelector('.sf-studio-sky'));
    this.initMenus(); this.initSkyControls(); this.lightingBench = new LightingWorkbench(this.api, this).init();
    this.outlinerNew = this.outliner?.querySelector('[onclick="sfCreateSceneObject()"]');
    this.outlinerNewTitle = this.outlinerNew?.title;
    this.on(this.root, 'click', event => {
      if (this.legacy || !this.outlinerNew || !this.outlinerNew.contains(event.target)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      this.menus?.querySelector('[data-studio-menu="Scene"]')?.click();
    }, true);
    this.on(this.toolbar, 'click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.dataset.studioPreset) this.setLayout(studioPreset(button.dataset.studioPreset, this.layout));
      else this.action(button.dataset.studioAction);
    });
    this.on(this.toolbar.querySelector('[data-studio-space]'), 'change', event => this.api.store.set('viewport.transformSpace', event.target.value, { label: 'Set transform orientation', record: false }));
    this.on(this.left, 'click', event => {
      if (event.target.closest('.tri-out-extra,.tri-out-group')) this.setLayout({ ...this.layout, inspector: 'selection', rightCollapsed: false });
      this.action(event.target.closest('[data-studio-action]')?.dataset.studioAction);
    });
    this.on(this.right, 'click', event => { const tab = event.target.closest('[data-studio-inspector]'); if (tab) this.setLayout({ ...this.layout, inspector: tab.dataset.studioInspector }); });
    this.on(this.exposure, 'focus', () => { this.exposureEdit = this.api.store.beginEdit('camera.exposure', { label: 'Edit preview exposure' }); });
    this.on(this.exposure, 'input', () => {
      if (this.exposure.value === '' || !Number.isFinite(Number(this.exposure.value))) return;
      if (!this.exposureEdit?.active) this.exposureEdit = this.api.store.beginEdit('camera.exposure', { label: 'Edit preview exposure' });
      this.exposureEdit.preview(bounded(this.exposure.value, .01, 32, 1));
    });
    this.on(this.exposure, 'change', () => this.finishExposure(this.exposure.value === '' || !Number.isFinite(Number(this.exposure.value))));
    this.on(this.exposure, 'blur', () => this.finishExposure(this.exposure.value === '' || !Number.isFinite(Number(this.exposure.value))));
    this.on(this.bottom, 'click', event => { const tab = event.target.closest('[data-studio-editor-tab]'); if (tab) this.setLayout({ ...this.layout, editor: tab.dataset.studioEditorTab, bottomCollapsed: false }); });
    for (const handle of this.handles) {
      this.on(handle, 'pointerdown', event => this.startResize(event, handle));
      this.on(handle, 'keydown', event => {
        const edge = handle.dataset.studioResize, horizontal = edge !== 'bottom';
        const delta = horizontal ? ({ ArrowLeft: -16, ArrowRight: 16 }[event.key]) : ({ ArrowUp: -16, ArrowDown: 16 }[event.key]);
        if (delta !== undefined) { event.preventDefault(); this.setLayout(resizeStudioLayout(this.layout, edge, delta)); }
      });
    }
    this.on(this.root, 'pointermove', event => this.resize(event), true);
    this.on(this.root, 'pointerup', event => { if (this.drag?.id === event.pointerId) this.finishResize(false); }, true);
    this.on(this.root, 'pointercancel', () => this.finishResize(true), true);
    this.on(this.root, 'blur', () => { this.finishResize(true); this.finishExposure(true); });
    this.on(doc, 'visibilitychange', () => { if (doc.hidden) this.finishExposure(true); this.sync(this.api.store.snapshot()); });
    this.on(this.api.viewport?.canvas, 'webglcontextlost', () => this.sync(this.api.store.snapshot()));
    this.on(this.api.viewport?.canvas, 'webglcontextrestored', () => this.sync(this.api.store.snapshot()));
    this.on(this.root, 'keydown', event => this.keydown(event), true);
    this.on(this.root, 'skyforge:reset-workspace', () => this.resetLayout());
    // Restoring a project must keep the inspector tab saved with the layout;
    // subsequent selection changes reveal the contextual selection inspector.
    this.selection = this.api.store.get('scene.selectedReferenceId');
    this.unsubscribe = this.api.store.subscribe(state => this.sync(state));
    this.sync(this.api.store.snapshot()); this.applyLayout();
    return this;
  }
  move(node, destination) {
    if (!node || !destination) return;
    const marker = this.document.createComment('SkyForge Studio original location'); node.before(marker);
    this.moves.push({ node, destination, marker }); destination.append(node);
  }
  initMenus() {
    const menubar = this.document.querySelector('.menubar'); if (!menubar) return;
    this.menus = this.document.createElement('nav'); this.menus.id = 'sf-studio-menus'; this.menus.setAttribute('aria-label', 'Studio menus');
    this.menus.innerHTML = Object.entries(MENUS).map(([name, commands]) => `<div class="sf-studio-menu"><button type="button" data-studio-menu="${name}" aria-haspopup="menu" aria-expanded="false">${name}</button><div class="sf-studio-dropdown" role="menu" aria-label="${name}" hidden>${commands.map(([action, label]) => `<button type="button" role="menuitem" data-studio-command="${action}">${label}</button>`).join('')}</div></div>`).join('');
    menubar.querySelector('.mb-menus')?.before(this.menus);
    this.on(this.menus, 'click', event => {
      const trigger = event.target.closest('[data-studio-menu]'), command = event.target.closest('[data-studio-command]');
      if (trigger) {
        const open = trigger.getAttribute('aria-expanded') === 'true'; this.closeMenus();
        if (!open) { trigger.setAttribute('aria-expanded', 'true'); trigger.nextElementSibling.hidden = false; }
      }
      if (command) { this.closeMenus(); this.action(command.dataset.studioCommand); }
    });
    this.on(this.menus, 'keydown', event => {
      const menu = event.target.closest('.sf-studio-menu'); if (!menu) return;
      const trigger = menu.querySelector('[data-studio-menu]'), items = [...menu.querySelectorAll('[role=menuitem]:not(:disabled)')];
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeMenus(); trigger.focus(); }
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && items.length) {
        event.preventDefault(); trigger.setAttribute('aria-expanded', 'true'); trigger.nextElementSibling.hidden = false;
        const index = items.indexOf(this.document.activeElement), delta = event.key === 'ArrowDown' ? 1 : -1;
        items[(index < 0 ? delta > 0 ? 0 : items.length - 1 : (index + delta + items.length) % items.length)].focus();
      }
    });
    this.on(this.document, 'pointerdown', event => { if (!this.menus.contains(event.target)) this.closeMenus(); });
    this.on(this.root, 'blur', () => this.closeMenus());
  }
  closeMenus() {
    for (const trigger of this.menus?.querySelectorAll('[data-studio-menu]') || []) { trigger.setAttribute('aria-expanded', 'false'); trigger.nextElementSibling.hidden = true; }
  }
  initSkyControls() {
    if (!this.sidebar) return;
    this.skyNav = this.document.createElement('nav'); this.skyNav.className = 'sf-studio-sky-nav'; this.skyNav.setAttribute('aria-label', 'Sky inspector sections');
    this.skyNav.innerHTML = [['sun', 'Sun / Atmosphere'], ['clouds', 'Clouds'], ['location', 'Location'], ['lighting', 'Lighting']].map(([name, label]) => `<button type="button" data-studio-sky="${name}">${label}</button>`).join('');
    this.sidebar.before(this.skyNav);
    this.on(this.skyNav, 'click', event => { const tab = event.target.closest('[data-studio-sky]'); if (tab) this.showSky(tab.dataset.studioSky); });
    // Unsupported legacy rigs stay available in their workspace; the Studio
    // inspector exposes only parameters consumed by its current GPU shaders.
    for (const id of ['sec-sun', 'sec-clouds']) {
      const section = this.document.getElementById(id); if (!section) continue;
      for (const row of section.querySelectorAll('.s-btn-row,.s-pills')) row.dataset.studioLegacy = 'true';
      for (const row of section.querySelectorAll('.s-row')) if (['Model', 'Type'].includes(row.querySelector('.s-lbl')?.textContent.trim())) row.dataset.studioLegacy = 'true';
    }
    for (const id of ['v-turbu', 'v-steps', 'v-ray', 'v-albedo']) this.document.getElementById(id)?.closest('.sl-wrap')?.setAttribute('data-studio-legacy', 'true');
    const atmosphere = this.document.querySelector('#sec-sun .s-body-inner');
    if (atmosphere) {
      this.atmosphereTools = this.document.createElement('div'); this.atmosphereTools.className = 'sf-studio-atmosphere-controls';
      this.atmosphereTools.innerHTML = [['Rayleigh', 0, 100], ['Mie anisotropy', 0, 95]].map(([name, min, max]) => `<div class="sl-wrap"><div class="sl-top"><span class="sl-name">${name}</span><span class="sl-val"></span></div><input type="range" class="sl" min="${min}" max="${max}" step="1" aria-label="${name}"></div>`).join('') + '<p class="sf-studio-preview-note">Sun direction, atmospheric extinction and sky fill share the same scene state. The sky uses a compatible physical LUT when available, otherwise a scattering approximation.</p>';
      atmosphere.append(this.atmosphereTools); this.api.ui?.bindControls(this.atmosphereTools);
      this.sunPresets = this.document.createElement('div'); this.sunPresets.className = 'sf-studio-cloud-presets';
      this.sunPresets.innerHTML = ['Noon', 'Golden', 'Sunset', 'Blue hour', 'Night'].map(name => `<button type="button" data-studio-sun-preset="${name}">${name}</button>`).join('');
      atmosphere.prepend(this.sunPresets);
      this.on(this.sunPresets, 'click', event => {
        const name = event.target.closest('[data-studio-sun-preset]')?.dataset.studioSunPreset;
        const presets = { Noon: { elevation: 60, intensity: 1.8, temperature: 6500 }, Golden: { elevation: 7, intensity: 1.8, temperature: 5200 }, Sunset: { elevation: 2, intensity: 1.5, temperature: 5800 }, 'Blue hour': { elevation: -4, intensity: 1, temperature: 6500 }, Night: { elevation: -18, intensity: 1, temperature: 6500 } };
        if (presets[name]) this.api.store.batch(`Sun preset ${name}`, draft => Object.assign(draft.sun, presets[name]));
      });
    }
    const clouds = this.document.querySelector('#sec-clouds .s-body-inner');
    if (clouds) {
      this.cloudTools = this.document.createElement('div'); this.cloudTools.className = 'sf-studio-cloud-controls';
      this.cloudTools.innerHTML = `<label class="sf-studio-cloud-type">Cloud shape<select aria-label="Cloud shape" data-studio-cloud-type>${['Cumulus', 'Stratus', 'Cirrus', 'Cumulonimbus', 'Altostratus'].map(type => `<option>${type}</option>`).join('')}</select></label>${['Erosion', 'Detail'].map(name => `<div class="sl-wrap"><div class="sl-top"><span class="sl-name">${name}</span><span class="sl-val"></span></div><input type="range" class="sl" min="0" max="100" step="1" aria-label="Cloud ${name.toLowerCase()}"></div>`).join('')}<div class="sf-studio-cloud-presets">${['Clear', 'Cumulus', 'Overcast', 'Storm'].map(name => `<button type="button" data-cloud-preset="${name}">${name}</button>`).join('')}</div><p class="sf-studio-preview-note">GPU display preview. Quality sets the sample and pixel budget. Wind is in km/h. Professional HDR / EXR export is still pending.</p>`;
      clouds.append(this.cloudTools); this.cloudType = this.cloudTools.querySelector('[data-studio-cloud-type]');
      this.on(this.cloudType, 'change', event => this.api.store.set('clouds.type', event.target.value, { label: 'Change cloud shape' }));
      this.on(this.cloudTools, 'click', event => {
        const name = event.target.closest('[data-cloud-preset]')?.dataset.cloudPreset;
        const presets = { Clear: { coverage: 0 }, Cumulus: { type: 'Cumulus', coverage: .62, density: .7, erosion: .45, detail: .6 }, Overcast: { type: 'Stratus', coverage: .96, density: .85, erosion: .15, detail: .35 }, Storm: { type: 'Cumulonimbus', coverage: .9, density: .95, thickness: 2500, erosion: .3, detail: .7 } };
        if (presets[name]) this.api.store.batch(`Cloud preset ${name}`, draft => Object.assign(draft.clouds, presets[name]));
      });
      this.api.ui?.bindControls(this.cloudTools);
    }
    this.showSky('sun', false);
  }
  showSky(name = 'sun', reveal = true) {
    const id = { sun: 'sec-sun', clouds: 'sec-clouds', location: 'sec-scene-location', lighting: 'sec-sf-lighting' }[name] || 'sec-sun';
    for (const section of this.sidebar?.querySelectorAll('.s-sec') || []) section.classList.toggle('sf-studio-sky-section', section.id === id);
    this.document.getElementById(id)?.classList.remove('closed');
    for (const tab of this.skyNav?.querySelectorAll('button') || []) tab.setAttribute('aria-pressed', String(tab.dataset.studioSky === name));
    if (reveal) { if (this.legacy) this.setLegacy(false); this.setLayout({ ...this.layout, inspector: 'sky', rightCollapsed: false, maximized: false }); }
    const scroll = this.sidebar?.querySelector('.s-body'); if (scroll) scroll.scrollTop = 0;
  }
  showEditor(name) {
    if (this.legacy) this.setLegacy(false);
    this.setLayout({ ...this.layout, editor: name, bottomCollapsed: false, maximized: false });
  }
  resetLayout() {
    if (this.legacy) this.setLegacy(false);
    this.document.body.classList.remove('sf-hide-left', 'sf-hide-right', 'sf-hide-timeline', 'sf-hide-status');
    this.setLayout(studioPreset('Sky')); this.showSky('sun', false);
  }
  setLegacy(legacy) {
    this.closeMenus();
    this.finishResize(true); this.finishExposure(true); this.legacy = legacy;
    for (const { node, destination, marker } of this.moves) legacy ? marker.after(node) : destination.append(node);
    this.document.body.classList.toggle('sf-studio-legacy-layout', legacy);
    if (this.legacyStatus) { this.legacyStatus.hidden = !legacy; this.studioStatus.hidden = legacy; }
    this.toolbar.querySelector('[data-studio-action="legacy"] span').textContent = legacy ? 'Studio workspace' : 'Legacy workspace';
    this.applyLayout();
  }
  setLayout(layout) { this.layout = normalizeStudioLayout(layout); writeStudioLayout(this.root.localStorage, this.layout); this.applyLayout(); }
  applyLayout() {
    if (!this.grid) return;
    const { layout } = this;
    this.document.body.classList.add('sf-studio-enabled');
    if (this.outlinerNew) this.outlinerNew.title = this.legacy ? this.outlinerNewTitle : 'Add reference geometry (Scene menu)';
    this.grid.classList.toggle('sf-studio-grid', !this.legacy);
    this.center.classList.toggle('sf-studio-center', !this.legacy);
    this.grid.classList.toggle('sf-studio-maximized', layout.maximized && !this.legacy);
    this.grid.style.setProperty('--studio-left', `${layout.leftCollapsed ? 0 : layout.left}px`);
    this.grid.style.setProperty('--studio-right', `${layout.rightCollapsed ? 0 : layout.right}px`);
    this.grid.style.setProperty('--studio-bottom', `${layout.bottomCollapsed ? 0 : layout.bottom}px`);
    this.left.hidden = this.legacy || layout.leftCollapsed || layout.maximized;
    this.right.hidden = this.legacy || layout.rightCollapsed || layout.maximized;
    this.bottom.hidden = this.legacy || layout.bottomCollapsed || layout.maximized;
    this.handles.forEach(handle => {
      const edge = handle.dataset.studioResize; handle.hidden = this.legacy || layout.maximized || layout[`${edge}Collapsed`];
      handle.setAttribute('aria-valuenow', String(Math.round(layout[edge])));
    });
    for (const button of this.toolbar.querySelectorAll('[data-studio-preset]')) button.setAttribute('aria-pressed', String(button.dataset.studioPreset === layout.preset));
    for (const key of ['left', 'right', 'bottom']) this.toolbar.querySelector(`[data-studio-action="${key}"]`).setAttribute('aria-pressed', String(!layout[`${key}Collapsed`]));
    this.toolbar.querySelector('[data-studio-action="maximize"]').setAttribute('aria-pressed', String(layout.maximized));
    for (const [key, mount] of Object.entries(this.editors)) mount.hidden = layout.editor !== key;
    for (const button of this.bottom.querySelectorAll('[data-studio-editor-tab]')) button.setAttribute('aria-selected', String(button.dataset.studioEditorTab === layout.editor));
    this.right.querySelector('.sf-studio-selection').hidden = layout.inspector !== 'selection';
    this.right.querySelector('.sf-studio-sky').hidden = layout.inspector !== 'sky';
    for (const button of this.right.querySelectorAll('[data-studio-inspector]')) button.setAttribute('aria-selected', String(button.dataset.studioInspector === layout.inspector));
    this.api.viewport?.invalidate();
    this.root.dispatchEvent?.(new this.root.Event('resize'));
  }
  sync(state) {
    if (!this.toolbar) return;
    const tool = state.viewport?.transformTool || 'move';
    for (const name of ['move', 'rotate', 'scale']) this.toolbar.querySelector(`[data-studio-action="${name}"]`).setAttribute('aria-pressed', String(tool === name));
    const orientation = this.toolbar.querySelector('[data-studio-space]');
    orientation.value = state.viewport?.transformSpace === 'local' ? 'local' : 'global';
    orientation.disabled = tool === 'scale';
    orientation.title = tool === 'scale' ? 'Scale edits the object local dimensions' : 'Choose global axes or the object local axes';
    this.toolbar.querySelector('[data-studio-action="frame"]').disabled = !state.scene?.referenceObjects?.[state.scene?.selectedReferenceId];
    const selected = state.scene?.referenceObjects?.[state.scene?.selectedReferenceId];
    for (const name of ['undo', 'redo']) this.toolbar.querySelector(`[data-studio-action="${name}"]`).disabled = !this.api.store[name === 'undo' ? 'canUndo' : 'canRedo']();
    this.toolbar.querySelector('[data-studio-action="capture"]').disabled = !this.api.viewport?.active || this.document.hidden || typeof this.api.viewport.capturePreview !== 'function';
    const id = state.scene?.selectedReferenceId;
    if (id !== this.selection && id) this.setLayout({ ...this.layout, inspector: 'selection', rightCollapsed: false });
    this.selection = id;
    if (this.cloudType) this.cloudType.value = state.clouds?.type || 'Cumulus';
    for (const button of this.menus?.querySelectorAll('[data-studio-command]') || []) {
      const action = button.dataset.studioCommand;
      button.disabled = action === 'undo' ? !this.api.store.canUndo() : action === 'redo' ? !this.api.store.canRedo() : ['frame', 'duplicate', 'delete'].includes(action) ? !selected || (action !== 'frame' && selected.locked) : action === 'capture' ? !this.api.viewport?.active : false;
    }
    if (!this.exposureEdit?.active) { this.exposureEdit = null; this.exposure.value = String(state.camera?.exposure ?? 1); }
    if (this.studioStatus) {
      const viewport = this.api.viewport, frame = state.timeline?.currentFrame ?? 1, end = state.timeline?.endFrame ?? 240;
      const cloud = viewport?.renderer?.cloudMetrics, quality = state.viewport?.cloudQuality || cloud?.quality || 'low';
      const volume = state.viewport?.cloudMode === 'volumetric' && !viewport?.renderer?.cloudFallbackReason;
      this.studioStatus.textContent = `${viewport?.active ? 'WebGL display preview' : 'Legacy View'} · ${volume ? `GPU cloud preview · ${quality}` : 'Cloud layer preview'} · Frame ${Math.round(frame)} / ${Math.round(end)} · ${state.timeline?.fps || 24} fps timeline · ${state.timeline?.playing ? 'Playing' : 'Render on demand'} · ${state.project?.modified ? 'Modified' : 'Saved'}`;
    }
  }
  action(action) {
    try { return this.performAction(action); }
    catch (error) { this.reportError(error); }
  }
  reportError(error) {
    const message = error?.message || 'Operation failed';
    if (this.studioStatus) this.studioStatus.textContent = message;
    this.api.ui?.toast(message, 'error');
  }
  performAction(action) {
    if (!action) return;
    if (['left', 'right', 'bottom'].includes(action)) return this.setLayout({ ...this.layout, maximized: false, [`${action}Collapsed`]: !this.layout[`${action}Collapsed`] });
    if (action === 'maximize') return this.setLayout({ ...this.layout, maximized: !this.layout.maximized });
    if (action === 'legacy') return this.setLegacy(!this.legacy);
    if (['move', 'rotate', 'scale'].includes(action)) {
      this.api.store.set('viewport.transformTool', action, { label: 'Set transform tool', record: false }); this.api.viewport?.canvas?.focus({ preventScroll: true }); return;
    }
    if (['add-sphere', 'add-cube', 'add-plane'].includes(action)) { this.api.viewport?.objectAdapter?.add(action.slice(4)); return; }
    if (action === 'frame') return this.api.viewport?.referenceGizmo?.frameSelected();
    if (action === 'capture') return Promise.resolve().then(() => this.api.viewport?.capturePreview?.()).catch(error => {
      if (this.studioStatus) this.studioStatus.textContent = `Preview PNG: ${error.message || 'Capture unavailable'}`;
      return null;
    });
    if (action === 'lookdev') return this.lightingBench.addBench();
    if (action === 'shadows') return this.api.store.set('viewport.objectShadows', this.api.store.get('viewport.objectShadows') === false, { label: 'Toggle object Sun shadows' });
    if (action === 'hub') return this.api.openHub?.('project');
    if (action === 'bridge' || action === 'engine') return this.api.openHub?.(action);
    if (action === 'reset') return this.resetLayout();
    if (action.startsWith('sky-')) return this.showSky(action.slice(4));
    if (action === 'timeline' || action === 'nodes') return this.showEditor(action);
    if (['home', 'projection', 'grid', 'overlays'].includes(action)) return this.api.viewport?.action(action);
    if (action === 'physical') return this.api.viewport?.action('sun');
    if (['duplicate', 'delete'].includes(action)) {
      const id = this.api.store.get('scene.selectedReferenceId'), object = this.api.store.get(['scene', 'referenceObjects', id]);
      if (!object || object.locked) return;
      return action === 'duplicate' ? this.root.sfDuplicateSelectedObject?.() : this.root.sfDeleteSelectedObject?.();
    }
    if (action === 'play') { this.showEditor('timeline'); return this.api.timeline.toggle(); }
    if (action === 'add-key') { this.showEditor('timeline'); return this.api.timeline.addKeyframe(this.api.timelinePanel.activePath); }
    if (action === 'delete-keys') { this.showEditor('timeline'); return this.api.timelinePanel.deleteSelection(); }
    if (['previous-key', 'next-key'].includes(action)) {
      this.showEditor('timeline'); this.api.timeline.pause();
      const frames = [...new Set(Object.values(this.api.timeline.serializeKeyframes()).flat().map(key => key.frame))].sort((a, b) => a - b), current = this.api.timeline.currentFrame;
      const frame = action === 'next-key' ? frames.find(frame => frame > current) : frames.filter(frame => frame < current).at(-1);
      if (frame !== undefined) this.api.timeline.seek(frame);
      return;
    }
    if (action === 'frame-graph') { this.showEditor('nodes'); return this.api.nodePanel.frameGraph(); }
    if (action === 'from-controls') { this.showEditor('nodes'); return this.api.composition.copySceneToGraph(); }
    if (action === 'direct' || action === 'graph') { this.showEditor('nodes'); return this.api.composition.setAuthority(action); }
    if (action === 'default-graph') { this.showEditor('nodes'); return this.api.ui.action('graph'); }
    if (action === 'help') {
      if (!this.helpDialog) {
        this.helpDialog = this.document.createElement('dialog'); this.helpDialog.className = 'sf-studio-guide';
        this.helpDialog.innerHTML = '<h2>SkyForge Studio</h2><p>Orbit: middle mouse or Alt + left drag. Pan: Shift with orbit. Dolly: Ctrl with orbit or mouse wheel. Home resets the camera; F frames the selected reference.</p><p>G / R / S: move, rotate, scale. Drag the Sun marker to change its direction. Escape cancels an edit. Ctrl / Cmd Z undoes; Ctrl / Cmd Shift Z redoes. Space plays the timeline; Shift Space maximizes the viewport.</p><p>The viewport shows a bounded GPU approximation. A compatible physical LUT is used when available. PNG is a display image; this preview does not provide a calibrated HDR / EXR renderer or an OpenColorIO pipeline.</p><p>Legacy workspace retains the original scene tools and menus.</p><form method="dialog"><button>Close</button></form>';
        this.document.body.append(this.helpDialog);
      }
      return this.helpDialog.showModal();
    }
    if (action === 'new') return this.api.newProject?.();
    if (action === 'open') return Promise.resolve(this.api.open?.()).catch(error => this.reportError(error));
    if (['save', 'undo', 'redo'].includes(action)) return this.api[action]?.();
  }
  startResize(event, handle) {
    if (event.button !== 0 || this.drag) return;
    event.preventDefault(); event.stopPropagation();
    this.drag = { edge: handle.dataset.studioResize, id: event.pointerId, x: event.clientX, y: event.clientY, before: { ...this.layout }, handle };
    handle.setPointerCapture?.(event.pointerId); this.document.body.classList.add('sf-studio-resizing');
  }
  resize(event) {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const delta = this.drag.edge === 'bottom' ? event.clientY - this.drag.y : event.clientX - this.drag.x;
    this.layout = resizeStudioLayout(this.drag.before, this.drag.edge, delta); this.applyLayout();
  }
  finishResize(cancel) {
    if (!this.drag) return;
    const drag = this.drag; this.drag = null;
    if (cancel) this.layout = drag.before; else writeStudioLayout(this.root.localStorage, this.layout);
    if (drag.handle.hasPointerCapture?.(drag.id)) drag.handle.releasePointerCapture(drag.id);
    this.document.body.classList.remove('sf-studio-resizing'); this.applyLayout();
  }
  finishExposure(cancel) {
    const edit = this.exposureEdit; this.exposureEdit = null;
    if (cancel) edit?.cancel(); else edit?.commit();
    if (this.exposure) this.exposure.value = String(this.api.store.get('camera.exposure') ?? 1);
  }
  keydown(event) {
    if (event.key === 'Escape') this.closeMenus();
    if (event.key === 'Escape' && this.drag) { event.preventDefault(); event.stopImmediatePropagation(); this.finishResize(true); return; }
    if (event.key === 'Escape' && event.target === this.exposure) { event.preventDefault(); event.stopImmediatePropagation(); this.finishExposure(true); this.exposure.blur(); return; }
    if (event.target?.closest?.('input,select,textarea,[contenteditable="true"]')) return;
    // Own project/history shortcuts before document-level legacy listeners.
    // Inputs retain native text undo; one shortcut produces one Core action.
    if (!this.legacy && (event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase(), action = { n: 'new', o: 'open', s: 'save', z: event.shiftKey ? 'redo' : 'undo', y: 'redo' }[key];
      if (action) { event.preventDefault(); event.stopImmediatePropagation(); this.action(action); return; }
    }
    if (event.code === 'Space' && event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault(); event.stopImmediatePropagation(); this.action('maximize');
    }
  }
  dispose() {
    this.finishResize(true); this.finishExposure(true); this.lightingBench?.dispose(); this.unsubscribe?.();
    for (const [target, type, listener, capture] of this.listeners) target?.removeEventListener(type, listener, capture);
    for (const { node, marker } of this.moves) { marker.after(node); marker.remove(); }
    if (this.statusbar) { this.statusbar.append(...this.statusChildren); this.legacyStatus.remove(); this.studioStatus.remove(); }
    this.moves = []; this.listeners = [];
    this.document?.body.classList.remove('sf-studio-enabled', 'sf-studio-legacy-layout', 'sf-studio-resizing');
    if (this.originalTitle !== undefined) this.document.title = this.originalTitle;
    this.grid?.classList.remove('sf-studio-grid', 'sf-studio-maximized'); this.center?.classList.remove('sf-studio-center');
    for (const node of [this.toolbar, this.left, this.right, this.bottom, this.css, this.menus, this.skyNav, this.cloudTools, this.atmosphereTools, this.sunPresets, this.helpDialog, ...(this.handles || [])]) node?.remove();
    for (const row of this.sidebar?.querySelectorAll('[data-studio-legacy]') || []) delete row.dataset.studioLegacy;
    for (const section of this.sidebar?.querySelectorAll('.sf-studio-sky-section') || []) section.classList.remove('sf-studio-sky-section');
    if (this.outlinerNew) this.outlinerNew.title = this.outlinerNewTitle;
  }
}
