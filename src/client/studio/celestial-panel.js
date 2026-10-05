import { normalizeCelestial } from '../core/celestial-state.js';
import { moonIlluminatedFraction, moonDiameterPixels } from '../viewport/celestial-effects.js';
import { frameSky } from '../viewport/camera.js';

const FIELDS={
  stars:[['count','Count',0,12000,100],['brightness','Brightness',0,8,.1],['rotation','Rotation °',-360,360,1],['seed','Seed',0,2147483647,1]],
  moon:[['azimuth','Azimuth °',0,360,.1],['elevation','Elevation °',-90,90,.1],['angularDiameter','Angular diameter °',.1,5,.01],['phase','Phase cycle',0,1,.01],['brightness','Brightness',0,8,.1],['earthshine','Earthshine',0,.1,.001]],
  aurora:[['intensity','Intensity',0,8,.1],['azimuth','Direction °',0,360,1],['altitude','Lower altitude km',80,200,1],['height','Height km',20,400,1],['width','Curtain thickness km',1,50,1],['curtains','Curtains',1,3,1],['speed','Animation speed',0,2,.01]],
  rainbow:[['intensity','Intensity',0,8,.1],['rainAmount','Rain amount',0,1,.01],['width','Angular softness °',.1,2,.1]]
};
const LABELS={stars:'Stars',moon:'Moon',aurora:'Aurora',rainbow:'Rainbow'};
export class CelestialPanel {
  constructor(api,workspace){Object.assign(this,{api,workspace,root:workspace.root,document:workspace.document,listeners:[]});}
  on(target,type,fn){target.addEventListener(type,fn);this.listeners.push([target,type,fn]);}
  init(){
    const doc=this.document;this.section=doc.createElement('section');this.section.id='sec-sf-effects';this.section.className='s-sec';
    this.section.innerHTML=`<div class="s-head">Sky effects</div><div class="s-body-inner sf-effects-panel"><div class="sf-effect-tabs" role="tablist" aria-label="Effect controls">${Object.entries(LABELS).map(([key,label])=>`<button type="button" role="tab" data-effect-tab="${key}" id="sf-effect-tab-${key}" aria-controls="sf-effect-pane-${key}">${label}</button>`).join('')}</div>${Object.entries(FIELDS).map(([root,fields])=>`<fieldset class="sf-effect-pane" data-effect="${root}" id="sf-effect-pane-${root}" role="tabpanel" aria-labelledby="sf-effect-tab-${root}"><legend><label><input type="checkbox" data-celestial-path="${root}.enabled">${LABELS[root]}</label></legend>${root!=='stars'?`<button type="button" data-effect-focus="${root}">Frame ${LABELS[root]}</button>`:''}${fields.map(([key,label,min,max,step])=>`<label class="sf-effect-control"><span>${label}</span><input type="number" min="${min}" max="${max}" step="${step}" data-celestial-path="${root}.${key}" aria-label="${LABELS[root]} ${label}"></label>`).join('')}${root==='moon'?'<div class="sf-moon-size-actions"><button type="button" data-moon-size="physical">Real size · 0.52°</button><button type="button" data-moon-size="zoom">Telephoto view</button></div><output class="sf-moon-size"></output><output class="sf-moon-phase"></output>':root==='rainbow'?'<label class="sf-effect-control"><span>Secondary bow</span><input type="checkbox" data-celestial-path="rainbow.secondary"></label>':''}</fieldset>`).join('')}<p class="sf-studio-preview-note">Enable a layer, then frame it. Night scenes show stars and aurora best. Telephoto view changes the lens; Real size restores the Moon’s angular diameter. Scene presets are in Sky looks.</p></div>`;
    (this.workspace.sidebar?.querySelector('.s-body')||this.workspace.sidebar)?.append(this.section);
    this.quick=doc.createElement('div');this.quick.className='sf-effects-quick';this.quick.setAttribute('aria-label','Sky layers');
    this.quick.innerHTML='<span>SKY LAYERS</span>'+Object.entries(LABELS).map(([key,label])=>`<button type="button" data-effect-add="${key}">${label}</button>`).join('');
    this.workspace.left?.querySelector('.sf-studio-add')?.after(this.quick);
    this.on(this.quick,'click',event=>{const key=event.target.closest('[data-effect-add]')?.dataset.effectAdd;if(key)this.add(key);});
    this.on(this.section,'click',event=>{
      const focus=event.target.closest('[data-effect-focus]')?.dataset.effectFocus;if(focus)this.frame(focus);
      const tab=event.target.closest('[data-effect-tab]')?.dataset.effectTab;if(tab)this.select(tab);
      const size=event.target.closest('[data-moon-size]')?.dataset.moonSize;
      if(size){this.finish(false);this.api.store.batch(size==='physical'?'Set physical Moon size':'Moon telephoto framing',draft=>{if(size==='physical')draft.moon.angularDiameter=.52;else{draft.camera.fov=20;draft.viewport.camera=frameSky(draft.viewport.camera,draft.moon.azimuth,draft.moon.elevation);draft.viewport.mode='webgl';}});if(size==='zoom')this.api.viewport.open3D();}
    });
    for(const input of this.section.querySelectorAll('input[data-celestial-path]')){
      const path=input.dataset.celestialPath;
      if(input.type==='checkbox')this.on(input,'change',()=>{
        this.api.store.batch(`Toggle ${path}`,draft=>{const [root,key]=path.split('.');draft[root][key]=input.checked;if(key==='enabled'&&input.checked)draft.viewport.mode='webgl';});
        if(path.endsWith('.enabled')&&input.checked){this.api.viewport.open3D();this.workspace.showSky('effects');}
      });
      else{
        this.on(input,'focus',()=>{this.finish(true);this.edit={input,session:this.api.store.beginEdit(path,{label:`Edit ${path}`})};});
        this.on(input,'input',()=>{
          if(input.value===''||!Number.isFinite(Number(input.value)))return;
          if(!this.edit?.session.active)this.edit={input,session:this.api.store.beginEdit(path,{label:`Edit ${path}`})};
          let value=Math.max(Number(input.min),Math.min(Number(input.max),Number(input.value)));
          if(['stars.count','stars.seed','aurora.curtains'].includes(path))value=Math.round(value);
          this.edit.session.preview(value);
        });
        this.on(input,'change',()=>this.finish(input.value===''||!Number.isFinite(Number(input.value))));
        this.on(input,'blur',()=>this.finish(input.value===''||!Number.isFinite(Number(input.value))));
        this.on(input,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.finish(true);input.blur();}});
      }
    }
    this.on(this.section,'keydown',event=>{const tab=event.target.closest('[data-effect-tab]');if(!tab)return;const keys=Object.keys(LABELS),i=keys.indexOf(tab.dataset.effectTab);let next;if(event.key==='ArrowRight')next=keys[(i+1)%keys.length];if(event.key==='ArrowLeft')next=keys[(i+keys.length-1)%keys.length];if(event.key==='Home')next=keys[0];if(event.key==='End')next=keys.at(-1);if(next){event.preventDefault();event.stopPropagation();this.select(next);this.section.querySelector(`[data-effect-tab="${next}"]`).focus();}});
    this.select('moon');
    this.on(this.root,'blur',()=>this.finish(true));
    this.on(doc,'visibilitychange',()=>{if(doc.hidden)this.finish(true);});
    this.unsubscribe=this.api.store.subscribe(state=>this.sync(state));this.sync(this.api.store.snapshot());return this;
  }
  sync(state){
    if(this.edit&&!this.edit.session.active)this.edit=null;
    const effects=normalizeCelestial(state);
    for(const input of this.section.querySelectorAll('[data-celestial-path]')){
      const [root,key]=input.dataset.celestialPath.split('.'),value=effects[root][key];
      if(input.type==='checkbox')input.checked=Boolean(value);
      else if(this.edit?.input!==input)input.value=String(Number(value.toFixed(4)));
    }
    const pixels=moonDiameterPixels(effects.moon.angularDiameter,state.camera?.fov,this.api.viewport.canvas?.height);
    this.section.querySelector('.sf-moon-size').textContent=`${effects.moon.angularDiameter.toFixed(2)}° · ~${pixels.toFixed(1)} pixels at frame centre · ${effects.moon.angularDiameter<=.6&&effects.moon.angularDiameter>=.48?'Natural scale':'Art directed scale'}`;
    this.section.querySelector('.sf-moon-phase').textContent=`${Math.round(moonIlluminatedFraction(effects.moon.phase)*100)}% illuminated · New 0 / Full 0.5`;
    for(const button of this.quick.querySelectorAll('[data-effect-add]'))button.setAttribute('aria-pressed',String(effects[button.dataset.effectAdd].enabled));
  }
  select(root){
    if(!FIELDS[root])return;this.finish(false);this.active=root;
    for(const pane of this.section.querySelectorAll('[data-effect]'))pane.hidden=pane.dataset.effect!==root;
    for(const tab of this.section.querySelectorAll('[data-effect-tab]')){const active=tab.dataset.effectTab===root;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
  }
  finish(cancel){const edit=this.edit;if(!edit)return;this.edit=null;cancel?edit.session.cancel():edit.session.commit();this.sync(this.api.store.snapshot());}
  add(root){
    if(!FIELDS[root])return;
    this.finish(false);this.api.store.batch(`Add ${LABELS[root]} sky layer`,draft=>{draft[root].enabled=true;draft.viewport.mode='webgl';});this.api.viewport.open3D();this.workspace.showSky('effects');
    this.select(root);this.section.querySelector(`[data-effect="${root}"]`)?.scrollIntoView({block:'nearest'});
  }
  frame(root){
    this.finish(false);const state=this.api.store.snapshot();let azimuth,elevation;
    if(root==='moon'){azimuth=state.moon.azimuth;elevation=state.moon.elevation;}
    else if(root==='aurora'){azimuth=state.aurora.azimuth;elevation=28;}
    else if(root==='rainbow'){azimuth=(state.sun.azimuth+180)%360;elevation=Math.max(4,42-state.sun.elevation);}
    else return;
    this.api.store.batch(`Frame ${root}`,draft=>{draft.viewport.camera=frameSky(draft.viewport.camera,azimuth,elevation);draft.viewport.mode='webgl';});
    this.api.viewport.open3D();
  }
  preset(name){this.finish(false);if(['Moonlit night','Aurora night','Sunshower'].includes(name))this.workspace.selectLook(name);}
  dispose(){this.finish(true);this.unsubscribe?.();for(const [target,type,fn]of this.listeners)target.removeEventListener(type,fn);this.listeners=[];this.section?.remove();this.quick?.remove();}
}
