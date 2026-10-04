import { normalizeCelestial } from '../core/celestial-state.js';
export { normalizeCelestial } from '../core/celestial-state.js';
import { sunDirection } from './camera.js';
import { blackbodyTint } from './atmosphere-transport.js';
const PI=Math.PI,rad=PI/180;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,d)=>Number.isFinite(Number(v))?Number(v):d;
export function moonIlluminatedFraction(phase) { return .5*(1-Math.cos(2*PI*phase)); }
export function moonPhaseFlux(phase) {
  const alpha=Math.acos(clamp(-Math.cos(2*PI*phase),-1,1));
  return (Math.sin(alpha)+(PI-alpha)*Math.cos(alpha))/PI;
}
export function rainbowAngle(wavelengthNm, order=1) {
  // Cauchy approximation for liquid water; stationary Snell deflection.
  const n=1.324+.0031/(wavelengthNm/1000)**2, k=order+1;
  const i=Math.asin(Math.sqrt((k*k-n*n)/(k*k-1))),r=Math.asin(Math.sin(i)/n);
  const deflection=order*PI+2*i-2*k*r;
  return order===1?PI-deflection:deflection-PI;
}
export function celestialUniforms(state={}) {
  const {moon,stars,aurora,rainbow}=normalizeCelestial(state),az=moon.azimuth*rad;
  const tint=[.82,.88,1],flux=moon.enabled&&moon.elevation>0?moonPhaseFlux(moon.phase)*moon.brightness*(moon.angularDiameter/.52)**2*.00035:0;
  return {vectors:{uMoon:sunDirection(moon),uMoonRight:[Math.cos(az),-Math.sin(az),0],uMoonUp:[-Math.sin(az)*Math.sin(moon.elevation*rad),-Math.cos(az)*Math.sin(moon.elevation*rad),Math.cos(moon.elevation*rad)],uMoonAmbient:tint.map(v=>v*flux),uRainbowAngles:[650,550,450].map(w=>rainbowAngle(w)),uRainbowSecondaryAngles:[650,550,450].map(w=>rainbowAngle(w,2))},
    floats:{uStarsEnabled:stars.enabled?1:0,uStarBrightness:stars.brightness,uStarRotation:stars.rotation*rad,uMoonEnabled:moon.enabled?1:0,uMoonRadius:moon.angularDiameter*rad*.5,uMoonPhase:moon.phase*2*PI,uMoonBrightness:moon.brightness,uMoonEarthshine:moon.earthshine,uAuroraEnabled:aurora.enabled?1:0,uAuroraIntensity:aurora.intensity,uAuroraAzimuth:aurora.azimuth*rad,uAuroraAltitude:aurora.altitude,uAuroraHeight:aurora.height,uAuroraWidth:aurora.width,uAuroraCurtains:aurora.curtains,uAuroraSpeed:aurora.speed,uRainbowEnabled:rainbow.enabled?1:0,uRainbowIntensity:rainbow.intensity*rainbow.rainAmount,uRainbowWidth:rainbow.width*rad,uRainbowSecondary:rainbow.secondary?1:0}};
}
export function starField(seed=2387,count=3200,width=2048,height=1024) {
  // Procedural catalogue, uniform over solid angle. Positions never follow the
  // camera. Magnitudes use the astronomical 10^(-0.4m) flux relationship.
  let randomState=(seed>>>0)||1;
  const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
  count=clamp(Math.round(finite(count,3200)),0,12000);
  const pixels=new Float32Array(width*height*3);
  for(let i=0;i<count;i++) {
    const az=random()*2*PI,z=random()*2-1,el=Math.asin(z),x=az/(2*PI)*width,y=(.5+el/PI)*height;
    const magnitude=1+Math.pow(random(),.28)*5.5,brightness=Math.pow(10,-.4*(magnitude-1));
    const color=blackbodyTint(3200+random()*7800),stretch=Math.min(8,1/Math.max(.1,Math.cos(el)));
    for(let dy=-2;dy<=2;dy++)for(let dx=-Math.ceil(stretch*1.5);dx<=Math.ceil(stretch*1.5);dx++) {
      const xx=((Math.floor(x)+dx)%width+width)%width,yy=Math.floor(y)+dy;
      if(yy<0||yy>=height)continue;
      const d=((Math.floor(x)+dx+.5-x)/stretch)**2+(yy+.5-y)**2;
      const weight=Math.exp(-d*4.0)*brightness;
      for(let c=0;c<3;c++)pixels[(yy*width+xx)*3+c]+=color[c]*weight;
    }
  }
  const data=new Uint8Array(width*height*4);
  for(let i=0;i<width*height;i++) {for(let c=0;c<3;c++)data[i*4+c]=Math.round(clamp(pixels[i*3+c],0,1)*255);data[i*4+3]=255;}
  return {width,height,data,count,seed};
}

export const CELESTIAL_UNIFORMS=`
uniform sampler2D uStarField;
uniform vec3 uMoon,uMoonRight,uMoonUp,uMoonAmbient,uZenithOpticalDepth,uRainbowAngles,uRainbowSecondaryAngles;
uniform float uStarsEnabled,uStarBrightness,uStarRotation,uMoonEnabled,uMoonRadius,uMoonPhase,uMoonBrightness,uMoonEarthshine,uPixelAngle;
uniform float uAuroraEnabled,uAuroraIntensity,uAuroraAzimuth,uAuroraAltitude,uAuroraHeight,uAuroraWidth,uAuroraCurtains,uAuroraSpeed;
uniform float uRainbowEnabled,uRainbowIntensity,uRainbowWidth,uRainbowSecondary;
`;
const RAINBOW_BANDS=[[700,[.35,0,0]],[650,[1,.025,0]],[600,[1,.35,0]],[550,[.15,1,0]],[500,[0,.65,.45]],[450,[.03,.06,1]],[400,[.3,0,.55]]];
const rainbowSpectrum=order=>RAINBOW_BANDS.map(([w,c])=>`vec3(${c.map(v=>v.toFixed(4)).join(',')})*exp(-pow((angle-${rainbowAngle(w,order).toFixed(9)})/(uRainbowWidth*0.65),2.0))`).join('+');
export const CELESTIAL_GLSL=`
vec3 celestialTransmission(vec3 rd){
 float elevation=asin(clamp(rd.z,0.0,1.0))*180.0/PI;
 float mass=1.0/max(0.025,rd.z+0.50572*pow(elevation+6.07995,-1.6364));
 return exp(-uZenithOpticalDepth*mass);
}
vec3 auroraEmission(vec3 ro,vec3 rd){
 if(uAuroraEnabled<0.5||rd.z<0.01)return vec3(0.0);
 vec2 axis=vec2(sin(uAuroraAzimuth),cos(uAuroraAzimuth)),across=vec2(axis.y,-axis.x);
 float forward=dot(rd.xy,axis);if(forward<=0.025)return vec3(0.0);
 vec3 radiance=vec3(0.0);float time=uTime*uAuroraSpeed;
 for(int band=0;band<3;band++){
  if(float(band)>=uAuroraCurtains)break;
  float base=180.0+float(band)*75.0,t=base/forward;
  // Intersect folded vertical emission sheets with a bounded Newton solve.
  for(int step=0;step<3;step++){
   vec2 p=ro.xy*0.001+rd.xy*t;float x=dot(p,across),phase=x*0.012+time+float(band)*2.1;
   float wave=35.0*sin(phase)+14.0*sin(phase*2.7);
   float derivative=forward-(0.42*cos(phase)+0.4536*cos(phase*2.7))*dot(rd.xy,across);
   float correction=(dot(p,axis)-base-wave)/(abs(derivative)<0.04?0.04:derivative);
   t=clamp(t-correction,1.0,1800.0);
  }
  vec3 p=ro*0.001+rd*t;
  float h=p.z+dot(p.xy,p.xy)/(2.0*6360.0),x=dot(p.xy,across),f=dot(p.xy,axis);
  float phase=x*0.012+time+float(band)*2.1,residual=f-base-35.0*sin(phase)-14.0*sin(phase*2.7);
  float sheet=exp(-residual*residual/max(1.0,uAuroraWidth*uAuroraWidth));
  float vertical=(h-uAuroraAltitude-8.0*sin(x*.021+time*.2))/uAuroraHeight;
  float envelope=smoothstep(0.0,0.05,vertical)*(1.0-smoothstep(0.75,1.0,vertical));
  float rays=0.18+0.82*pow(noise(vec2(x*.54+noise(vec2(x*.037,time*.3))*6.0,float(band)*13.7+time*.3)),2.0);
  float fold=0.55+0.45*sin(x*.027+time*0.6+float(band));
  vec3 emission=vec3(0.04,0.8,0.13)*exp(-vertical*4.5)+vec3(0.6,0.025,0.035)*exp(-pow((vertical-.67)/.32,2.0))*.12+vec3(.22,.035,.5)*exp(-vertical*16.0)*.3;
  radiance+=emission*sheet*envelope*rays*fold*exp(-x*x/450000.0)*uAuroraIntensity*0.6;
 }
 return radiance;
}
vec3 celestialSky(vec3 sky,vec3 ro,vec3 rd){
 if(rd.z<=0.0)return sky;
 vec3 transmission=celestialTransmission(rd);
 float night=1.0-smoothstep(-0.16,0.01,uSun.z);
 if(uStarsEnabled>0.5){
  float az=mod(atan(rd.x,rd.y)+uStarRotation+2.0*PI,2.0*PI);
  vec3 stars=texture2D(uStarField,vec2(az/(2.0*PI),0.5+asin(rd.z)/PI)).rgb;
  sky+=stars*transmission*uStarBrightness*night*0.7;
 }
 sky+=auroraEmission(ro,rd)*transmission*night;
 if(uMoonEnabled>0.5&&uMoon.z>0.0&&dot(rd,uMoon)>cos(uMoonRadius*1.3+uPixelAngle*2.0)){
  float facing=max(.0001,dot(rd,uMoon));
  vec2 q=vec2(dot(rd,uMoonRight),dot(rd,uMoonUp))/(facing*tan(uMoonRadius));
  float r2=dot(q,q),edge=1.0-smoothstep(1.0-uPixelAngle/uMoonRadius,1.0+uPixelAngle/uMoonRadius,sqrt(r2));
  vec3 n=vec3(q,sqrt(max(0.0,1.0-min(r2,1.0))));
  vec3 light=vec3(sin(uMoonPhase),0.0,-cos(uMoonPhase));
  float illumination=max(0.0,dot(n,light));
  float maria=fbm(q*3.7+vec2(16.8,4.1)),craters=noise(q*38.0);
  float albedo=mix(.32,.8,smoothstep(.25,.65,maria))*(.9+.1*craters);
  vec3 moon=vec3(.9,.93,1.0)*albedo*(illumination+uMoonEarthshine)*uMoonBrightness*1.4*transmission;
  sky=mix(sky,moon,edge);
 }
 return sky;
}
vec3 addRainbow(vec3 sky,vec3 rd){
 if(uRainbowEnabled<0.5||uSun.z<=0.0||rd.z<=0.0||uRainbowIntensity<=0.0)return sky;
 float angle=acos(clamp(dot(rd,-uSun),-1.0,1.0));
 vec3 primary=(${rainbowSpectrum(1)})*0.65;
 vec3 secondary=(${rainbowSpectrum(2)})*uRainbowSecondary*.15;
 float horizon=smoothstep(0.0,0.035,rd.z);
 // Additive single-scattering approximation in a local rain shaft. Background
 // remains visible; the antisolar cone follows the same Sun as the scene.
 return sky+(primary+secondary)*uSunTint*uIntensity*uRainbowIntensity*horizon*.16;
}
`;
