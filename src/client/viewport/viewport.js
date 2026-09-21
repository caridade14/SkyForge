import { normalizeCamera, axisView, cameraBasis } from './camera.js';
import { ViewportNavigation } from './navigation.js';
import { SkyViewportRenderer } from './renderer.js';

export class SkyForgeViewport {
  constructor(store, {root=globalThis, container=root.document?.getElementById('vp')}={}) {
    Object.assign(this,{store,root,container});this.active=false;this.disposed=false;this.frame=null;this.signature='';this.listeners=[];
  }
  init(){
    if(!this.container)return this;
    const doc=this.root.document;
    this.host=doc.createElement('div');this.host.className='sf-3d-host';this.host.hidden=true;
    this.host.innerHTML='<canvas class="sf-3d-canvas" tabindex="0" aria-label="3D sky viewport. Middle mouse or Alt drag to orbit. Shift to pan. Scroll to dolly."></canvas><div class="sf-3d-hud"></div><div class="sf-3d-axis" aria-label="View orientation"></div><div class="sf-3d-help">MMB / Alt drag: orbit · Shift: pan · Ctrl: dolly · Scroll: zoom · Numpad 1/3/7/5 · Home: reset</div>';
    this.canvas=this.host.querySelector('canvas');this.hud=this.host.querySelector('.sf-3d-hud');
    this.axes=this.host.querySelector('.sf-3d-axis');
    for(const [axis,view] of [['X','right'],['Y','front'],['Z','top']]){
      const b=doc.createElement('button');b.textContent=axis;b.dataset.axis=axis;b.title=`${view} view (Shift: opposite)`;
      b.onclick=e=>this.commit(axisView(this.getCamera(),view,e.shiftKey),'Align viewport');this.axes.append(b);
    }
    this.bar=doc.createElement('div');this.bar.className='sf-3d-toolbar';
    this.bar.innerHTML='<button data-vp="mode" title="Switch between WebGL sky preview and the existing scene tools">3D View</button><span class="sf-3d-tools"><button data-vp="home" title="Reset view">Home</button><button data-vp="projection">Perspective</button><button data-vp="grid">Grid</button><button data-vp="referenceSphere">Reference sphere</button><button data-vp="overlays">Overlays</button><button data-vp="sun" title="Copy the evaluated Natural Light sun direction into the scene">Use physical sun</button></span><span class="sf-3d-message" role="status"></span>';
    this.bar.onclick=e=>this.action(e.target.closest('[data-vp]')?.dataset.vp);
    this.message=this.bar.querySelector('.sf-3d-message');
    this.container.append(this.host,this.bar);
    this.camera=this.getCamera();
    try{this.createRenderer();}catch(error){this.error=error.message;this.message.textContent=this.error;}
    this.navigation=new ViewportNavigation(this.canvas,{
      root:this.root,getCamera:()=>this.getCamera(),getFov:()=>Number(this.store.get('camera.fov'))||60,
      preview:c=>{this.camera=normalizeCamera(c);this.invalidate();},commit:(c,label)=>this.commit(c,label)
    });
    this.unsubscribe=this.store.subscribe((state)=>this.sync(state));
    this.on(this.root,'skyforge:natural-light-updated',e=>this.setLut(e.detail));
    this.on(this.root,'skyforge:lighting-preview',e=>this.setLut(e.detail));
    this.on(doc,'visibilitychange',()=>{if(doc.hidden)this.cancelFrame();else this.invalidate();});
    this.on(this.canvas,'webglcontextlost',e=>{
      e.preventDefault();this.restoreActive=this.active;this.lost=true;this.navigation.finish(true);this.setActive(false,false);
      this.message.textContent='Graphics context lost. Legacy view is available while recovering.';
    });
    this.on(this.canvas,'webglcontextrestored',()=>{
      if(this.disposed)return;
      try{this.renderer?.dispose();this.createRenderer();this.lost=false;this.error=null;this.setLut(this.payload);this.setActive(this.restoreActive,false);}
      catch(error){this.error=error.message;this.message.textContent=error.message;}
    });
    if(this.root.ResizeObserver){this.observer=new this.root.ResizeObserver(()=>this.invalidate());this.observer.observe(this.container);}
    else this.on(this.root,'resize',()=>this.invalidate());
    this.setLut(this.root.SkyForgeNaturalLightPreview?.getState?.());
    this.sync(this.store.snapshot());
    return this;
  }
  on(target,type,fn){target.addEventListener(type,fn);this.listeners.push([target,type,fn]);}
  createRenderer(){this.renderer=new SkyViewportRenderer(this.canvas);this.error=null;}
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
      this.navigation?.finish(true);this.camera=nextCamera;
    }
    const desired=state.viewport?.mode!=='legacy';
    if(desired!==this.active)this.setActive(desired,false);
    const signature=JSON.stringify([state.viewport,state.camera,state.sun,state.atmosphere,state.clouds,state.timeline?.currentFrame,state.timeline?.fps]);
    if(signature!==this.signature){this.signature=signature;this.invalidate();}
    for(const key of ['grid','referenceSphere','overlays'])this.bar.querySelector(`[data-vp="${key}"]`).setAttribute('aria-pressed',String(state.viewport?.[key]!==false));
    this.bar.querySelector('[data-vp="projection"]').textContent=nextCamera.projection==='orthographic'?'Orthographic':'Perspective';
    this.host.classList.toggle('sf-3d-no-overlays',state.viewport?.overlays===false);
  }
  setActive(active,persist=true){
    active=Boolean(active&&this.renderer&&!this.lost&&!this.error);
    if(!active){this.navigation?.finish(true);this.cancelFrame();}
    this.active=active;this.root.SF_VIEWPORT_3D_ACTIVE=active;
    this.container.parentElement?.classList.toggle('sf-3d-workspace',active);
    this.container.classList.toggle('sf-3d-active',active);this.host.hidden=!active;
    this.bar.querySelector('[data-vp="mode"]').textContent=active?'Legacy View':'3D View';
    this.bar.querySelector('.sf-3d-tools').hidden=!active;
    this.message.textContent=this.error||(active?'Sky preview · scene object tools in Legacy View':'Legacy scene tools');
    if(persist)this.store.set('viewport.mode',active?'webgl':'legacy',{label:'Switch viewport renderer'});
    if(active)this.invalidate();else this.root.drawSky?.();
  }
  action(action){
    if(!action)return;
    if(action==='mode'){this.setActive(!this.active);return;}
    this.navigation.finish(true);
    if(action==='home')this.commit(axisView(this.getCamera(),'home'),'Reset viewport');
    else if(action==='projection'){
      const c=this.getCamera();this.commit({...c,projection:c.projection==='perspective'?'orthographic':'perspective'},'Toggle viewport projection');
    }else if(action==='sun'){
      const solar=this.payload?.evaluation?.solarPosition;
      if(!solar){this.message.textContent='Waiting for a Natural Light evaluation.';return;}
      this.store.set('sun',{...this.store.get('sun'),azimuth:solar.azimuthDeg,elevation:solar.apparentElevationDeg},{label:'Use evaluated physical sun'});
    }else if(['grid','referenceSphere','overlays'].includes(action))this.store.set(`viewport.${action}`,this.store.get(`viewport.${action}`)===false,{label:`Toggle ${action}`});
    this.canvas.focus({preventScroll:true});
  }
  setLut(payload){this.payload=payload;this.renderer?.setLut(payload);this.invalidate();}
  invalidate(){
    if(this.disposed||!this.active||this.root.document.hidden||this.frame!==null)return;
    this.frame=this.root.requestAnimationFrame(()=>{
      this.frame=null;
      if(!this.active||this.disposed)return;
      const r=this.container.getBoundingClientRect();if(r.width<1||r.height<1)return;
      try{
        this.renderer.resize(r.width,r.height,this.root.devicePixelRatio||1);
        this.renderer.draw(this.store.snapshot(),this.camera);
        this.hud.textContent=`WEBGL · ${this.camera.projection.toUpperCase()} · ${this.renderer.usingLut?'NATURAL LIGHT LUT':'ANALYTIC SKY PREVIEW'}\n${this.renderer.canvas.width} × ${this.renderer.canvas.height} · Clouds: procedural layer · Display preview`;
        this.updateAxes();
      }catch(error){this.error=`3D preview failed: ${error.message}`;this.setActive(false,false);}
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
  dispose(){
    this.disposed=true;this.unsubscribe?.();this.navigation?.dispose();this.cancelFrame();this.observer?.disconnect();
    this.listeners.forEach(([t,n,f])=>t.removeEventListener(n,f));this.listeners=[];this.renderer?.dispose();
    this.root.SF_VIEWPORT_3D_ACTIVE=false;this.container?.parentElement?.classList.remove('sf-3d-workspace');this.container?.classList.remove('sf-3d-active');this.host?.remove();this.bar?.remove();
    this.root.drawSky?.();
  }
}
