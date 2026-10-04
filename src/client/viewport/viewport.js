import { normalizeCamera, axisView, cameraBasis, dolly } from './camera.js';
import { ViewportNavigation } from './navigation.js';
import { SkyViewportRenderer } from './renderer.js';
import { SunGizmo } from './sun-gizmo.js';
import { ReferenceGizmo } from './reference-gizmo.js';
import { SceneObjectAdapter } from '../core/scene-object-adapter.js';

export class SkyForgeViewport {
  constructor(store, {root=globalThis, container=root.document?.getElementById('vp')}={}) {
    Object.assign(this,{store,root,container});this.active=false;this.disposed=false;this.frame=null;this.signature='';this.listeners=[];
  }
  init(){
    if(!this.container)return this;
    const doc=this.root.document;
    this.host=doc.createElement('div');this.host.className='sf-3d-host';this.host.hidden=true;
    this.host.innerHTML='<canvas class="sf-3d-canvas" tabindex="0" aria-label="3D sky viewport. Click a reference object to select; drag X/Y/Z to move. F frames selection. Left drag the sun marker; Escape cancels. Middle mouse or Alt drag to orbit. Shift to pan. Scroll to dolly."></canvas><svg class="sf-3d-translate" role="img"></svg><div class="sf-3d-sun" role="img"><span>Sun</span></div><div class="sf-3d-hud"></div><div class="sf-3d-axis" aria-label="View orientation"></div><div class="sf-3d-help">Click: select · X/Y/Z: move · F: frame · Sun: direction · Escape: cancel · MMB / Alt drag: orbit · Shift: pan · Ctrl: dolly · Scroll: zoom · Numpad 1/3/7/5 · Home: reset</div>';
    this.rail=doc.createElement('nav');this.rail.className='sf-3d-rail';this.rail.setAttribute('role','toolbar');this.rail.setAttribute('aria-label','Viewport tools');
    const glyphs={select:'↖',move:'↔',rotate:'⟳',scale:'⤢',orbit:'◎',pan:'✥',dolly:'⌕',undo:'↶',frame:'▣',capture:'▧',home:'⌂',top:'TOP',front:'FRT',right:'SIDE'};
    this.rail.innerHTML=Object.entries(glyphs).map(([key,glyph])=>`<button type="button" data-vp-rail="${key}" aria-label="Viewport ${key}" title="${['orbit','pan','dolly'].includes(key)?`${key}: left drag in viewport`:key}"><span>${glyph}</span></button>`).join('');
    this.rail.onclick=e=>this.railAction(e.target.closest('[data-vp-rail]')?.dataset.vpRail);
    this.host.append(this.rail);
    this.canvas=this.host.querySelector('canvas');this.hud=this.host.querySelector('.sf-3d-hud');
    this.axes=this.host.querySelector('.sf-3d-axis');
    for(const [axis,view] of [['X','right'],['Y','front'],['Z','top']]){
      const b=doc.createElement('button');b.textContent=axis;b.dataset.axis=axis;b.title=`${view} view (Shift: opposite)`;
      b.onclick=e=>this.commit(axisView(this.getCamera(),view,e.shiftKey),'Align viewport');this.axes.append(b);
    }
    this.bar=doc.createElement('div');this.bar.className='sf-3d-toolbar';
    this.bar.innerHTML='<button data-vp="mode" title="Switch between WebGL sky preview and the existing scene tools">3D View</button><span class="sf-3d-tools"><button data-vp="home" title="Reset view">Home</button><button data-vp="frame" title="Frame selected reference (F)">Frame selected</button><button data-vp="projection">Perspective</button><button data-vp="grid">Grid</button><button data-vp="referenceSphere">Reference sphere</button><button data-vp="overlays">Overlays</button><button data-vp="sun" title="Copy the evaluated Natural Light sun direction into the scene">Use physical sun</button><select data-vp="skySource" aria-label="Sky lighting source"><option value="integrated">Realtime atmosphere</option><option value="backend">Natural Light LUT</option></select><select data-vp="cloudMode" aria-label="Cloud preview renderer" title="Choose GPU volumetric clouds or the existing cloud layer"><option value="volumetric">GPU clouds</option><option value="layer">Cloud layer</option></select><select data-vp="cloudQuality" aria-label="Cloud preview quality" title="Preview budget: Low 16 steps / 250k pixels; Medium 28 / 500k; High 44 / 900k"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></span><span class="sf-3d-message" role="status"></span>';
    this.bar.onclick=e=>this.action(e.target.closest('button[data-vp]')?.dataset.vp);
    this.bar.onchange=e=>this.action(e.target.dataset.vp,e.target.value);
    this.message=this.bar.querySelector('.sf-3d-message');
    this.alert=doc.createElement('aside');this.alert.className='sf-3d-alert';this.alert.setAttribute('role','status');
    this.alert.innerHTML='<span></span><button type="button">Open 3D View</button>';this.alert.querySelector('button').onclick=()=>this.open3D();
    this.container.append(this.host,this.bar,this.alert);
    this.camera=this.getCamera();
    try{this.createRenderer();}catch(error){this.error=error.message;this.message.textContent=this.error;}
    this.objectAdapter=new SceneObjectAdapter(this.store,{root:this.root,onFrame:()=>this.referenceGizmo?.frameSelected()}).init();
    this.sunGizmo=new SunGizmo(this.canvas,this.host.querySelector('.sf-3d-sun'),{
      store:this.store,root:this.root,getCamera:()=>this.camera,getFov:()=>Number(this.store.get('camera.fov'))||60,
      isActive:()=>this.active,invalidate:()=>this.invalidate()
    });
    this.referenceGizmo=new ReferenceGizmo(this.canvas,this.host.querySelector('.sf-3d-translate'),{
      store:this.store,root:this.root,getCamera:()=>this.camera,getFov:()=>Number(this.store.get('camera.fov'))||60,
      isActive:()=>this.active,invalidate:()=>this.invalidate(),commitCamera:(c,label)=>this.commit(c,label),
      beforeFrame:()=>{this.sunGizmo.finish(true);this.navigation?.finish(true);}
    });
    this.navigation=new ViewportNavigation(this.canvas,{
      root:this.root,getTool:()=>this.store.get('viewport.navigationTool'),getCamera:()=>this.getCamera(),getFov:()=>Number(this.store.get('camera.fov'))||60,
      preview:c=>{this.camera=normalizeCamera(c);this.invalidate();},commit:(c,label)=>this.commit(c,label)
    });
    this.unsubscribe=this.store.subscribe((state)=>this.sync(state));
    this.on(this.root,'skyforge:natural-light-updated',e=>this.setLut(e.detail));
    this.on(this.root,'skyforge:lighting-preview',e=>this.setLut(e.detail));
    this.on(doc,'visibilitychange',()=>{if(doc.hidden){this.sunGizmo.finish(true);this.referenceGizmo.finish(true);this.navigation.finish(true);this.cancelFrame();this.cancelCaptures('Show the window before capturing the preview.');}else this.invalidate();});
    this.on(this.canvas,'webglcontextlost',e=>{
      e.preventDefault();this.restoreActive=this.active;this.lost=true;this.sunGizmo.finish(true);this.referenceGizmo.finish(true);this.navigation.finish(true);this.setActive(false,false);
      // All handles are invalidated by context loss. Release JS ownership now,
      // never issue deletes against stale handles after restoration.
      this.renderer?.dispose();this.renderer=null;
      this.message.textContent='Graphics context lost. Legacy view is available while recovering.';
    });
    this.on(this.canvas,'webglcontextrestored',()=>{
      if(this.disposed)return;
      this.lost=false;
      try{this.createRenderer();this.error=null;this.setLut(this.payload);this.setActive(this.restoreActive,false);}
      catch(error){this.error=error.message;this.setActive(false,false);}
    });
    if(this.root.ResizeObserver){this.observer=new this.root.ResizeObserver(()=>this.invalidate());this.observer.observe(this.container);}
    else this.on(this.root,'resize',()=>this.invalidate());
    this.setLut(this.root.SkyForgeNaturalLightPreview?.getState?.());
    this.sync(this.store.snapshot());
    return this;
  }
  on(target,type,fn){target.addEventListener(type,fn);this.listeners.push([target,type,fn]);}
  createRenderer(){this.renderer=new SkyViewportRenderer(this.canvas);this.error=null;}
  open3D(){
    if(this.disposed||this.lost)return false;
    if(!this.renderer||this.error){
      try{this.renderer?.dispose();this.createRenderer();this.setLut(this.payload);}
      catch(error){this.error=error.message;this.updateRecovery();return false;}
    }
    this.store.set('viewport.mode','webgl',{label:'Open 3D View'});this.sync(this.store.snapshot());this.updateRecovery();return this.active;
  }
  updateRecovery(){
    if(!this.alert)return;
    this.alert.hidden=this.active&&!this.error&&!this.lost;
    this.alert.querySelector('span').textContent=this.lost?'The graphics context was lost. Waiting for browser recovery.':this.error?`3D View could not render: ${this.error}`:'Legacy canvas is active. Open 3D View to use Studio sky layers.';
    const button=this.alert.querySelector('button');button.textContent=this.error?'Retry 3D View':'Open 3D View';button.disabled=Boolean(this.lost);
    const status=JSON.stringify([this.active,Boolean(this.lost),this.error||null]);
    if(status!==this.graphicsStatus){this.graphicsStatus=status;if(typeof this.root.CustomEvent==='function')this.root.dispatchEvent(new this.root.CustomEvent('skyforge:viewport-status',{detail:{active:this.active,lost:Boolean(this.lost),error:this.error||null}}));}
  }
  getCamera(){return normalizeCamera(this.store.get('viewport.camera'));}
  commit(camera,label){
    this.camera=normalizeCamera(camera);
    this.store.set('viewport.camera',this.camera,{label});
    this.invalidate();
  }
  sync(state){
    if(!this.host)return;
    const nextCamera=normalizeCamera(state.viewport?.camera);
    if(JSON.stringify(nextCamera)!==this.committedCamera){
      this.committedCamera=JSON.stringify(nextCamera);
      this.sunGizmo?.finish(true);this.referenceGizmo?.finish(true);this.navigation?.finish(true);this.camera=nextCamera;
    }
    const desired=state.viewport?.mode!=='legacy';
    if(desired!==this.active)this.setActive(desired,false);
    const signature=JSON.stringify([state.viewport,state.scene?.referenceObjects,state.scene?.selectedReferenceId,state.camera,state.sun,state.atmosphere,state.clouds,state.color,state.moon,state.stars,state.aurora,state.rainbow,state.timeline?.currentFrame,state.timeline?.fps]);
    if(signature!==this.signature){this.signature=signature;this.invalidate();}
    this.bar.querySelector('[data-vp="frame"]').disabled=!state.scene?.referenceObjects?.[state.scene?.selectedReferenceId];
    for(const key of ['grid','referenceSphere','overlays'])this.bar.querySelector(`[data-vp="${key}"]`).setAttribute('aria-pressed',String(state.viewport?.[key]!==false));
    this.bar.querySelector('[data-vp="projection"]').textContent=nextCamera.projection==='orthographic'?'Orthographic':'Perspective';
    this.bar.querySelector('[data-vp="skySource"]').value=state.viewport?.skySource==='backend'?'backend':'integrated';
    this.bar.querySelector('[data-vp="cloudMode"]').value=state.viewport?.cloudMode==='layer'?'layer':'volumetric';
    this.bar.querySelector('[data-vp="cloudQuality"]').value=['low','medium','high'].includes(state.viewport?.cloudQuality)?state.viewport.cloudQuality:'low';
    this.bar.querySelector('[data-vp="cloudQuality"]').disabled=state.viewport?.cloudMode==='layer';
    const navigation=state.viewport?.navigationTool||'transform';
    for(const b of this.rail.querySelectorAll('[data-vp-rail]')){
      const action=b.dataset.vpRail;b.setAttribute('aria-pressed',String(navigation==='transform'?action===(state.viewport?.transformTool||'move'):action===navigation));
      b.disabled=action==='undo'?!this.store.canUndo():action==='frame'?!state.scene?.referenceObjects?.[state.scene?.selectedReferenceId]:false;
    }
    this.host.classList.toggle('sf-3d-no-overlays',state.viewport?.overlays===false);
    this.updateRecovery();
  }
  setActive(active,persist=true){
    active=Boolean(active&&this.renderer&&!this.lost&&!this.error);
    if(!active){this.sunGizmo?.finish(true);this.referenceGizmo?.finish(true);this.navigation?.finish(true);this.cancelFrame();this.cancelCaptures('The viewport closed before capture.');}
    this.active=active;this.root.SF_VIEWPORT_3D_ACTIVE=active;
    this.container.parentElement?.classList.toggle('sf-3d-workspace',active);
    this.container.classList.toggle('sf-3d-active',active);this.host.hidden=!active;
    const mode=this.bar.querySelector('[data-vp="mode"]');mode.textContent=active?'3D View':'Legacy View';
    mode.title=active?'3D View is active. Click to switch to the Legacy canvas.':'Legacy canvas is active. Click to open 3D View.';mode.setAttribute('aria-pressed',String(active));
    this.bar.querySelector('.sf-3d-tools').hidden=!active;
    this.message.textContent=this.error||(active?'Reference geometry · sky layers · render on demand':'Legacy scene tools');
    if(persist)this.store.set('viewport.mode',active?'webgl':'legacy',{label:'Switch viewport renderer'});
    if(active)this.invalidate();else this.root.drawSky?.();
    this.updateRecovery();
  }
  railAction(action){
    if(!action)return;this.sunGizmo.finish(true);this.referenceGizmo.finish(true);this.navigation.finish(true);
    if(['select','move','rotate','scale','orbit','pan','dolly'].includes(action)){
      this.store.set('viewport.navigationTool',['move','rotate','scale'].includes(action)?'transform':action,{record:false,label:'Choose viewport tool'});
      if(['move','rotate','scale'].includes(action))this.store.set('viewport.transformTool',action,{record:false,label:'Choose transform tool'});
    }else if(action==='undo')this.store.undo();
    else if(['top','front','right'].includes(action))this.commit(axisView(this.getCamera(),action),'Align viewport');
    else if(action==='capture')this.capturePreview().catch(error=>{this.message.textContent=error.message;});
    else this.action(action);
    this.canvas.focus({preventScroll:true});
  }
  action(action,value){
    if(!action)return;
    this.sunGizmo.finish(true);this.referenceGizmo.finish(true);
    if(action==='mode'){this.setActive(!this.active);return;}
    this.navigation.finish(true);
    if(action==='cloudMode'||action==='cloudQuality'||action==='skySource'){
      const choices=action==='cloudMode'?['volumetric','layer']:action==='skySource'?['integrated','backend']:['low','medium','high'];
      if(choices.includes(value))this.store.set(`viewport.${action}`,value,{label:action==='cloudMode'?'Change cloud preview renderer':'Change cloud preview quality'});
      return;
    }
    if(action==='frame')this.referenceGizmo.frameSelected();
    else if(action==='home')this.commit(axisView(this.getCamera(),'home'),'Reset viewport');
    else if(action==='projection'){
      const c=this.getCamera();this.commit({...c,projection:c.projection==='perspective'?'orthographic':'perspective'},'Toggle viewport projection');
    }else if(action==='sun'){
      const solar=this.payload?.evaluation?.solarPosition;
      if(!solar){this.message.textContent='Waiting for a Natural Light evaluation.';return;}
      this.store.set('sun',{...this.store.get('sun'),azimuth:solar.azimuthDeg,elevation:solar.apparentElevationDeg},{label:'Use evaluated physical sun'});
    }else if(['grid','referenceSphere','overlays'].includes(action))this.store.set(`viewport.${action}`,this.store.get(`viewport.${action}`)===false,{label:`Toggle ${action}`});
    this.canvas.focus({preventScroll:true});
  }
  setLut(payload){this.payload=payload;this.renderer?.setLut(payload,this.store.get('atmosphere'));this.invalidate();}
  capturePreview({download=true}={}){
    if(!this.active||!this.renderer)return Promise.reject(new Error('Open 3D View to capture the WebGL preview.'));
    if(this.root.document.hidden)return Promise.reject(new Error('Show the window before capturing the preview.'));
    return new Promise((resolve,reject)=>{
      const handle=this.root.requestAnimationFrame(()=>{
        this.captureHandles?.delete(handle);
        if(this.disposed||!this.active||!this.renderer||this.root.document.hidden)return reject(new Error('The viewport became unavailable before capture.'));
        try{
          const rect=this.container.getBoundingClientRect();this.renderer.resize(rect.width,rect.height,this.root.devicePixelRatio||1);
          this.renderer.draw(this.store.snapshot(),this.camera);
          const dataUrl=this.canvas.toDataURL('image/png');
          if(download){const a=this.root.document.createElement('a');a.href=dataUrl;a.download='skyforge-webgl-preview.png';a.click();}
          resolve({dataUrl,width:this.canvas.width,height:this.canvas.height,label:'SkyForge WebGL preview'});
        }catch(error){reject(error);}
      });
      this.captureHandles ||= new Map();this.captureHandles.set(handle,reject);
    });
  }
  invalidate(){
    if(this.disposed||!this.active||this.root.document.hidden||this.frame!==null)return;
    this.frame=this.root.requestAnimationFrame(()=>{
      this.frame=null;
      if(!this.active||this.disposed||this.root.document.hidden)return;
      const r=this.container.getBoundingClientRect();if(r.width<1||r.height<1)return;
      try{
        this.renderer.resize(r.width,r.height,this.root.devicePixelRatio||1);
        const state=this.store.snapshot();
        this.renderer.draw(state,this.camera);
        if(typeof this.root.CustomEvent==='function')this.root.dispatchEvent(new this.root.CustomEvent('skyforge:viewport-rendered'));
        this.referenceGizmo.update(this.camera,r.width,r.height,Number(state.camera?.fov)||60);
        this.sunGizmo.update(state.sun,this.camera,r.width,r.height,Number(state.camera?.fov)||60);
        const cloud=this.renderer.cloudMetrics;
        const cloudLabel=cloud?.mode==='volumetric'?`GPU volume · ${cloud.quality} · ${cloud.samples} steps · ${cloud.width} × ${cloud.height}`:'procedural layer';
        this.hud.textContent=`WEBGL · ${this.camera.projection.toUpperCase()} · ${this.renderer.usingLut?'NATURAL LIGHT LUT':'INTEGRATED ATMOSPHERE'}\n${this.renderer.canvas.width} × ${this.renderer.canvas.height} · Clouds: ${cloudLabel} · Display preview`;
        this.message.textContent=this.renderer.cloudFallbackReason||'Reference geometry · sky layers · render on demand';
        this.message.title=this.renderer.cloudFallbackReason||'';
        this.updateAxes();
      }catch(error){this.error=`3D preview failed: ${error.message}`;this.setActive(false,false);this.updateRecovery();}
    });
  }
  updateAxes(){
    const b=cameraBasis(this.camera);
    for(const [i,button] of [...this.axes.children].entries()){
      button.style.left=`${38+b.right[i]*26}px`;button.style.top=`${38-b.up[i]*26}px`;
      button.style.opacity=String(0.6+Math.max(0,-b.forward[i])*0.4);
    }
  }
  cancelFrame(){if(this.frame!==null)this.root.cancelAnimationFrame(this.frame);this.frame=null;}
  cancelCaptures(message){for(const [handle,reject] of this.captureHandles||[]){this.root.cancelAnimationFrame(handle);reject(new Error(message));}this.captureHandles?.clear();}
  dispose(){
    this.disposed=true;this.unsubscribe?.();this.referenceGizmo?.dispose();this.objectAdapter?.dispose();this.sunGizmo?.dispose();this.navigation?.dispose();this.cancelFrame();this.observer?.disconnect();
    this.cancelCaptures('Viewport closed before capture.');
    this.listeners.forEach(([t,n,f])=>t.removeEventListener(n,f));this.listeners=[];this.renderer?.dispose();
    this.root.SF_VIEWPORT_3D_ACTIVE=false;this.container?.parentElement?.classList.remove('sf-3d-workspace');this.container?.classList.remove('sf-3d-active');this.host?.remove();this.bar?.remove();this.alert?.remove();
    this.root.drawSky?.();
  }
}
