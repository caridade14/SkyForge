import { cameraBasis, viewProjection, sunDirection, clamp } from './camera.js';
import { REFERENCE_TYPES, shapeGeometry, outlineGeometry, objectRadius } from './reference-geometry.js';
import { rotationMatrix3, scaleVector } from './transform-math.js';
import { cloudPreviewSettings, cloudUniforms, cloudPreviewResolution, volumetricCloudFunctions } from './volumetric-clouds.js';
import { normalizeReferenceMaterial } from '../core/reference-material.js';
import { ObjectShadowMap, OBJECT_SHADOW_GLSL } from './object-shadows.js';
import { SkyReflectionProbe } from './sky-reflections.js';
import { AtmosphereTransport, blackbodyTint, encodeAtmosphereRGBM, opticalDepth } from './atmosphere-transport.js';
import { makeCloudNoise } from './cloud-noise.js';
import { CELESTIAL_UNIFORMS, CELESTIAL_GLSL, celestialUniforms, normalizeCelestial, starField } from './celestial-effects.js';


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
const TRANSPORT_UNIFORMS = `uniform sampler2D uIntegratedSky;uniform vec2 uIntegratedSize;uniform float uHasIntegrated,uIntegratedEncoded,uSunAzimuth;uniform vec3 uSunSourceColor;`;
const TRANSPORT_GLSL = `
vec3 transportPixel(vec2 p){
 vec4 color=texture2D(uIntegratedSky,vec2((mod(p.x,uIntegratedSize.x)+0.5)/uIntegratedSize.x,(clamp(p.y,0.0,uIntegratedSize.y-1.0)+0.5)/uIntegratedSize.y));
 return color.rgb*mix(1.0,color.a*32.0,uIntegratedEncoded);
}
vec3 integratedSky(vec3 rd){
 float az=mod(atan(rd.x,rd.y)-uSunAzimuth+2.0*PI,2.0*PI);
 float el=asin(clamp(rd.z,0.0,1.0))/(PI*0.5);
 vec2 p=vec2(az/(2.0*PI),1.0-sqrt(el))*uIntegratedSize-0.5,i=floor(p),f=fract(p);
 return mix(mix(transportPixel(i),transportPixel(i+vec2(1,0)),f.x),mix(transportPixel(i+vec2(0,1)),transportPixel(i+vec2(1,1)),f.x),f.y)*uSunSourceColor;
}
`;
const SKY_FRAGMENT = `precision highp float;
varying vec2 vNdc;
uniform vec3 uEye,uForward,uRight,uUp,uSun,uSunTint,uSkyAmbient;
uniform float uAspect,uTan,uDistance,uOrtho,uExposure,uSunRadius,uIntensity;
uniform float uCoverage,uDensity,uAltitude,uErosion,uDetail,uCloudKind,uTime,uWindSpeed,uWindDirection,uHaze,uThickness,uCloudDistance,uContrast,uSaturation,uTurbidity,uRayleigh,uMie,uMieG,uOzone;
uniform sampler2D uLut; uniform float uHasLut; uniform vec2 uLutSize;
${TRANSPORT_UNIFORMS}
${CELESTIAL_UNIFORMS}
const float PI=3.14159265359;
${TRANSPORT_GLSL}
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
vec3 display(vec3 c){c=max(c,vec3(0))*uExposure;c=c/(1.0+dot(c,vec3(0.2126,0.7152,0.0722)));c=c/max(1.0,max(max(c.r,c.g),c.b));c=mix(vec3(dot(c,vec3(0.2126,0.7152,0.0722))),c,uSaturation);c=max((c-0.5)*uContrast+0.5,vec3(0));return mix(12.92*c,1.055*pow(c,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}
vec3 scatteringPreview(vec3 rd,float daylight){
 if(uHasIntegrated>0.5)return integratedSky(rd)*uIntensity+vec3(.000015,.000025,.00006)*(1.0-daylight);
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
${CELESTIAL_GLSL}
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
 sky=celestialSky(sky,ro,rd);
 ${SKY_CLOUD_LAYER}
 if(rd.z<0.0)sky=mix(uSkyAmbient*0.18,sky,exp(rd.z*12.0));
 sky=addRainbow(sky,rd);
 gl_FragColor=vec4(display(sky),1.0);
}`;
const MESH_VERTEX = `attribute vec3 aPosition,aNormal,aColor;uniform mat4 uVP;uniform mat3 uRotation;uniform vec3 uOffset,uSize;varying vec3 vNormal,vColor,vWorld;
void main(){vNormal=uRotation*(aNormal/uSize);vColor=aColor;vWorld=uRotation*(aPosition*uSize)+uOffset;gl_Position=uVP*vec4(vWorld,1);}`;
const MESH_SKY = SKY_FRAGMENT.slice(SKY_FRAGMENT.indexOf('const float PI='), SKY_FRAGMENT.indexOf('vec3 celestialTransmission'));
const MESH_FRAGMENT = `precision mediump float;varying vec3 vNormal,vColor,vWorld;
uniform vec3 uSun,uSunTint,uSkyAmbient,uEye,uForward,uBaseColor;
uniform float uExposure,uIntensity,uLines,uContrast,uSaturation,uRoughness,uMetalness,uOrtho;
uniform vec3 uMoonAmbient,uAerialExtinction;uniform float uAerialStrength;
uniform float uHasLut,uRayleigh,uTurbidity,uMie,uMieG,uOzone,uHaze;uniform vec2 uLutSize;uniform sampler2D uLut;
uniform sampler2D uReflectionProbe;uniform float uHasReflectionProbe;
${TRANSPORT_UNIFORMS}
${MESH_SKY}
${OBJECT_SHADOW_GLSL}
vec3 environment(vec3 direction){
 if(uHasReflectionProbe>0.5){
  float az=mod(atan(direction.x,direction.y)+2.0*PI,2.0*PI);
  vec4 color=texture2D(uReflectionProbe,vec2(az/(2.0*PI),0.5+asin(clamp(direction.z,-1.0,1.0))/PI));
  return color.rgb*color.a*16.0;
 }
 if(direction.z<0.0)return uSkyAmbient*0.18;
 return uHasLut>0.5?sampleSky(direction)*uIntensity:scatteringPreview(direction,smoothstep(-0.15,0.15,uSun.z));
}
vec3 environmentReflection(vec3 direction,vec3 normal,float roughness){
 vec3 r=normalize(mix(direction,normal,roughness*roughness*0.45));
 vec3 t=normalize(cross(r,abs(r.z)<0.9?vec3(0,0,1):vec3(0,1,0))),b=cross(r,t);
 float spread=roughness*roughness*0.7;
 return (environment(r)+environment(normalize(r+t*spread))+environment(normalize(r-t*spread))+environment(normalize(r+b*spread))+environment(normalize(r-b*spread)))*0.2;
}
void main(){
 vec3 normal=normalize(vNormal);if(!gl_FrontFacing)normal=-normal;
 vec3 view=normalize(mix(uEye-vWorld,-uForward,uOrtho)),halfVector=view+uSun;
 vec3 halfway=halfVector/max(length(halfVector),0.001);
 float noL=max(0.0,dot(normal,uSun)),noV=max(0.001,dot(normal,view)),noH=max(0.0,dot(normal,halfway));
 float a=uRoughness*uRoughness,a2=a*a,denom=noH*noH*(a2-1.0)+1.0;
 float distribution=a2/(PI*max(0.000001,denom*denom));
 float visibility=1.0;
 float smith=0.5/max(0.0001,noL*sqrt(noV*noV*(1.0-a2)+a2)+noV*sqrt(noL*noL*(1.0-a2)+a2));
 vec3 f0=mix(vec3(0.04),uBaseColor,uMetalness),f=f0+(1.0-f0)*pow(1.0-max(0.0,dot(view,halfway)),5.0);
 vec3 kd=(1.0-f)*(1.0-uMetalness);
 vec3 direct=(kd*uBaseColor/PI+distribution*smith*f)*noL*uSunTint*uIntensity*1.5;
 direct*=visibility*objectVisibility(vWorld,normal,noL);
 float hemisphere=0.45+0.55*max(0.0,normal.z);
 vec3 diffuse=(1.0-f0)*(1.0-uMetalness)*uBaseColor*uSkyAmbient*hemisphere;
 vec3 envF=f0+(max(vec3(1.0-uRoughness),f0)-f0)*pow(1.0-noV,5.0);
 vec3 specular=environmentReflection(reflect(-view,normal),normal,uRoughness)*envF;
 vec3 moonFill=(1.0-uMetalness)*uBaseColor*uMoonAmbient*hemisphere;
 vec3 c=diffuse+direct+specular+moonFill;
 vec3 pathT=exp(-uAerialExtinction*length(uEye-vWorld)*.001*uAerialStrength);
 vec3 viewRay=normalize(vWorld-uEye);
 c=c*pathT+scatteringPreview(viewRay,smoothstep(-0.15,0.15,uSun.z))*(1.0-pathT);
 if(uLines>0.5)c=vColor;
 gl_FragColor=vec4(display(c),1);
}`;

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
  return MESH_FRAGMENT.replace('precision mediump float', 'precision highp float').replace('void main(){', shadow + '\nvoid main(){').replace('float visibility=1.0;', 'float visibility=cloudShadow(vWorld);');
}

function volumeFragment(quality) {
  // Render the lower hemisphere first; an elevated camera may see clouds below.
  const volume=SKY_FRAGMENT.replace(SKY_CLOUD_LAYER,'').replace('void main(){',volumetricCloudFunctions(quality)+'\nvoid main(){');
  return volume.replace('sky=addRainbow(sky,rd);','sky=marchClouds(sky,ro,rd,daylight);\n sky=addRainbow(sky,rd);');
}
function reflectionFragment(quality,mode){
  const fragment=mode==='layer'?SKY_FRAGMENT:volumeFragment(quality);
  return fragment.replace('vec3 ro=uEye+off*uDistance*uOrtho;', 'vec3 ro=uEye;')
    .replace('vec3 rd=normalize(uForward+off*(1.0-uOrtho));', 'float az=(vNdc.x+1.0)*PI,el=vNdc.y*PI*0.5;vec3 rd=vec3(sin(az)*cos(el),cos(az)*cos(el),sin(el));')
    .replace('if(rd.z>=0.0&&uSun.z>=0.0)sky+=uSunTint*disc*uIntensity*8.0;', '')
    .replace('gl_FragColor=vec4(display(sky),1.0);', 'float m=clamp(ceil(max(max(sky.r,sky.g),sky.b)/16.0*255.0)/255.0,1.0/255.0,1.0);gl_FragColor=vec4(clamp(sky/(m*16.0),0.0,1.0),m);');
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
      this.sky=program(gl,SKY_VERTEX,this.volumeSupported?SKY_FRAGMENT:SKY_FRAGMENT.replace('precision highp float','precision mediump float'));this.baseMesh=program(gl,MESH_VERTEX,this.volumeSupported?MESH_FRAGMENT.replace('precision mediump float','precision highp float'):MESH_FRAGMENT);this.mesh=this.baseMesh;
      this.objectShadows=new ObjectShadowMap(gl,program);
      this.reflectionProbe=new SkyReflectionProbe(gl,program,reflectionFragment);
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
      this.transport=new AtmosphereTransport();
      this.integratedTexture=this.createTexture();this.noiseTexture=this.createTexture(true);this.starTexture=this.createTexture(true,true);gl.bindTexture(gl.TEXTURE_2D,this.starTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }catch(error){this.dispose();throw error;}
  }
  createTexture(linear=false,repeat=false){
    const g=this.gl,t=g.createTexture();g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,t);
    for(const k of [g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,k,linear?g.LINEAR:g.NEAREST);
    for(const k of [g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T])g.texParameteri(g.TEXTURE_2D,k,repeat?g.REPEAT:g.CLAMP_TO_EDGE);
    g.texImage2D(g.TEXTURE_2D,0,g.RGBA,1,1,0,g.RGBA,g.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));return t;
  }
  updateTransport(state){
    const g=this.gl,physical=this.transport.update(state.atmosphere,state.sun,this.cloudSettings.quality);
    if(this.uploadedTransport!==this.transport.skyKey){
      g.activeTexture(g.TEXTURE3);g.bindTexture(g.TEXTURE_2D,this.integratedTexture);
      g.texImage2D(g.TEXTURE_2D,0,g.RGBA,physical.width,physical.height,0,g.RGBA,this.floatTexture?g.FLOAT:g.UNSIGNED_BYTE,this.floatTexture?physical.data:encodeAtmosphereRGBM(physical.data));
      this.uploadedTransport=this.transport.skyKey;
    }
    const seed=Number.isFinite(Number(state.clouds?.seed))?Number(state.clouds.seed)|0:3301;
    if(this.noiseSeed!==seed){
      const noise=makeCloudNoise(seed);g.activeTexture(g.TEXTURE4);g.bindTexture(g.TEXTURE_2D,this.noiseTexture);
      g.texImage2D(g.TEXTURE_2D,0,g.RGBA,noise.width,noise.height,0,g.RGBA,g.UNSIGNED_BYTE,noise.data);this.noiseSeed=seed;
    }
    const stars=normalizeCelestial(state).stars,key=JSON.stringify([stars.seed,stars.count]);
    if(stars.enabled&&this.starKey!==key){
      const field=starField(stars.seed,stars.count);g.activeTexture(g.TEXTURE5);g.bindTexture(g.TEXTURE_2D,this.starTexture);
      g.texImage2D(g.TEXTURE_2D,0,g.RGBA,field.width,field.height,0,g.RGBA,g.UNSIGNED_BYTE,field.data);this.starKey=key;
    }
    g.activeTexture(g.TEXTURE0);return physical;
  }
  bindTransport(p){
    const g=this.gl;
    for(const [unit,texture,uniform] of [[3,this.integratedTexture,'uIntegratedSky'],[4,this.noiseTexture,'uCloudNoise'],[5,this.starTexture,'uStarField']]){
      g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,texture);this.uniform(p,uniform,'uniform1i',unit);
    }
    g.activeTexture(g.TEXTURE0);
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
    this.lutRevision=(this.lutRevision||0)+1;
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
    const physical=this.updateTransport(state);
    this.lastAtmosphere={...(state.atmosphere||{})};if(this.hasLut&&!this.lutAtmosphere)this.lutAtmosphere={...this.lastAtmosphere};
    if(this.cssSize)this.resize(this.cssSize.width,this.cssSize.height,this.cssSize.dpr);
    const skyProgram=this.cloudProgram(this.cloudSettings);
    const aspect=this.canvas.width/this.canvas.height, fov=Number(state.camera?.fov)||60;
    const basis=cameraBasis(camera),sun=sunDirection(state.sun);
    const exposure=clamp(finite(state.camera?.exposure,1)*Math.pow(2,clamp(finite(state.color?.exposure,0),-10,10)),0.001,1000), intensity=clamp(Number(state.sun?.intensity)||0,0,100);
    const contrast=clamp(finite(state.color?.contrast,1),0,4),saturation=clamp(finite(state.color?.saturation,1),0,4);
    const objects=state.scene?.referenceObjects||{},casters=[];
    if(state.viewport?.referenceSphere!==false)casters.push({id:'builtin-sphere',buffer:this.sphere,count:this.sphereCount,position:[0,0,0],scale:[1,1,1],rotation:identityRotation,center:[0,0,1.2],radius:1.2});
    for(const object of Object.values(objects)){
      const mesh=this.referenceMeshes.get(object?.type);if(!mesh||object.visible===false||!normalizeReferenceMaterial(object.material).castShadow)continue;
      const position=[0,1,2].map(i=>finite(object.position?.[i],0));
      casters.push({id:object.id,buffer:mesh.buffer,count:mesh.count,position,scale:scaleVector(object),rotation:rotationMatrix3(object.rotation),center:position,radius:objectRadius(object)});
    }
    this.objectShadows.update(casters,sun,{low:512,medium:768,high:1024}[this.cloudSettings.quality],this.volumeSupported&&state.viewport?.objectShadows!==false);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.disable(gl.DEPTH_TEST);
    gl.useProgram(skyProgram);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    const attr=gl.getAttribLocation(skyProgram,'aPosition');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
    const u=(n,t,v)=>this.uniform(skyProgram,n,t,v);
    this.usingLut=state.viewport?.skySource==='backend'&&this.hasLut&&lutMatchesSun(this.payload,state.sun)&&lutMatchesAtmosphere(this.payload,state.atmosphere,this.lutAtmosphere);
    const sourceColor=blackbodyTint(state.sun?.temperature),celestial=celestialUniforms(state);
    const direct=physical.direct.map((v,i)=>v*sourceColor[i]*4);
    const daylight=clamp((sun[2]+0.1)/0.2,0,1);
    const ambient=this.usingLut&&this.lutAmbient?this.lutAmbient.map(value=>value*intensity):physical.ambient.map((v,i)=>v*sourceColor[i]*intensity+[.000015,.000025,.00006][i]*(1-daylight));
    const skyVectors={uEye:basis.eye,uForward:basis.forward,uRight:basis.right,uUp:basis.up,uSun:sun,uSunTint:direct,uSkyAmbient:ambient,uSunSourceColor:sourceColor,uZenithOpticalDepth:opticalDepth(physical.parameters,.02,1),...celestial.vectors};
    const skyFloats={uHasIntegrated:1,uIntegratedEncoded:this.floatTexture?0:1,uSunAzimuth:finite(state.sun?.azimuth,215)*Math.PI/180,uHasCloudNoise:1,uPixelAngle:2*Math.tan(fov*Math.PI/360)/this.canvas.height,...celestial.floats,uAspect:aspect,uTan:Math.tan(clamp(fov,15,120)*Math.PI/360),uDistance:camera.distance,uOrtho:camera.projection==='orthographic'?1:0,uExposure:exposure,uContrast:contrast,uSaturation:saturation,uSunRadius:clamp(Number(state.sun?.angularDiameter)||0.53,0.01,10)*Math.PI/360,uIntensity:intensity,...cloudUniforms(state),uTurbidity:clamp(finite(state.atmosphere?.turbidity,2.4),1,15),uRayleigh:clamp(finite(state.atmosphere?.rayleigh,2.8),0,10),uMie:clamp(finite(state.atmosphere?.mieCoefficient,0.005),0,0.1),uMieG:clamp(finite(state.atmosphere?.mieDirectionalG,0.8),-0.99,0.99),uOzone:clamp(finite(state.atmosphere?.ozone,0.6),0,3),uHaze:Math.max(0,Number(state.atmosphere?.haze)||0),uHasLut:this.usingLut?1:0};
    for(const [n,v] of Object.entries(skyVectors))u(n,'uniform3fv',v);
    for(const [n,v] of Object.entries(skyFloats))u(n,'uniform1f',v);
    u('uIntegratedSize','uniform2fv',[physical.width,physical.height]);this.bindTransport(skyProgram);
    u('uLutSize','uniform2fv',this.lutSize);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);u('uLut','uniform1i',0);
    gl.drawArrays(gl.TRIANGLES,0,6);gl.disableVertexAttribArray(attr);
    const probeOrigin=camera.target||[0,0,1.2];
    this.reflectionProbe.update({key:JSON.stringify([state.sun,state.atmosphere,state.clouds,state.moon,state.stars,state.aurora,state.rainbow,this.cloudSettings.quality,this.cloudSettings.mode,cloudUniforms(state).uTime,probeOrigin,this.usingLut?this.lutRevision:0]),quality:this.cloudSettings.quality,mode:skyProgram===this.sky?'layer':'volumetric',quad:this.quad,uniforms:p=>{
      for(const [n,v] of Object.entries({...skyVectors,uEye:probeOrigin}))this.uniform(p,n,'uniform3fv',v);
      for(const [n,v] of Object.entries(skyFloats))this.uniform(p,n,'uniform1f',v);
      this.uniform(p,'uIntegratedSize','uniform2fv',[physical.width,physical.height]);this.bindTransport(p);
      this.uniform(p,'uLutSize','uniform2fv',this.lutSize);this.uniform(p,'uLut','uniform1i',0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    }});
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    this.mesh=skyProgram!==this.sky?this.shadowMesh():this.baseMesh;
    gl.enable(gl.DEPTH_TEST);gl.useProgram(this.mesh);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.mesh,'uVP'),false,viewProjection(camera,aspect,fov));
    this.uniform(this.mesh,'uSun','uniform3fv',sun);this.uniform(this.mesh,'uSunTint','uniform3fv',direct);this.uniform(this.mesh,'uSkyAmbient','uniform3fv',ambient);this.uniform(this.mesh,'uExposure','uniform1f',exposure);this.uniform(this.mesh,'uIntensity','uniform1f',intensity);this.uniform(this.mesh,'uContrast','uniform1f',contrast);this.uniform(this.mesh,'uSaturation','uniform1f',saturation);
    for(const [name,value] of Object.entries({uEye:basis.eye,uForward:basis.forward}))this.uniform(this.mesh,name,'uniform3fv',value);
    for(const [name,value] of Object.entries({uOrtho:camera.projection==='orthographic'?1:0,uHasLut:this.usingLut?1:0,uTurbidity:clamp(finite(state.atmosphere?.turbidity,2.4),1,15),uRayleigh:clamp(finite(state.atmosphere?.rayleigh,2.8),0,10),uMie:clamp(finite(state.atmosphere?.mieCoefficient,0.005),0,0.1),uMieG:clamp(finite(state.atmosphere?.mieDirectionalG,0.8),-.99,.99),uOzone:clamp(finite(state.atmosphere?.ozone,.6),0,3),uHaze:Math.max(0,finite(state.atmosphere?.haze,0))}))this.uniform(this.mesh,name,'uniform1f',value);
    this.bindTransport(this.mesh);this.uniform(this.mesh,'uIntegratedSize','uniform2fv',[physical.width,physical.height]);
    for(const [n,v] of Object.entries({uSunSourceColor:sourceColor,uMoonAmbient:celestial.vectors.uMoonAmbient,uAerialExtinction:physical.parameters.rayleigh.map((v,i)=>v+physical.parameters.mieExtinction[i])}))this.uniform(this.mesh,n,'uniform3fv',v);
    for(const [n,v] of Object.entries({uAerialStrength:clamp(finite(state.atmosphere?.aerialPerspective,1),0,4),uHasIntegrated:1,uIntegratedEncoded:this.floatTexture?0:1,uSunAzimuth:finite(state.sun?.azimuth,215)*Math.PI/180,uHasCloudNoise:1}))this.uniform(this.mesh,n,'uniform1f',v);
    this.uniform(this.mesh,'uLutSize','uniform2fv',this.lutSize);this.uniform(this.mesh,'uLut','uniform1i',0);
    this.objectShadows.bind(this.mesh);
    this.reflectionProbe.bind(this.mesh);
    if(this.mesh===this.cloudMesh)for(const [name,value] of Object.entries(cloudUniforms(state)))this.uniform(this.mesh,name,'uniform1f',value);
    if(state.viewport?.grid!==false)this.drawMesh(this.grid,this.gridCount,gl.LINES,true);
    if(state.viewport?.referenceSphere!==false)this.drawMesh(this.sphere,this.sphereCount,gl.TRIANGLES,false);
    for(const object of Object.values(objects)){
      const mesh=this.referenceMeshes.get(object?.type);if(!mesh||object.visible===false)continue;
      const position=[0,1,2].map(i=>Number.isFinite(Number(object.position?.[i]))?Number(object.position[i]):0);
      const scale=scaleVector(object),rotation=rotationMatrix3(object.rotation);
      // Fill offset keeps a coplanar selection outline stable at every scale.
      gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);
      this.drawMesh(mesh.buffer,mesh.count,gl.TRIANGLES,false,position,scale,rotation,object.material);
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
    this.lightingMetrics={objectShadows:this.objectShadows.active,shadowMapSize:this.objectShadows.resolution||0,shadowDraws:this.objectShadows.draws,shadowFallback:this.objectShadows.error||this.objectShadows.reason||null,skySource:this.usingLut?'backend relative LUT':'integrated atmosphere',atmosphereBuilds:this.transport.builds,opticalBuilds:this.transport.opticalBuilds,atmosphereSize:[physical.width,physical.height],celestial:normalizeCelestial(state),reflectionSamples:5,reflectionProbe:this.reflectionProbe.active,reflectionSize:[this.reflectionProbe.width||0,this.reflectionProbe.height||0],reflectionDraws:this.reflectionProbe.draws,reflectionFallback:this.reflectionProbe.error||null};
  }
  drawMesh(buffer,count,mode,lines,offset=[0,0,0],scale=[1,1,1],rotation=identityRotation,material){
    const g=this.gl;g.bindBuffer(g.ARRAY_BUFFER,buffer);const enabled=[];
    for(const [i,n] of ['aPosition','aNormal','aColor'].entries()){
      const a=g.getAttribLocation(this.mesh,n);g.enableVertexAttribArray(a);g.vertexAttribPointer(a,3,g.FLOAT,false,36,i*12);enabled.push(a);
    }
    this.uniform(this.mesh,'uOffset','uniform3fv',offset);this.uniform(this.mesh,'uSize','uniform3fv',scale);g.uniformMatrix3fv(g.getUniformLocation(this.mesh,'uRotation'),false,rotation);
    const surface=normalizeReferenceMaterial(material);this.uniform(this.mesh,'uBaseColor','uniform3fv',surface.baseColor);this.uniform(this.mesh,'uRoughness','uniform1f',surface.roughness);this.uniform(this.mesh,'uMetalness','uniform1f',surface.metalness);this.uniform(this.mesh,'uReceiveShadow','uniform1f',surface.receiveShadow?1:0);
    this.uniform(this.mesh,'uLines','uniform1f',lines?1:0);g.drawArrays(mode,0,count);enabled.forEach(a=>g.disableVertexAttribArray(a));
  }
  dispose(){
    const g=this.gl;
    this.objectShadows?.dispose();
    this.reflectionProbe?.dispose();
    if(g&&!g.isContextLost()){
      // A current program stays alive after deleteProgram until it is unbound.
      g.useProgram(null);
      this.resources.forEach(b=>g.deleteBuffer(b));
      for(const t of [this.texture,this.integratedTexture,this.noiseTexture,this.starTexture])if(t)g.deleteTexture(t);
      if(this.sky)g.deleteProgram(this.sky);
      for(const p of this.cloudPrograms.values())if(p)g.deleteProgram(p);
      for(const p of new Set([this.baseMesh,this.cloudMesh]))if(p)g.deleteProgram(p);
    }
    this.resources=[];this.cloudPrograms.clear();this.cloudFailures.clear();this.locations.clear();this.texture=this.integratedTexture=this.noiseTexture=this.starTexture=null;this.transport=null;this.sky=null;this.mesh=null;this.baseMesh=null;this.cloudMesh=null;
  }
}
