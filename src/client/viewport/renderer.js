import { cameraBasis, viewProjection, sunDirection, clamp } from './camera.js';
import { REFERENCE_TYPES, shapeGeometry, outlineGeometry } from './reference-geometry.js';
import { rotationMatrix3, scaleVector } from './transform-math.js';
import { cloudPreviewSettings, cloudUniforms, cloudPreviewResolution, volumetricCloudFunctions } from './volumetric-clouds.js';

const SKY_VERTEX = `attribute vec2 aPosition; varying vec2 vNdc;
void main(){vNdc=aPosition;gl_Position=vec4(aPosition,0.9999,1.0);}`;
const SKY_CLOUD_LAYER = ` if(rd.z>0.01 && ro.z<uAltitude && uCoverage>0.001){
   vec2 p=(ro+rd*((uAltitude-ro.z)/rd.z)).xy/850.0;
   p+=vec2(sin(uWindDirection),cos(uWindDirection))*uTime*(uWindSpeed/3.6)/850.0;
   float n=fbm(p)-uErosion*0.18*noise(p*9.0);
   float cloud=smoothstep(1.0-uCoverage-0.12,1.0-uCoverage+0.12,n);
   cloud*=clamp(uDensity*1.4,0.0,1.0)*smoothstep(0.01,0.10,rd.z);
   vec3 shade=mix(vec3(0.14,0.18,0.25),vec3(0.9,0.91,0.94),n*(0.7+uDetail*0.3));
   sky=mix(sky,shade*max(0.05,daylight),cloud);
 }`;
const SKY_FRAGMENT = `precision highp float;
varying vec2 vNdc;
uniform vec3 uEye,uForward,uRight,uUp,uSun,uSunTint,uSkyAmbient;
uniform float uAspect,uTan,uDistance,uOrtho,uExposure,uSunRadius,uIntensity;
uniform float uCoverage,uDensity,uAltitude,uErosion,uDetail,uCloudKind,uTime,uWindSpeed,uWindDirection,uHaze,uThickness,uCloudDistance,uContrast,uSaturation,uTurbidity,uRayleigh,uMie,uMieG,uOzone;
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
vec3 display(vec3 c){c=max(c,vec3(0))*uExposure;c=c/(1.0+c);c=mix(vec3(dot(c,vec3(0.2126,0.7152,0.0722))),c,uSaturation);c=max((c-0.5)*uContrast+0.5,vec3(0));return mix(12.92*c,1.055*pow(c,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}
vec3 scatteringPreview(vec3 rd,float daylight){
 // RGB single-scattering approximation for interactive manual directions.
 // The cached spectral LUT takes precedence when its inputs match the scene.
 float mu=clamp(dot(rd,uSun),-1.0,1.0),g=clamp(uMieG,-0.95,0.95);
 float phaseR=0.0596831*(1.0+mu*mu);
 float phaseM=(1.0-g*g)/(4.0*PI*pow(max(0.01,1.0+g*g-2.0*g*mu),1.5));
 vec3 ray=vec3(0.050,0.105,0.245)*max(0.0,uRayleigh/2.8);
 vec3 aerosol=vec3(0.85,1.0,1.27)*max(0.001,(uTurbidity-1.0)*0.035+uMie*6.0);
 vec3 gas=vec3(0.025,0.035,0.001)*max(0.0,uOzone/0.6);
 float path=1.0/max(0.035,rd.z);
 vec3 tau=ray+aerosol;
 vec3 scatter=(1.0-exp(-tau*path))*(ray*phaseR+aerosol*phaseM)/max(tau,vec3(0.0001));
 vec3 sunlight=sqrt(max(uSunTint,vec3(0)));
 vec3 sky=scatter*sunlight*exp(-gas*path*0.5)*6.0*uIntensity;
 // Bounded indirect-light approximation; not a multiple-scattering solver.
 sky+=ray*daylight*(0.7+0.35*(1.0-max(0.0,rd.z)))*uIntensity;
 sky=mix(sky,uSkyAmbient*2.0,clamp(uHaze*0.18,0.0,0.6));
 return sky+vec3(0.001,0.002,0.006)*(1.0-daylight);
}
void main(){
 vec3 off=uRight*vNdc.x*uAspect*uTan+uUp*vNdc.y*uTan;
 vec3 ro=uEye+off*uDistance*uOrtho;
 vec3 rd=normalize(uForward+off*(1.0-uOrtho));
 float daylight=smoothstep(-0.15,0.15,uSun.z);
 vec3 sky=scatteringPreview(rd,daylight);
 // No extra Rayleigh/Mie/ozone tint is applied over the evaluated LUT.
 if(uHasLut>0.5)sky=sampleSky(rd)*uIntensity;
 float disc=smoothstep(cos(uSunRadius*1.08),cos(uSunRadius*0.92),dot(rd,uSun));
 if(rd.z>=0.0&&uSun.z>=0.0)sky+=uSunTint*disc*uIntensity*8.0;
 ${SKY_CLOUD_LAYER}
 if(rd.z<0.0)sky=mix(uSkyAmbient*0.18,sky,exp(rd.z*12.0));
 gl_FragColor=vec4(display(sky),1.0);
}`;
const MESH_VERTEX = `attribute vec3 aPosition,aNormal,aColor;uniform mat4 uVP;uniform mat3 uRotation;uniform vec3 uOffset,uSize;varying vec3 vNormal,vColor,vWorld;
void main(){vNormal=uRotation*(aNormal/uSize);vColor=aColor;vWorld=uRotation*(aPosition*uSize)+uOffset;gl_Position=uVP*vec4(vWorld,1);}`;
const MESH_FRAGMENT = `precision mediump float;varying vec3 vNormal,vColor,vWorld;uniform vec3 uSun,uSunTint,uSkyAmbient;uniform float uExposure,uIntensity,uLines,uContrast,uSaturation;
void main(){vec3 normal=normalize(vNormal);if(!gl_FrontFacing)normal=-normal;float diffuse=max(0.0,dot(normal,uSun));float hemisphere=0.45+0.55*max(0.0,normal.z);vec3 c=vColor*(uSkyAmbient*hemisphere+diffuse*uIntensity*uSunTint*0.5);if(uLines>0.5)c=vColor;c=max(c,vec3(0))*uExposure/(1.0+max(c,vec3(0))*uExposure);c=mix(vec3(dot(c,vec3(0.2126,0.7152,0.0722))),c,uSaturation);c=max((c-0.5)*uContrast+0.5,vec3(0));gl_FragColor=vec4(mix(12.92*c,1.055*pow(c,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c)),1);}`;

function cloudShadowFragment() {
  // A two-sample Sun ray through the same animated density field. This is a
  // bounded cloud-shadow preview, independent of quality and mesh complexity.
  const density = volumetricCloudFunctions('low').split('vec3 marchClouds(')[0];
  const shadow = `uniform float uCoverage,uDensity,uAltitude,uThickness,uErosion,uDetail,uCloudKind,uTime,uWindSpeed,uWindDirection,uCloudDistance;
${density}
float cloudShadow(vec3 point){
 if(uSun.z<=0.001||uCoverage<0.001||uDensity<0.001||point.z>=uAltitude+uThickness)return 1.0;
 float nearT=max(0.0,(uAltitude-point.z)/uSun.z),farT=min(uCloudDistance,(uAltitude+uThickness-point.z)/uSun.z);
 if(farT<=nearT)return 1.0;
 float stepSize=(farT-nearT)/2.0,depth=0.0;
 for(int i=0;i<2;i++)depth+=cloudDensity(point+uSun*(nearT+(float(i)+0.5)*stepSize))*stepSize;
 return exp(-depth*0.004);
}
`;
  return MESH_FRAGMENT.replace('precision mediump float', 'precision highp float').replace('void main(){', shadow + '\nvoid main(){').replace('diffuse*uIntensity*uSunTint*0.5', 'diffuse*cloudShadow(vWorld)*uIntensity*uSunTint*0.5');
}

function volumeFragment(quality) {
  // Render the lower hemisphere first; an elevated camera may see clouds below.
  const volume=SKY_FRAGMENT.replace(SKY_CLOUD_LAYER,'').replace('void main(){',volumetricCloudFunctions(quality)+'\nvoid main(){');
  return volume.replace('gl_FragColor=vec4(display(sky),1.0);','sky=marchClouds(sky,ro,rd,daylight);\n gl_FragColor=vec4(display(sky),1.0);');
}
const identityRotation = new Float32Array([1,0,0,0,1,0,0,0,1]);
const finite = (value,fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

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

export function lutMatchesAtmosphere(payload,atmosphere={},baseline=null){
  // The legacy host and Core expose different optical controls. Preserve the
  // evaluated baseline instead of inventing a conversion between their knobs.
  if(baseline){
    const keys=new Set([...Object.keys(baseline),...Object.keys(atmosphere)]);
    for(const key of keys)if(JSON.stringify(baseline[key])!==JSON.stringify(atmosphere[key]))return false;
  }
  const input=payload?.input;if(!input)return true;
  for(const key of ['aerosolOpticalDepth550','mieAsymmetry','ozoneDobsonUnits','angstromExponent','aerosolSingleScatteringAlbedo','groundAlbedo','precipitableWaterCm','multipleScatteringOrders','pressureHpa','temperatureC']){
    if(atmosphere[key]!==undefined&&input[key]!==undefined){const value=Number(atmosphere[key]);if(!Number.isFinite(value)||Math.abs(Number(input[key])-value)>1e-5)return false;}
  }
  return true;
}
export function previewSunTint(sun={},atmosphere={}){
  // Relative RGB transport for preview lighting, not calibrated irradiance.
  const elevation=clamp(finite(sun.elevation,7),-90,90);
  if(elevation<=0)return [0,0,0];
  const zenith=90-elevation,airMass=Math.min(40,1/(Math.sin(elevation*Math.PI/180)+0.50572*Math.pow(96.07995-zenith,-1.6364)));
  const warm=clamp((6500-finite(sun.temperature,5200))/6500,-0.7,0.7);
  const tint=[clamp(1+Math.min(0,warm)*0.2,0.5,1),clamp(1-Math.max(0,warm)*0.25,0.5,1),clamp(1-Math.max(0,warm)*0.7,0.35,1)];
  const rayScale=clamp(finite(atmosphere.rayleigh,2.8)/2.8,0,4);
  const aerosol=Math.max(0.001,(clamp(finite(atmosphere.turbidity,2.4),1,15)-1)*0.035+clamp(finite(atmosphere.mieCoefficient,0.005),0,0.1)*6);
  const ozone=Math.max(0,finite(atmosphere.ozone,0.6)/0.6);
  return tint.map((v,i)=>v*Math.exp(-airMass*([0.050,0.105,0.245][i]*rayScale+[0.85,1,1.27][i]*aerosol+[0.025,0.035,0.001][i]*ozone)));
}
export function skyAmbientFromLut(lut){
  const width=Number(lut?.layout?.width),height=Number(lut?.layout?.height),pixels=lut?.pixels;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>256||height>128||!Array.isArray(pixels))return null;
  const stride=Array.isArray(lut.layout.channels)?lut.layout.channels.length:pixels.length/(width*height);
  if(stride<3||!Number.isInteger(stride)||pixels.length<width*height*stride)return null;
  const sum=[0,0,0];let total=0;
  for(let y=0;y<height;y++){
    const theta=(y+0.5)/height*Math.PI/2,weight=Math.sin(theta)*Math.cos(theta);
    for(let x=0;x<width;x++){for(let c=0;c<3;c++)sum[c]+=Math.max(0,finite(pixels[(y*width+x)*stride+c],0))*weight;total+=weight;}
  }
  return sum.map(v=>v/total);
}

export class SkyViewportRenderer {
  constructor(canvas) {
    this.canvas=canvas;this.resources=[];this.frames=0;this.hasLut=false;this.cloudPrograms=new Map();this.cloudFailures=new Map();this.locations=new Map();this.cloudSettings=cloudPreviewSettings();
    const gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
    if(!gl)throw new Error('WebGL unavailable. The legacy viewport remains available.');
    this.gl=gl;
    try {
      const precision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);
      this.volumeSupported=Boolean(precision&&precision.precision>=16);
      this.sky=program(gl,SKY_VERTEX,this.volumeSupported?SKY_FRAGMENT:SKY_FRAGMENT.replace('precision highp float','precision mediump float'));this.baseMesh=program(gl,MESH_VERTEX,MESH_FRAGMENT);this.mesh=this.baseMesh;
      if(!this.volumeSupported)this.cloudFallbackReason='Volumetric preview requires high precision fragment shaders. Showing the cloud layer.';
      this.floatTexture=Boolean(gl.getExtension('OES_texture_float'));
      this.quad=this.buffer(new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]));
      const sphere=sphereGeometry(),grid=gridGeometry();
      this.sphere=this.buffer(sphere);this.sphereCount=sphere.length/9;
      this.grid=this.buffer(grid);this.gridCount=grid.length/9;
      this.referenceMeshes=new Map();
      for(const type of REFERENCE_TYPES){
        const triangles=shapeGeometry(type),outline=outlineGeometry(type);
        this.referenceMeshes.set(type,{buffer:this.buffer(triangles),count:triangles.length/9,
          outline:this.buffer(outline),outlineCount:outline.length/9});
      }
      this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
      this.lutSize=[1,1];
    }catch(error){this.dispose();throw error;}
  }
  buffer(data){const g=this.gl,b=g.createBuffer();this.resources.push(b);g.bindBuffer(g.ARRAY_BUFFER,b);g.bufferData(g.ARRAY_BUFFER,data,g.STATIC_DRAW);return b;}
  uniform(p,name,type,value){
    let cache=this.locations.get(p);if(!cache){cache=new Map();this.locations.set(p,cache);}
    let loc=cache.get(name);
    if(loc===undefined){loc=this.gl.getUniformLocation(p,name);cache.set(name,loc);}
    this.gl[type](loc,value);
  }
  shadowMesh() {
    if (!this.cloudMesh && !this.shadowFailure) {
      try { this.cloudMesh=program(this.gl,MESH_VERTEX,cloudShadowFragment()); }
      catch (error) { this.shadowFailure=error.message || 'Cloud shadow shader unavailable'; }
    }
    return this.cloudMesh || this.baseMesh;
  }
  cloudProgram(settings){
    if(settings.mode==='layer'){this.cloudFallbackReason=null;return this.sky;}
    if(!this.volumeSupported){this.cloudFallbackReason='Volumetric preview requires high precision fragment shaders. Showing the cloud layer.';return this.sky;}
    if(this.cloudPrograms.has(settings.quality)){this.cloudFallbackReason=this.cloudFailures.get(settings.quality)||null;return this.cloudPrograms.get(settings.quality)||this.sky;}
    try{
      const shader=program(this.gl,SKY_VERTEX,volumeFragment(settings.quality));
      this.cloudPrograms.set(settings.quality,shader);this.cloudFallbackReason=null;return shader;
    }catch(error){
      this.cloudPrograms.set(settings.quality,null);
      this.cloudFallbackReason='Volumetric preview could not compile on this WebGL device. Showing the cloud layer. '+String(error.message).slice(0,160);this.cloudFailures.set(settings.quality,this.cloudFallbackReason);
      return this.sky;
    }
  }
  setLut(payload,atmosphere){
    const packed=packLut(payload?.skyViewLut,this.floatTexture);
    this.hasLut=Boolean(packed);this.payload=payload;this.lutAtmosphere=atmosphere?{...atmosphere}:this.lastAtmosphere?{...this.lastAtmosphere}:null;
    this.lutAmbient=skyAmbientFromLut(payload?.skyViewLut);
    if(!packed)return;
    const g=this.gl;g.bindTexture(g.TEXTURE_2D,this.texture);
    g.texImage2D(g.TEXTURE_2D,0,g.RGBA,packed.width,packed.height,0,g.RGBA,this.floatTexture?g.FLOAT:g.UNSIGNED_BYTE,packed.data);
    this.lutSize=[packed.width,packed.height];
  }
  resize(width,height,dpr=1){
    this.cssSize={width,height,dpr};
    const settings=this.cloudSettings.mode==='layer'?{maxPixels:1e6,maxDpr:1.5}:this.cloudSettings;
    const size=cloudPreviewResolution(width,height,dpr,settings);
    if(this.canvas.width!==size.width)this.canvas.width=size.width;
    if(this.canvas.height!==size.height)this.canvas.height=size.height;
  }
  draw(state,camera){
    const gl=this.gl;if(gl.isContextLost())return;
    const started=performance.now();this.frames++;
    this.cloudSettings=cloudPreviewSettings(state);
    this.lastAtmosphere={...(state.atmosphere||{})};if(this.hasLut&&!this.lutAtmosphere)this.lutAtmosphere={...this.lastAtmosphere};
    if(this.cssSize)this.resize(this.cssSize.width,this.cssSize.height,this.cssSize.dpr);
    const skyProgram=this.cloudProgram(this.cloudSettings);
    const aspect=this.canvas.width/this.canvas.height, fov=Number(state.camera?.fov)||60;
    const basis=cameraBasis(camera),sun=sunDirection(state.sun);
    const exposure=clamp(finite(state.camera?.exposure,1)*Math.pow(2,clamp(finite(state.color?.exposure,0),-10,10)),0.001,1000), intensity=clamp(Number(state.sun?.intensity)||0,0,100);
    const contrast=clamp(finite(state.color?.contrast,1),0,4),saturation=clamp(finite(state.color?.saturation,1),0,4);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.disable(gl.DEPTH_TEST);
    gl.useProgram(skyProgram);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    const attr=gl.getAttribLocation(skyProgram,'aPosition');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
    const u=(n,t,v)=>this.uniform(skyProgram,n,t,v);
    this.usingLut=this.hasLut&&lutMatchesSun(this.payload,state.sun)&&lutMatchesAtmosphere(this.payload,state.atmosphere,this.lutAtmosphere);
    const direct=previewSunTint(state.sun,state.atmosphere);
    const daylight=clamp((sun[2]+0.1)/0.2,0,1);
    const ambient=this.usingLut&&this.lutAmbient?this.lutAmbient.map(value=>value*intensity):[0.12*daylight*intensity+0.001,0.19*daylight*intensity+0.002,0.32*daylight*intensity+0.004];
    for(const [n,v] of Object.entries({uEye:basis.eye,uForward:basis.forward,uRight:basis.right,uUp:basis.up,uSun:sun,uSunTint:direct,uSkyAmbient:ambient}))u(n,'uniform3fv',v);
    for(const [n,v] of Object.entries({uAspect:aspect,uTan:Math.tan(clamp(fov,15,120)*Math.PI/360),uDistance:camera.distance,uOrtho:camera.projection==='orthographic'?1:0,uExposure:exposure,uContrast:contrast,uSaturation:saturation,uSunRadius:clamp(Number(state.sun?.angularDiameter)||0.53,0.01,10)*Math.PI/360,uIntensity:intensity,...cloudUniforms(state),uTurbidity:clamp(finite(state.atmosphere?.turbidity,2.4),1,15),uRayleigh:clamp(finite(state.atmosphere?.rayleigh,2.8),0,10),uMie:clamp(finite(state.atmosphere?.mieCoefficient,0.005),0,0.1),uMieG:clamp(finite(state.atmosphere?.mieDirectionalG,0.8),-0.99,0.99),uOzone:clamp(finite(state.atmosphere?.ozone,0.6),0,3),uHaze:Math.max(0,Number(state.atmosphere?.haze)||0),uHasLut:this.usingLut?1:0}))u(n,'uniform1f',v);
    u('uLutSize','uniform2fv',this.lutSize);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);u('uLut','uniform1i',0);
    gl.drawArrays(gl.TRIANGLES,0,6);gl.disableVertexAttribArray(attr);
    this.mesh=skyProgram!==this.sky?this.shadowMesh():this.baseMesh;
    gl.enable(gl.DEPTH_TEST);gl.useProgram(this.mesh);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.mesh,'uVP'),false,viewProjection(camera,aspect,fov));
    this.uniform(this.mesh,'uSun','uniform3fv',sun);this.uniform(this.mesh,'uSunTint','uniform3fv',direct);this.uniform(this.mesh,'uSkyAmbient','uniform3fv',ambient);this.uniform(this.mesh,'uExposure','uniform1f',exposure);this.uniform(this.mesh,'uIntensity','uniform1f',intensity);this.uniform(this.mesh,'uContrast','uniform1f',contrast);this.uniform(this.mesh,'uSaturation','uniform1f',saturation);
    if(this.mesh===this.cloudMesh)for(const [name,value] of Object.entries(cloudUniforms(state)))this.uniform(this.mesh,name,'uniform1f',value);
    if(state.viewport?.grid!==false)this.drawMesh(this.grid,this.gridCount,gl.LINES,true);
    if(state.viewport?.referenceSphere!==false)this.drawMesh(this.sphere,this.sphereCount,gl.TRIANGLES,false);
    const objects=state.scene?.referenceObjects||{};
    for(const object of Object.values(objects)){
      const mesh=this.referenceMeshes.get(object?.type);if(!mesh||object.visible===false)continue;
      const position=[0,1,2].map(i=>Number.isFinite(Number(object.position?.[i]))?Number(object.position[i]):0);
      const scale=scaleVector(object),rotation=rotationMatrix3(object.rotation);
      // Fill offset keeps a coplanar selection outline stable at every scale.
      gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);
      this.drawMesh(mesh.buffer,mesh.count,gl.TRIANGLES,false,position,scale,rotation);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    const selected=objects[state.scene?.selectedReferenceId],mesh=this.referenceMeshes.get(selected?.type);
    if(mesh&&selected.visible!==false){
      const position=[0,1,2].map(i=>Number.isFinite(Number(selected.position?.[i]))?Number(selected.position[i]):0);
      const scale=scaleVector(selected),rotation=rotationMatrix3(selected.rotation);
      gl.depthFunc(gl.LEQUAL);this.drawMesh(mesh.outline,mesh.outlineCount,gl.LINES,true,position,scale,rotation);gl.depthFunc(gl.LESS);
    }
    this.frameTimeMs=performance.now()-started;
    this.cloudMetrics={mode:skyProgram===this.sky?'layer':'volumetric',quality:this.cloudSettings.quality,samples:skyProgram===this.sky?0:this.cloudSettings.samples,shadowSamples:skyProgram===this.sky?0:this.cloudSettings.shadowSamples,cloudShadows:this.mesh===this.cloudMesh,width:this.canvas.width,height:this.canvas.height,pixels:this.canvas.width*this.canvas.height,frameTimeMs:this.frameTimeMs};
  }
  drawMesh(buffer,count,mode,lines,offset=[0,0,0],scale=[1,1,1],rotation=identityRotation){
    const g=this.gl;g.bindBuffer(g.ARRAY_BUFFER,buffer);const enabled=[];
    for(const [i,n] of ['aPosition','aNormal','aColor'].entries()){
      const a=g.getAttribLocation(this.mesh,n);g.enableVertexAttribArray(a);g.vertexAttribPointer(a,3,g.FLOAT,false,36,i*12);enabled.push(a);
    }
    this.uniform(this.mesh,'uOffset','uniform3fv',offset);this.uniform(this.mesh,'uSize','uniform3fv',scale);g.uniformMatrix3fv(g.getUniformLocation(this.mesh,'uRotation'),false,rotation);
    this.uniform(this.mesh,'uLines','uniform1f',lines?1:0);g.drawArrays(mode,0,count);enabled.forEach(a=>g.disableVertexAttribArray(a));
  }
  dispose(){
    const g=this.gl;
    if(g&&!g.isContextLost()){
      // A current program stays alive after deleteProgram until it is unbound.
      g.useProgram(null);
      this.resources.forEach(b=>g.deleteBuffer(b));
      if(this.texture)g.deleteTexture(this.texture);
      if(this.sky)g.deleteProgram(this.sky);
      for(const p of this.cloudPrograms.values())if(p)g.deleteProgram(p);
      for(const p of new Set([this.baseMesh,this.cloudMesh]))if(p)g.deleteProgram(p);
    }
    this.resources=[];this.cloudPrograms.clear();this.cloudFailures.clear();this.locations.clear();this.texture=null;this.sky=null;this.mesh=null;this.baseMesh=null;this.cloudMesh=null;
  }
}
