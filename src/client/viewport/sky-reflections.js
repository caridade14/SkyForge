// One small scene probe, encoded as RGBM (relative radiance range 0..16).
// It uses the actual sky/cloud shader, not a separate cloud simulation.
export class SkyReflectionProbe {
  constructor(gl,compile,fragment){Object.assign(this,{gl,compile,fragment,programs:new Map(),active:false,draws:0});}
  update({key,quality,mode,quad,uniforms}){
    this.active=false;const g=this.gl;
    if(this.error||typeof g.createFramebuffer!=='function')return;
    if(this.key===key&&this.texture){this.active=true;return;}
    const width={low:128,medium:192,high:256}[quality]||128,height=width/2,dither=g.isEnabled(g.DITHER);
    try{
      g.disable(g.DITHER);
      if(!this.texture){this.texture=g.createTexture();this.framebuffer=g.createFramebuffer();if(!this.texture||!this.framebuffer)throw new Error('Reflection resources unavailable');}
      g.bindFramebuffer(g.FRAMEBUFFER,this.framebuffer);g.activeTexture(g.TEXTURE2);g.bindTexture(g.TEXTURE_2D,this.texture);
      if(this.width!==width){
        for(const k of [g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,k,g.LINEAR);
        for(const k of [g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T])g.texParameteri(g.TEXTURE_2D,k,g.CLAMP_TO_EDGE);
        g.texImage2D(g.TEXTURE_2D,0,g.RGBA,width,height,0,g.RGBA,g.UNSIGNED_BYTE,null);
        g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,this.texture,0);
        if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new Error('Reflection framebuffer is incomplete');
        this.width=width;this.height=height;
      }
      // Unbind the probe while writing to it; no read/write feedback loop.
      g.bindTexture(g.TEXTURE_2D,null);g.activeTexture(g.TEXTURE0);
      const id=mode+':'+quality;
      if(!this.programs.has(id))this.programs.set(id,this.compile(g,'attribute vec2 aPosition;varying vec2 vNdc;void main(){vNdc=aPosition;gl_Position=vec4(aPosition,0,1);}',this.fragment(quality,mode)));
      const p=this.programs.get(id);g.viewport(0,0,width,height);g.disable(g.DEPTH_TEST);g.useProgram(p);uniforms(p);
      g.bindBuffer(g.ARRAY_BUFFER,quad);const a=g.getAttribLocation(p,'aPosition');g.enableVertexAttribArray(a);g.vertexAttribPointer(a,2,g.FLOAT,false,0,0);g.drawArrays(g.TRIANGLES,0,6);g.disableVertexAttribArray(a);
      this.draws++;this.key=key;this.active=true;
    }catch(error){this.error=error.message;this.dispose();}
    finally{g.bindFramebuffer(g.FRAMEBUFFER,null);g.activeTexture(g.TEXTURE0);if(dither)g.enable(g.DITHER);}
  }
  bind(program){
    const g=this.gl;g.uniform1f(g.getUniformLocation(program,'uHasReflectionProbe'),this.active?1:0);
    if(!this.texture)return;
    g.activeTexture(g.TEXTURE2);g.bindTexture(g.TEXTURE_2D,this.texture);g.uniform1i(g.getUniformLocation(program,'uReflectionProbe'),2);g.activeTexture(g.TEXTURE0);
  }
  dispose(){
    const g=this.gl;if(!g.isContextLost()){
      if(this.texture)g.deleteTexture(this.texture);if(this.framebuffer)g.deleteFramebuffer(this.framebuffer);
      for(const p of this.programs.values())g.deleteProgram(p);
    }
    this.programs.clear();this.texture=this.framebuffer=null;this.active=false;this.key=null;this.width=this.height=null;
  }
}
