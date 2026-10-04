import { normalizeCelestial } from '../core/celestial-state.js';
import { moonIlluminatedFraction } from '../viewport/celestial-effects.js';
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
    this.section.innerHTML=`<div class="s-head">Sky effects</div><div class="s-body-inner sf-effects-panel"><div class="sf-effects-presets">${['Moonlit night','Aurora night','Sunshower'].map(name=>`<button type="button" data-effects-preset="${name}">${name}</button>`).join('')}</div>${Object.entries(FIELDS).map(([root,fields])=>`<fieldset data-effect="${root}"><legend><label><input type="checkbox" data-celestial-path="${root}.enabled">${LABELS[root]}</label></legend>${root!=='stars'?`<button type="button" data-effect-focus="${root}">Frame ${LABELS[root]}</button>`:''}${fields.map(([key,label,min,max,step])=>`<label class="sf-effect-control"><span>${label}</span><input type="number" min="${min}" max="${max}" step="${step}" data-celestial-path="${root}.${key}" aria-label="${LABELS[root]} ${label}"></label>`).join('')}${root==='moon'?'<output class="sf-moon-phase"></output>':root==='rainbow'?'<label class="sf-effect-control"><span>Secondary bow</span><input type="checkbox" data-celestial-path="rainbow.secondary"></label>':''}</fieldset>`).join('')}<p class="sf-studio-preview-note">Stars are procedural. Moon phase and position are art directed. Aurora is a folded emission sheet preview. The rainbow follows the Sun and rain amount. Enable a layer and frame it; stars and aurora are easiest to see at night.</p></div>`;
    (this.workspace.sidebar?.querySelector('.s-body')||this.workspace.sidebar)?.append(this.section);
    this.quick=doc.createElement('div');this.quick.className='sf-effects-quick';this.quick.setAttribute('aria-label','Sky layers');
    this.quick.innerHTML='<span>SKY LAYERS</span>'+Object.entries(LABELS).map(([key,label])=>`<button type="button" data-effect-add="${key}">${label}</button>`).join('');
    this.workspace.left?.querySelector('.sf-studio-add')?.after(this.quick);
    this.on(this.quick,'click',event=>{const key=event.target.closest('[data-effect-add]')?.dataset.effectAdd;if(key)this.add(key);});
    this.on(this.section,'click',event=>{
      const focus=event.target.closest('[data-effect-focus]')?.dataset.effectFocus;if(focus)this.frame(focus);
      const preset=event.target.closest('[data-effects-preset]')?.dataset.effectsPreset;if(preset)this.preset(preset);
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
    this.section.querySelector('.sf-moon-phase').textContent=`${Math.round(moonIlluminatedFraction(effects.moon.phase)*100)}% illuminated · New 0 / Full 0.5`;
    for(const button of this.quick.querySelectorAll('[data-effect-add]'))button.setAttribute('aria-pressed',String(effects[button.dataset.effectAdd].enabled));
  }
  finish(cancel){const edit=this.edit;if(!edit)return;this.edit=null;cancel?edit.session.cancel():edit.session.commit();this.sync(this.api.store.snapshot());}
  add(root){
    if(!FIELDS[root])return;
    this.finish(false);this.api.store.batch(`Add ${LABELS[root]} sky layer`,draft=>{draft[root].enabled=true;draft.viewport.mode='webgl';});this.api.viewport.open3D();this.workspace.showSky('effects');
    this.section.querySelector(`[data-effect="${root}"]`)?.scrollIntoView({block:'nearest'});
  }
  frame(root){
    this.finish(false);const state=this.api.store.snapshot();let azimuth,elevation;
    if(root==='moon'){azimuth=state.moon.azimuth;elevation=state.moon.elevation;}
    else if(root==='aurora'){azimuth=state.aurora.azimuth;elevation=34;}
    else if(root==='rainbow'){azimuth=(state.sun.azimuth+180)%360;elevation=Math.max(4,42-state.sun.elevation);}
    else return;
    this.api.store.batch(`Frame ${root}`,draft=>{draft.viewport.camera=frameSky(draft.viewport.camera,azimuth,elevation);draft.viewport.mode='webgl';});
    this.api.viewport.open3D();
  }
  preset(name){
    this.finish(false);
    this.api.store.batch(`Sky effects preset ${name}`,draft=>{
      draft.viewport.skySource='integrated';
      draft.viewport.mode='webgl';draft.viewport.cloudMode='volumetric';
      if(name==='Sunshower'){
        Object.assign(draft.sun,{elevation:12,intensity:1.8,temperature:5778});draft.camera.exposure=1;
        Object.assign(draft.clouds,{type:'Cumulus',coverage:.35,density:.65,precipitation:.6});Object.assign(draft.rainbow,{enabled:true,rainAmount:.5,intensity:1});
        draft.stars.enabled=false;draft.aurora.enabled=false;
      }else{
        Object.assign(draft.sun,{elevation:-18,intensity:1.8,temperature:5778});draft.camera.exposure=4;
        Object.assign(draft.clouds,{type:'Cumulus',coverage:.22,density:.55});Object.assign(draft.stars,{enabled:true,brightness:1});Object.assign(draft.moon,{enabled:true,phase:.5,brightness:1});draft.rainbow.enabled=false;
        draft.aurora.enabled=name==='Aurora night';if(draft.aurora.enabled)draft.aurora.intensity=1;
      }
      const root=name==='Sunshower'?'rainbow':name==='Aurora night'?'aurora':'moon';
      const az=root==='rainbow'?(draft.sun.azimuth+180)%360:draft[root].azimuth;
      const el=root==='rainbow'?30:root==='aurora'?34:draft.moon.elevation;
      draft.viewport.camera=frameSky(draft.viewport.camera,az,el);
    });
    this.api.viewport.open3D();this.workspace.showSky('effects');
  }
  dispose(){this.finish(true);this.unsubscribe?.();for(const [target,type,fn]of this.listeners)target.removeEventListener(type,fn);this.listeners=[];this.section?.remove();this.quick?.remove();}
}
