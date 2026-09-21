import { normalizeCamera, orbit, pan, dolly, axisView } from './camera.js';

export function dragMode(event) {
  // Blender default + Emulate 3 Button Mouse for Mac trackpads.
  if (event.button === 1 || (event.button === 0 && event.altKey)) {
    return event.ctrlKey || event.metaKey ? 'dolly' : event.shiftKey ? 'pan' : 'orbit';
  }
  return null;
}

export class ViewportNavigation {
  constructor(canvas, { getCamera, getFov, preview, commit, root = globalThis }) {
    Object.assign(this, {canvas, getCamera, getFov, preview, commit, root});
    this.drag = null;
    this.listeners = [];
    this.listen('pointerdown', e => {
      if(e.target !== canvas) return;
      canvas.focus({preventScroll:true});
      const mode = dragMode(e);
      if(mode) {
        this.drag = {id:e.pointerId,mode,x:e.clientX,y:e.clientY,before:normalizeCamera(getCamera()),camera:normalizeCamera(getCamera())};
        canvas.setPointerCapture?.(e.pointerId);
      }
      this.eat(e); // Isolate legacy document-capture navigation, including LMB selection.
    });
    this.listen('pointermove', e => {
      if(!this.drag) { if(e.target===canvas)this.eat(e); return; }
      if(e.pointerId !== this.drag.id) return;
      const d=this.drag, dx=e.clientX-d.x, dy=e.clientY-d.y;
      d.camera = d.mode==='orbit' ? orbit(d.camera,dx,dy) : d.mode==='pan' ? pan(d.camera,dx,dy,canvas.clientHeight,getFov()) : dolly(d.camera,dy*3);
      d.x=e.clientX; d.y=e.clientY;
      preview(d.camera); this.eat(e);
    });
    this.listen('pointerup', e => { if(this.drag?.id===e.pointerId){this.finish(false);this.eat(e);} else if(e.target===canvas)this.eat(e); });
    this.listen('pointercancel', e => { if(this.drag?.id===e.pointerId){this.finish(true);this.eat(e);} });
    this.listen('lostpointercapture', e => { if(this.drag?.id===e.pointerId)this.finish(true); });
    for(const type of ['mousedown','mouseup','mousemove','contextmenu','dblclick']) this.listen(type,e=>{if(e.target===canvas)this.eat(e);});
    this.listen('wheel', e => {
      if(e.target!==canvas)return;
      this.finish(false);
      const scale=e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1;
      commit(dolly(getCamera(),e.deltaY*scale),'Dolly viewport');
      this.eat(e);
    });
    this.listen('keydown', e => {
      if(e.target!==canvas)return;
      if(e.code==='Escape'&&this.drag){this.finish(true);this.eat(e);return;}
      // Leave project shortcuts to the Core; only viewport keys are captured.
      if(e.metaKey || e.altKey || (e.ctrlKey&&!['Numpad1','Numpad3','Numpad7'].includes(e.code)))return;
      const c=normalizeCamera(getCamera()); let next=null;
      if(e.code==='Numpad1')next=axisView(c,'front',e.ctrlKey);
      if(e.code==='Numpad3')next=axisView(c,'right',e.ctrlKey);
      if(e.code==='Numpad7')next=axisView(c,'top',e.ctrlKey);
      if(e.code==='Numpad5')next={...c,projection:c.projection==='perspective'?'orthographic':'perspective'};
      if(e.code==='Home'||e.code==='NumpadDecimal')next=axisView(c,'home');
      if(next){this.finish(true);commit(next,'Change viewport view');this.eat(e);}
    });
    this.listen('blur',()=>this.finish(true));
  }
  listen(type,fn){this.root.addEventListener(type,fn,{capture:true,passive:false});this.listeners.push([type,fn]);}
  eat(e){e.preventDefault();e.stopImmediatePropagation();}
  finish(cancel){
    const d=this.drag; if(!d)return;
    this.drag=null;
    if(this.canvas.hasPointerCapture?.(d.id))this.canvas.releasePointerCapture(d.id);
    if(cancel)this.preview(this.getCamera()); else this.commit(d.camera,'Navigate viewport');
  }
  dispose(){this.finish(true);for(const [t,f] of this.listeners)this.root.removeEventListener(t,f,true);this.listeners=[];}
}
