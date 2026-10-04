import { cloudPreviewResolution, volumetricCloudFunctions } from './volumetric-clouds.js';

export const DISPLAY_BUDGET = Object.freeze({maxPixels: 2000000, maxDpr: 1.5});
const VERTEX = `attribute vec2 aPosition;varying vec2 vNdc;void main(){vNdc=aPosition;gl_Position=vec4(aPosition,0.0,1.0);}`;
const fragment = quality => `precision highp float;varying vec2 vNdc;
uniform vec3 uEye,uForward,uRight,uUp,uSun,uCloudSunTint,uSkyAmbient,uMoonAmbient;
uniform float uAspect,uTan,uDistance,uOrtho,uIntensity,uCoverage,uDensity,uAltitude,uThickness,uCloudScale,uCloudDistance,uErosion,uDetail,uCloudKind,uTime,uWindSpeed,uWindDirection,uHaze,uCloudEncoded;
${volumetricCloudFunctions(quality)}
void main(){
 vec3 off=uRight*vNdc.x*uAspect*uTan+uUp*vNdc.y*uTan;
 vec3 ro=uEye+off*uDistance*uOrtho,rd=normalize(uForward+off*(1.0-uOrtho));
 vec4 cloud=cloudTransport(ro,rd,smoothstep(-.15,.15,uSun.z));
 if(uCloudEncoded>.5)cloud.rgb=log2(vec3(1.0)+min(max(cloud.rgb,vec3(0.0)),vec3(32.0)))/log2(33.0);
 gl_FragColor=cloud;
}`;

// Decode before interpolation: the fixed-point fallback contains logarithmic
// relative radiance in RGB and linear path transmission in A, never display RGB.
export const CLOUD_COMPOSITE_GLSL = `
uniform sampler2D uCloudBuffer;uniform vec2 uCloudBufferSize;uniform float uUseCloudBuffer,uCloudEncoded;
vec4 cloudPixel(vec2 p){
 vec4 c=texture2D(uCloudBuffer,(clamp(p,vec2(0.0),uCloudBufferSize-1.0)+.5)/uCloudBufferSize);
 if(uCloudEncoded>.5)c.rgb=exp2(c.rgb*log2(33.0))-1.0;
 return c;
}
vec4 reconstructedCloud(vec2 uv){
 vec2 p=uv*uCloudBufferSize-.5,i=floor(p),f=fract(p);
 return mix(mix(cloudPixel(i),cloudPixel(i+vec2(1,0)),f.x),mix(cloudPixel(i+vec2(0,1)),cloudPixel(i+vec2(1,1)),f.x),f.y);
}`;

export class CloudRenderPass {
 constructor(gl,compile,uniform,bindTransport){
  Object.assign(this,{gl,compile,uniform,bindTransport,programs:new Map(),draws:0});
  this.supported=typeof gl.createFramebuffer==='function'&&typeof gl.checkFramebufferStatus==='function'&&gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>=7;
  if(!this.supported)this.error='Separate cloud framebuffer unavailable; using bounded full-frame clouds.';
 }
 allocate(size){
  const g=this.gl;if(this.width===size.width&&this.height===size.height)return true;
  const previous=g.getParameter(g.FRAMEBUFFER_BINDING);
  this.texture ||= g.createTexture();this.framebuffer ||= g.createFramebuffer();
  g.activeTexture(g.TEXTURE0+6);g.bindTexture(g.TEXTURE_2D,this.texture);
  for(const key of [g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,key,g.NEAREST);
  for(const key of [g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T])g.texParameteri(g.TEXTURE_2D,key,g.CLAMP_TO_EDGE);
  const half=g.getExtension('OES_texture_half_float'),colorHalf=g.getExtension('EXT_color_buffer_half_float');
  const candidates=[];
  if(half&&colorHalf)candidates.push({type:half.HALF_FLOAT_OES,format:'rgba16f',encoded:false});
  if(g.getExtension('OES_texture_float')&&g.getExtension('WEBGL_color_buffer_float'))candidates.push({type:g.FLOAT,format:'rgba32f',encoded:false});
  candidates.push({type:g.UNSIGNED_BYTE,format:'rgba8-log',encoded:true});
  let complete=false;
  try{
   for(const candidate of candidates){
    g.texImage2D(g.TEXTURE_2D,0,g.RGBA,size.width,size.height,0,g.RGBA,candidate.type,null);
    g.bindFramebuffer(g.FRAMEBUFFER,this.framebuffer);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,this.texture,0);
    if(g.checkFramebufferStatus(g.FRAMEBUFFER)===g.FRAMEBUFFER_COMPLETE){Object.assign(this,size,candidate);complete=true;break;}
   }
  }finally{g.bindFramebuffer(g.FRAMEBUFFER,previous);g.activeTexture(g.TEXTURE0);}
  if(!complete){this.supported=false;this.error='Cloud framebuffer allocation failed; using bounded full-frame clouds.';}
  this.key=null;return complete;
 }
 update({size,quality,key,quad,vectors,floats}){
  if(!this.supported)return false;
  try{
   if(!this.allocate(size))return false;
   if(this.key===key)return true;
   if(!this.programs.has(quality))this.programs.set(quality,this.compile(this.gl,VERTEX,fragment(quality)));
   const g=this.gl,p=this.programs.get(quality),previous=g.getParameter(g.FRAMEBUFFER_BINDING),viewport=g.getParameter(g.VIEWPORT);
   const depth=g.isEnabled(g.DEPTH_TEST),blend=g.isEnabled(g.BLEND),dither=g.isEnabled(g.DITHER);
   try{
    g.bindFramebuffer(g.FRAMEBUFFER,this.framebuffer);g.viewport(0,0,this.width,this.height);g.disable(g.DEPTH_TEST);g.disable(g.BLEND);g.disable(g.DITHER);g.useProgram(p);
    g.bindBuffer(g.ARRAY_BUFFER,quad);const a=g.getAttribLocation(p,'aPosition');g.enableVertexAttribArray(a);g.vertexAttribPointer(a,2,g.FLOAT,false,0,0);
    for(const [n,v]of Object.entries(vectors))this.uniform(p,n,'uniform3fv',v);
    for(const [n,v]of Object.entries({...floats,uCloudEncoded:this.encoded?1:0}))this.uniform(p,n,'uniform1f',v);
    this.bindTransport(p);g.drawArrays(g.TRIANGLES,0,6);g.disableVertexAttribArray(a);
    this.draws++;this.key=key;
   }finally{g.bindFramebuffer(g.FRAMEBUFFER,previous);g.viewport(...viewport);if(depth)g.enable(g.DEPTH_TEST);if(blend)g.enable(g.BLEND);if(dither)g.enable(g.DITHER);g.activeTexture(g.TEXTURE0);}
   return true;
  }catch(error){this.supported=false;this.error='Separate cloud pass failed: '+String(error.message).slice(0,180);return false;}
 }
 bind(p){
  const g=this.gl;g.activeTexture(g.TEXTURE0+6);g.bindTexture(g.TEXTURE_2D,this.texture);
  this.uniform(p,'uCloudBuffer','uniform1i',6);this.uniform(p,'uCloudBufferSize','uniform2fv',[this.width,this.height]);
  this.uniform(p,'uUseCloudBuffer','uniform1f',1);this.uniform(p,'uCloudEncoded','uniform1f',this.encoded?1:0);g.activeTexture(g.TEXTURE0);
 }
 size(width,height,dpr,settings){return cloudPreviewResolution(width,height,dpr,settings);}
 dispose(){const g=this.gl;if(!g.isContextLost()){if(this.texture)g.deleteTexture(this.texture);if(this.framebuffer)g.deleteFramebuffer(this.framebuffer);for(const p of this.programs.values())g.deleteProgram(p);}this.texture=this.framebuffer=null;this.programs.clear();this.key=null;}
}
