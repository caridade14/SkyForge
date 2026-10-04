import { normalizeReferenceMaterial, MATERIAL_PRESETS, colorFromHex, colorToHex } from '../core/reference-material.js';

export function addLightingReferences(store, token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`) {
  const definitions = [['Gray 18%', -3], ['Chrome', 0], ['White', 3]], ids = [];
  store.batch('Add lighting reference bench', draft => {
    draft.scene.referenceObjects ||= {};
    for(const [name,x] of definitions){
      const id=`lookdev-${token}-${ids.length}`;ids.push(id);
      draft.scene.referenceObjects[id]={id,type:'sphere',name:`Lighting ${name}`,position:[x,0,1.05],rotation:[0,0,0],scale:1,visible:true,locked:false,material:normalizeReferenceMaterial(MATERIAL_PRESETS[name])};
    }
    const id=`lookdev-${token}-ground`;ids.push(id);
    draft.scene.referenceObjects[id]={id,type:'plane',name:'Lighting ground',position:[0,0,0],rotation:[0,0,0],scale:[5,5,1],visible:true,locked:false,material:normalizeReferenceMaterial({...MATERIAL_PRESETS['Gray 18%'],roughness:1})};
    draft.scene.selectedReferenceId=ids[0];draft.viewport.referenceSphere=false;
    draft.viewport.camera={yaw:.55,pitch:.4,distance:16,target:[0,0,1.2],projection:'perspective'};
  });
  return ids;
}

export class LightingWorkbench {
  constructor(api, workspace){this.api=api;this.workspace=workspace;this.root=workspace.root;this.document=workspace.document;this.listeners=[];}
  on(target,type,fn,capture=false){target?.addEventListener(type,fn,capture);this.listeners.push([target,type,fn,capture]);}
  init(){
    const adapter=this.api.viewport?.objectAdapter;
    if(adapter?.transformInspector){
      this.materialPanel=this.document.createElement('section');this.materialPanel.className='sf-reference-materials';this.materialPanel.hidden=true;
      this.materialPanel.innerHTML=`<h3>Reference material</h3><label>Preset<select data-material-preset aria-label="Material preset"><option value="">Custom</option>${Object.keys(MATERIAL_PRESETS).map(name=>`<option>${name}</option>`).join('')}</select></label><label>Base color<input type="color" data-material="baseColor" aria-label="Material base color"></label>${['roughness','metalness'].map(name=>`<label>${name[0].toUpperCase()+name.slice(1)}<output data-material-value="${name}"></output><input type="range" min="${name==='roughness'?'.04':'0'}" max="1" step=".01" data-material="${name}" aria-label="Material ${name}"></label>`).join('')}<label><input type="checkbox" data-material="castShadow" aria-label="Cast object shadow"> Cast Sun shadow</label><label><input type="checkbox" data-material="receiveShadow" aria-label="Receive object shadow"> Receive Sun shadows</label><p class="sf-studio-preview-note">Opaque GGX material · linear sRGB. Reflections sample the sky; they do not reflect other objects.</p>`;
      adapter.transformInspector.after(this.materialPanel);
      for(const input of this.materialPanel.querySelectorAll('[data-material]')){
        this.on(input,'focus',()=>this.start(input));this.on(input,'input',()=>this.preview(input));
        this.on(input,'change',()=>{this.preview(input);this.finish(false);});this.on(input,'blur',()=>this.finish(false));this.on(input,'pointercancel',()=>this.finish(true));
      }
      this.on(this.materialPanel.querySelector('[data-material-preset]'),'change',event=>{
        const name=event.target.value;this.finish(false);const object=this.selected(),preset=MATERIAL_PRESETS[name];if(!object||object.locked||!preset)return;
        this.api.store.set(['scene','referenceObjects',object.id,'material'],normalizeReferenceMaterial({...normalizeReferenceMaterial(object.material),...preset}),{label:`Material preset ${name}`});
      });
      this.on(this.root,'keydown',event=>{if(event.key==='Escape'&&this.materialPanel.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();this.finish(true);event.target.blur?.();}},true);
      this.on(this.root,'blur',()=>this.finish(true));
    }
    const body=this.workspace.sidebar?.querySelector('.s-body');
    if(body){
      this.panel=this.document.createElement('section');this.panel.id='sec-sf-lighting';this.panel.className='s-sec';
      this.panel.innerHTML='<div class="s-sec-head">LIGHTING BENCH</div><div class="s-body-inner sf-lighting-body"><button type="button" data-lighting-add>Add lighting reference bench</button><p class="sf-studio-preview-note">Adds gray, chrome and white spheres plus a ground plane. Existing objects and sky settings are preserved. Undo removes the whole bench in one step.</p><label><input type="checkbox" data-lighting-shadows> Object Sun shadows</label><div class="sf-lighting-readout" role="status"></div><p class="sf-studio-preview-note">Shadow map: 512 / 768 / 1024 pixels for Low / Medium / High. Five sky reflection samples. This is a bounded display preview, not a calibrated HDR renderer.</p></div>';
      body.append(this.panel);this.shadowToggle=this.panel.querySelector('[data-lighting-shadows]');this.readout=this.panel.querySelector('.sf-lighting-readout');
      this.on(this.panel.querySelector('[data-lighting-add]'),'click',()=>this.addBench());
      this.on(this.shadowToggle,'change',()=>this.api.store.set('viewport.objectShadows',this.shadowToggle.checked,{label:'Toggle object Sun shadows'}));
    }
    this.unsubscribe=this.api.store.subscribe(state=>this.sync(state));
    this.on(this.root,'skyforge:viewport-rendered',()=>this.metrics());this.sync(this.api.store.snapshot());return this;
  }
  selected(){const id=this.api.store.get('scene.selectedReferenceId');return this.api.store.get(['scene','referenceObjects',id]);}
  start(input){
    const object=this.selected();if(!object||object.locked)return;
    if(this.edit?.active&&this.editId===object.id)return;
    if(this.edit?.active)this.finish(false);this.editId=object.id;this.edit=this.api.store.beginEdit(['scene','referenceObjects',object.id],{label:`Edit reference ${input.dataset.material}`});
  }
  preview(input){
    const object=this.selected();if(!object||object.locked)return;
    const key=input.dataset.material,value=key==='baseColor'?colorFromHex(input.value):input.type==='checkbox'?input.checked:Number(input.value);
    if(value===null||input.value===''||typeof value==='number'&&!Number.isFinite(value))return;
    if(!this.edit?.active)this.start(input);
    this.edit?.preview({...object,material:normalizeReferenceMaterial({...normalizeReferenceMaterial(object.material),[key]:value})});
  }
  finish(cancel){const edit=this.edit;this.edit=null;this.editId=null;if(cancel)edit?.cancel();else edit?.commit();this.sync(this.api.store.snapshot());}
  addBench(){this.finish(false);const ids=addLightingReferences(this.api.store);if(this.workspace.legacy)this.workspace.setLegacy(false);this.workspace.setLayout({...this.workspace.layout,inspector:'selection',rightCollapsed:false,maximized:false});return ids;}
  sync(state){
    const object=state.scene?.referenceObjects?.[state.scene?.selectedReferenceId];
    if(this.edit?.active&&(!object||object.id!==this.editId||object.locked)){this.finish(true);return;}
    if(this.materialPanel){
      this.materialPanel.hidden=!object;
      const material=normalizeReferenceMaterial(object?.material);
      for(const input of this.materialPanel.querySelectorAll('input,select'))input.disabled=!object||object.locked;
      for(const input of this.materialPanel.querySelectorAll('[data-material]')){
        const key=input.dataset.material;
        if(!this.edit?.active){if(input.type==='checkbox')input.checked=material[key];else input.value=key==='baseColor'?colorToHex(material.baseColor):String(material[key]);}
        const output=this.materialPanel.querySelector(`[data-material-value="${key}"]`);if(output)output.value=String(Number(material[key].toFixed(3)));
      }
      const preset=this.materialPanel.querySelector('[data-material-preset]');
      preset.value=Object.keys(MATERIAL_PRESETS).find(name=>{const p=normalizeReferenceMaterial(MATERIAL_PRESETS[name]);return JSON.stringify(p.baseColor)===JSON.stringify(material.baseColor)&&p.roughness===material.roughness&&p.metalness===material.metalness;})||'';
    }
    if(this.shadowToggle)this.shadowToggle.checked=state.viewport?.objectShadows!==false;
    this.metrics();
  }
  metrics(){
    if(!this.readout)return;
    const renderer=this.api.viewport?.renderer,m=renderer?.lightingMetrics;
    const lines=[`Sky source: ${m?.skySource||'pending'}`,m?.objectShadows?`Sun shadow map: ${m.shadowMapSize} × ${m.shadowMapSize}`:`Object shadows: ${m?.shadowFallback||'disabled / Sun below horizon'}`];
    lines.push(m?.reflectionProbe?'Sky and cloud reflections: ready':`Sky reflections: ${m?.reflectionFallback||'analytic fallback'}`);
    const evaluation=this.api.viewport?.payload?.evaluation;
    if(renderer?.usingLut&&evaluation?.irradiance){const i=evaluation.irradiance;lines.push(`Evaluated DNI: ${Number(i.directNormalWm2).toFixed(1)} W/m²`,`Estimated diffuse: ${Number(i.diffuseHorizontalEstimatedWm2).toFixed(1)} W/m²`);}
    else lines.push('Physical irradiance not evaluated for this direction.');
    const text=lines.join('\n');if(this.readout.textContent!==text)this.readout.textContent=text;
  }
  dispose(){this.finish(true);this.unsubscribe?.();for(const [t,e,f,c] of this.listeners)t?.removeEventListener(e,f,c);this.listeners=[];this.panel?.remove();this.materialPanel?.remove();}
}
