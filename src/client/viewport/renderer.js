import { cameraBasis, viewProjection, sunDirection, clamp } from './camera.js';

const SKY_VERTEX = `attribute vec2 aPosition; varying vec2 vNdc;
void main(){vNdc=aPosition;gl_Position=vec4(aPosition,0.9999,1.0);}`;
const SKY_FRAGMENT = `precision highp float;
varying vec2 vNdc;
uniform vec3 uEye,uForward,uRight,uUp,uSun;
uniform float uAspect,uTan,uDistance,uOrtho,uExposure,uSunRadius,uIntensity;
uniform float uCoverage,uDensity,uAltitude,uErosion,uDetail,uTime,uWindSpeed,uWindDirection,uHaze;
uniform sampler2D uLut; uniform float uHasLut; uniform vec2 uLutSize;
const float PI=3.14159265359;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float n=0.0,a=0.5;for(int i=0;i<4;i++){n+=noise(p)*a;p=p*2.07+13.2;a*=0.5;}return n;}
vec3 lutPixel(vec2 p){return texture2D(uLut,vec2((mod(p.x,uLutSize.x)+0.5)/uLutSize.x,(clamp(p.y,0.0,uLutSize.y-1.0)+0.5)/uLutSize.y)).rgb;}
vec3 sampleSky(vec3 rd){
 float az=mod(atan(rd.x,rd.y)+2.0*PI,2.0*PI);
 vec2 p=vec2(az/(2.0*PI),1.0-asin(clamp(rd.z,0.0,1.0))/(PI*0.5))*uLutSize-0.5;
 vec2 i=floor(p),f=fract(p);
 return mix(mix(lutPixel(i),lutPixel(i+vec2(1,0)),f.x),mix(lutPixel(i+vec2(0,1)),lutPixel(i+vec2(1,1)),f.x),f.y);
}
vec3 display(vec3 c){c=max(c,vec3(0))*uExposure;c=c/(1.0+c);return pow(c,vec3(1.0/2.2));}
void main(){
 vec3 off=uRight*vNdc.x*uAspect*uTan+uUp*vNdc.y*uTan;
 vec3 ro=uEye+off*uDistance*uOrtho;
 vec3 rd=normalize(uForward+off*(1.0-uOrtho));
 float daylight=smoothstep(-0.15,0.15,uSun.z);
 vec3 horizon=mix(vec3(0.012,0.016,0.03),vec3(0.52,0.67,0.86),daylight);
 vec3 zenith=mix(vec3(0.001,0.002,0.009),vec3(0.055,0.19,0.48),daylight);
 vec3 sky=mix(horizon,zenith,pow(max(rd.z,0.0),0.45));
 sky=mix(sky,horizon,clamp(uHaze*0.25,0.0,0.7));
 if(uHasLut>0.5&&rd.z>=0.0)sky=sampleSky(rd);
 float disc=smoothstep(cos(uSunRadius*1.08),cos(uSunRadius*0.92),dot(rd,uSun));
 if(rd.z>=0.0&&uSun.z>=0.0)sky+=vec3(1.0,0.88,0.65)*disc*uIntensity*8.0;
 if(rd.z>0.01 && ro.z<uAltitude && uCoverage>0.001){
   vec2 p=(ro+rd*((uAltitude-ro.z)/rd.z)).xy/850.0;
   p+=vec2(sin(uWindDirection),cos(uWindDirection))*uTime*uWindSpeed/850.0;
   float n=fbm(p)-uErosion*0.18*noise(p*9.0);
   float cloud=smoothstep(1.0-uCoverage-0.12,1.0-uCoverage+0.12,n);
   cloud*=clamp(uDensity*1.4,0.0,1.0)*smoothstep(0.01,0.10,rd.z);
   vec3 shade=mix(vec3(0.14,0.18,0.25),vec3(0.9,0.91,0.94),n*(0.7+uDetail*0.3));
   sky=mix(sky,shade*max(0.05,daylight),cloud);
 }
 if(rd.z<0.0)sky=mix(vec3(0.025,0.03,0.04),horizon,exp(rd.z*12.0));
 gl_FragColor=vec4(display(sky),1.0);
}`;
const MESH_VERTEX = `attribute vec3 aPosition,aNormal,aColor;uniform mat4 uVP;varying vec3 vNormal,vColor;
void main(){vNormal=aNormal;vColor=aColor;gl_Position=uVP*vec4(aPosition,1);}`;
const MESH_FRAGMENT = `precision mediump float;varying vec3 vNormal,vColor;uniform vec3 uSun;uniform float uExposure,uIntensity,uLines;
void main(){float diffuse=max(0.0,dot(normalize(vNormal),uSun));vec3 c=vColor*(0.2+diffuse*uIntensity*0.5);if(uLines>0.5)c=vColor;c=c*uExposure/(1.0+c*uExposure);gl_FragColor=vec4(pow(c,vec3(1.0/2.2)),1);}`;

function program(gl, vertex, fragment) {
  const shaders=[]; let p;
  try {
    for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
      const s=gl.createShader(type); shaders.push(s); gl.shaderSource(s,source); gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||'Shader compilation failed');
    }
    p=gl.createProgram(); shaders.forEach(s=>gl.attachShader(p,s)); gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)||'Shader link failed');
    return p;
  } catch(error){if(p)gl.deleteProgram(p);throw error;}
  finally{shaders.forEach(s=>gl.deleteShader(s));}
}
function sphereGeometry() {
  const out=[];
  const point=(a,b)=>[Math.sin(b)*Math.cos(a),Math.sin(b)*Math.sin(a),Math.cos(b)];
  const push=n=>out.push(n[0]*1.2,n[1]*1.2,n[2]*1.2+1.2,...n,0.4,0.4,0.4);
  for(let y=0;y<16;y++)for(let x=0;x<24;x++){
    const a=x/24*Math.PI*2,b=y/16*Math.PI,c=(x+1)/24*Math.PI*2,d=(y+1)/16*Math.PI;
    [point(a,b),point(a,d),point(c,d),point(a,b),point(c,d),point(c,b)].forEach(push);
  }
  return new Float32Array(out);
}
function gridGeometry(){
  const out=[], push=(x,y,c)=>out.push(x,y,0,0,0,1,...c);
  for(let i=-50;i<=50;i++){
    const gray=i%5===0?[0.14,0.17,0.2]:[0.06,0.08,0.1];
    const x=i===0?[0.65,0.04,0.035]:gray, y=i===0?[0.035,0.5,0.1]:gray;
    push(-50,i,x);push(50,i,x);push(i,-50,y);push(i,50,y);
  }
  return new Float32Array(out);
}
export function packLut(lut, floating=true){
  const width=Number(lut?.layout?.width),height=Number(lut?.layout?.height);
  const pixels=lut?.pixels;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>256||height>128||!Array.isArray(pixels))return null;
  const stride=Array.isArray(lut.layout.channels)?lut.layout.channels.length:pixels.length/(width*height);
  if(stride<3||!Number.isInteger(stride)||pixels.length<width*height*stride)return null;
  const data=floating?new Float32Array(width*height*4):new Uint8Array(width*height*4);
  for(let i=0;i<width*height;i++){
    for(let c=0;c<3;c++){const v=Number(pixels[i*stride+c]);data[i*4+c]=floating?Math.max(0,Number.isFinite(v)?v:0):Math.round(clamp(Number.isFinite(v)?v:0,0,1)*255);}
    data[i*4+3]=floating?1:255;
  }
  return {width,height,data};
}
export function lutMatchesSun(payload,sun){
  const solar=payload?.evaluation?.solarPosition||payload?.skyViewLut?.solarPosition;
  if(!solar)return false;
  const a=sunDirection(sun), b=sunDirection({elevation:solar.apparentElevationDeg,azimuth:solar.azimuthDeg});
  return a.reduce((s,v,i)=>s+v*b[i],0)>Math.cos(0.5*Math.PI/180);
}

export class SkyViewportRenderer {
  constructor(canvas) {
    this.canvas=canvas;this.resources=[];this.frames=0;this.hasLut=false;
    const gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
    if(!gl)throw new Error('WebGL unavailable. The legacy viewport remains available.');
    this.gl=gl;
    try {
      this.sky=program(gl,SKY_VERTEX,SKY_FRAGMENT);this.mesh=program(gl,MESH_VERTEX,MESH_FRAGMENT);
      this.floatTexture=Boolean(gl.getExtension('OES_texture_float'));
      this.quad=this.buffer(new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]));
      const sphere=sphereGeometry(),grid=gridGeometry();
      this.sphere=this.buffer(sphere);this.sphereCount=sphere.length/9;
      this.grid=this.buffer(grid);this.gridCount=grid.length/9;
      this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
      this.lutSize=[1,1];this.locations=new Map();
    }catch(error){this.dispose();throw error;}
  }
  buffer(data){const g=this.gl,b=g.createBuffer();this.resources.push(b);g.bindBuffer(g.ARRAY_BUFFER,b);g.bufferData(g.ARRAY_BUFFER,data,g.STATIC_DRAW);return b;}
  uniform(p,name,type,value){
    const key=(p===this.sky?'s':'m')+name;let loc=this.locations.get(key);
    if(loc===undefined){loc=this.gl.getUniformLocation(p,name);this.locations.set(key,loc);}
    this.gl[type](loc,value);
  }
  setLut(payload){
    const packed=packLut(payload?.skyViewLut,this.floatTexture);
    this.hasLut=Boolean(packed);this.payload=payload;
    if(!packed)return;
    const g=this.gl;g.bindTexture(g.TEXTURE_2D,this.texture);
    g.texImage2D(g.TEXTURE_2D,0,g.RGBA,packed.width,packed.height,0,g.RGBA,this.floatTexture?g.FLOAT:g.UNSIGNED_BYTE,packed.data);
    this.lutSize=[packed.width,packed.height];
  }
  resize(width,height,dpr=1){
    // Bound Retina cost on integrated GPUs; balanced is at most 1 megapixel.
    const scale=Math.min(dpr,1.5,Math.sqrt(1e6/Math.max(1,width*height)));
    const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
    if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;
  }
  draw(state,camera){
    const gl=this.gl;if(gl.isContextLost())return;
    this.frames++;
    const aspect=this.canvas.width/this.canvas.height, fov=Number(state.camera?.fov)||60;
    const basis=cameraBasis(camera),sun=sunDirection(state.sun),clouds=state.clouds||{};
    const exposure=clamp(Number(state.camera?.exposure)||1,0.01,100), intensity=clamp(Number(state.sun?.intensity)||0,0,100);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.sky);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    const attr=gl.getAttribLocation(this.sky,'aPosition');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
    const u=(n,t,v)=>this.uniform(this.sky,n,t,v);
    for(const [n,v] of Object.entries({uEye:basis.eye,uForward:basis.forward,uRight:basis.right,uUp:basis.up,uSun:sun}))u(n,'uniform3fv',v);
    this.usingLut=this.hasLut&&lutMatchesSun(this.payload,state.sun);
    for(const [n,v] of Object.entries({uAspect:aspect,uTan:Math.tan(clamp(fov,15,120)*Math.PI/360),uDistance:camera.distance,uOrtho:camera.projection==='orthographic'?1:0,uExposure:exposure,uSunRadius:clamp(Number(state.sun?.angularDiameter)||0.53,0.01,10)*Math.PI/360,uIntensity:intensity,uCoverage:clamp(Number(clouds.coverage)||0,0,1),uDensity:clamp(Number(clouds.density)||0,0,1),uAltitude:Math.max(1,Number(clouds.altitude)||2400),uErosion:clamp(Number(clouds.erosion)||0,0,1),uDetail:clamp(Number(clouds.detail)||0,0,1),uTime:(Number(state.timeline?.currentFrame)||0)/Math.max(1,Number(state.timeline?.fps)||24),uWindSpeed:Number(clouds.windSpeed)||0,uWindDirection:(Number(clouds.windDirection)||0)*Math.PI/180,uHaze:Math.max(0,Number(state.atmosphere?.haze)||0),uHasLut:this.usingLut?1:0}))u(n,'uniform1f',v);
    u('uLutSize','uniform2fv',this.lutSize);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);u('uLut','uniform1i',0);
    gl.drawArrays(gl.TRIANGLES,0,6);gl.disableVertexAttribArray(attr);
    gl.enable(gl.DEPTH_TEST);gl.useProgram(this.mesh);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.mesh,'uVP'),false,viewProjection(camera,aspect,fov));
    this.uniform(this.mesh,'uSun','uniform3fv',sun);this.uniform(this.mesh,'uExposure','uniform1f',exposure);this.uniform(this.mesh,'uIntensity','uniform1f',intensity);
    if(state.viewport?.grid!==false)this.drawMesh(this.grid,this.gridCount,gl.LINES,true);
    if(state.viewport?.referenceSphere!==false)this.drawMesh(this.sphere,this.sphereCount,gl.TRIANGLES,false);
  }
  drawMesh(buffer,count,mode,lines){
    const g=this.gl;g.bindBuffer(g.ARRAY_BUFFER,buffer);const enabled=[];
    for(const [i,n] of ['aPosition','aNormal','aColor'].entries()){
      const a=g.getAttribLocation(this.mesh,n);g.enableVertexAttribArray(a);g.vertexAttribPointer(a,3,g.FLOAT,false,36,i*12);enabled.push(a);
    }
    this.uniform(this.mesh,'uLines','uniform1f',lines?1:0);g.drawArrays(mode,0,count);enabled.forEach(a=>g.disableVertexAttribArray(a));
  }
  dispose(){const g=this.gl;if(!g||g.isContextLost()){this.resources=[];return;}this.resources.forEach(b=>g.deleteBuffer(b));this.resources=[];if(this.texture)g.deleteTexture(this.texture);if(this.sky)g.deleteProgram(this.sky);if(this.mesh)g.deleteProgram(this.mesh);}
}
