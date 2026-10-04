// A real depth pass on WebGL 1. RG encoding avoids a depth-texture extension.
// The map is cached between object/Sun edits, never submitted on every idle tick.
const dot = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = a => a.map(x => x / Math.max(1e-12, Math.hypot(...a)));
export function shadowBounds(casters) {
  if (!casters.length) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const c of casters) for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(c.center[i]) || !Number.isFinite(c.radius) || c.radius < 0) return null;
    min[i] = Math.min(min[i], c.center[i] - c.radius); max[i] = Math.max(max[i], c.center[i] + c.radius);
  }
  const center = min.map((x, i) => (x + max[i]) / 2), radius = Math.max(2, Math.hypot(...max.map((x, i) => (x - min[i]) / 2)) + .5);
  return radius <= 10000 ? { center, radius } : null;
}
export function shadowMatrix({ center, radius }, sunlight) {
  const sun = unit(sunlight), forward = sun.map(x => -x);
  const right = unit(cross(forward, Math.abs(sun[2]) > .95 ? [0, 1, 0] : [0, 0, 1])), up = cross(right, forward);
  return new Float32Array([right[0]/radius,up[0]/radius,-sun[0]/(radius*2),0,
    right[1]/radius,up[1]/radius,-sun[1]/(radius*2),0,right[2]/radius,up[2]/radius,-sun[2]/(radius*2),0,
    -dot(right,center)/radius,-dot(up,center)/radius,dot(sun,center)/(radius*2),1]);
}
export const OBJECT_SHADOW_GLSL = `
uniform sampler2D uObjectShadow; uniform mat4 uShadowVP; uniform float uHasObjectShadow,uShadowTexel,uReceiveShadow;
float objectVisibility(vec3 point,vec3 normal,float noL){
 if(uHasObjectShadow<0.5||uReceiveShadow<0.5||noL<=0.0)return 1.0;
 vec3 p=(uShadowVP*vec4(point,1.0)).xyz*0.5+0.5;
 if(p.x<=0.0||p.x>=1.0||p.y<=0.0||p.y>=1.0||p.z<=0.0||p.z>=1.0)return 1.0;
 // Compare each texel on the receiver plane, rather than biasing every tap
 // against the centre depth. This avoids self-shadow stripes on sloped ground.
 vec3 lightNormal=mat3(uShadowVP)*normal;
 vec2 gradient=lightNormal.xy/(4.0*max(0.00001,-lightNormal.z));
 float bias=0.0001+uShadowTexel*0.05+0.00015*(1.0-noL),sum=0.0;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 uv=(floor(p.xy/uShadowTexel)+vec2(float(x),float(y))+0.5)*uShadowTexel;
  vec2 depth=texture2D(uObjectShadow,uv).rg;
  sum+=step(p.z+dot(gradient,uv-p.xy)-bias,depth.r+depth.g/255.0);
 }
 return sum/9.0;
}`;
const VERTEX = `attribute vec3 aPosition;uniform mat4 uVP;uniform mat3 uRotation;uniform vec3 uOffset,uSize;
void main(){gl_Position=uVP*vec4(uRotation*(aPosition*uSize)+uOffset,1.0);}`;
const FRAGMENT = `precision highp float;void main(){vec2 d=fract(vec2(1.0,255.0)*min(gl_FragCoord.z,0.99999));d.x-=d.y/255.0;gl_FragColor=vec4(d,0.0,1.0);}`;
export class ObjectShadowMap {
  constructor(gl, compile) { this.gl=gl;this.compile=compile;this.draws=0;this.active=false; }
  update(casters, sun, resolution = 512, enabled = true) {
    this.active=false;
    resolution=Math.max(256,Math.min(1024,Math.round(Number(resolution)||512)));
    if(!enabled||sun[2]<=0||!casters.length||this.error)return;
    const g=this.gl, bounds=shadowBounds(casters);
    if(!bounds){this.reason='Scene bounds exceed the shadow preview range';return;}
    if(typeof g.createFramebuffer!=='function'){this.reason='Object shadows unavailable on this context';return;}
    const dither=g.isEnabled(g.DITHER);
    try{
      // Dithering would corrupt the packed RG depth and create shadow acne.
      g.disable(g.DITHER);
      if(!this.program){
        this.program=this.compile(g,VERTEX,FRAGMENT);this.texture=g.createTexture();this.depth=g.createRenderbuffer();this.framebuffer=g.createFramebuffer();
        if(!this.program||!this.texture||!this.depth||!this.framebuffer)throw new Error('Shadow resources unavailable');
      }
      g.bindFramebuffer(g.FRAMEBUFFER,this.framebuffer);
      if(this.resolution!==resolution){
        g.bindTexture(g.TEXTURE_2D,this.texture);
        for(const key of [g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,key,g.NEAREST);
        for(const key of [g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T])g.texParameteri(g.TEXTURE_2D,key,g.CLAMP_TO_EDGE);
        g.texImage2D(g.TEXTURE_2D,0,g.RGBA,resolution,resolution,0,g.RGBA,g.UNSIGNED_BYTE,null);
        g.bindRenderbuffer(g.RENDERBUFFER,this.depth);g.renderbufferStorage(g.RENDERBUFFER,g.DEPTH_COMPONENT16,resolution,resolution);
        g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,this.texture,0);
        g.framebufferRenderbuffer(g.FRAMEBUFFER,g.DEPTH_ATTACHMENT,g.RENDERBUFFER,this.depth);
        if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new Error('Shadow framebuffer is incomplete');
        this.resolution=resolution;this.signature=null;
      }
      const signature=JSON.stringify([sun,resolution,casters.map(c=>[c.id,c.position,c.scale,[...c.rotation],c.center,c.radius])]);
      if(signature!==this.signature){
        this.matrix=shadowMatrix(bounds,sun);g.viewport(0,0,resolution,resolution);g.clearColor(1,1,1,1);g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);g.enable(g.DEPTH_TEST);g.useProgram(this.program);
        g.uniformMatrix4fv(g.getUniformLocation(this.program,'uVP'),false,this.matrix);
        const a=g.getAttribLocation(this.program,'aPosition');g.enableVertexAttribArray(a);
        for(const c of casters){
          g.bindBuffer(g.ARRAY_BUFFER,c.buffer);g.vertexAttribPointer(a,3,g.FLOAT,false,36,0);
          g.uniform3fv(g.getUniformLocation(this.program,'uOffset'),c.position);g.uniform3fv(g.getUniformLocation(this.program,'uSize'),c.scale);
          g.uniformMatrix3fv(g.getUniformLocation(this.program,'uRotation'),false,c.rotation);g.drawArrays(g.TRIANGLES,0,c.count);
        }
        g.disableVertexAttribArray(a);this.draws++;this.signature=signature;
      }
      this.active=true;this.reason=null;
    }catch(error){this.error=error.message;this.dispose();}
    finally{g.bindFramebuffer(g.FRAMEBUFFER,null);g.bindRenderbuffer(g.RENDERBUFFER,null);g.clearColor(0,0,0,1);if(dither)g.enable(g.DITHER);}
  }
  bind(program){
    const g=this.gl;g.uniform1f(g.getUniformLocation(program,'uHasObjectShadow'),this.active?1:0);
    if(!this.texture)return;
    g.activeTexture(g.TEXTURE1);g.bindTexture(g.TEXTURE_2D,this.texture);g.uniform1i(g.getUniformLocation(program,'uObjectShadow'),1);
    g.uniform1f(g.getUniformLocation(program,'uShadowTexel'),1/this.resolution);
    if(this.matrix)g.uniformMatrix4fv(g.getUniformLocation(program,'uShadowVP'),false,this.matrix);
    g.activeTexture(g.TEXTURE0);
  }
  dispose(){
    const g=this.gl;
    if(!g.isContextLost()){
      if(this.framebuffer)g.deleteFramebuffer(this.framebuffer);if(this.depth)g.deleteRenderbuffer(this.depth);
      if(this.texture)g.deleteTexture(this.texture);if(this.program)g.deleteProgram(this.program);
    }
    this.framebuffer=this.depth=this.texture=this.program=null;this.active=false;this.signature=null;this.resolution=null;
  }
}
