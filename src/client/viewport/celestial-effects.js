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
// Diameter of the centred disc in the perspective image. Zoom changes its
// screen size, never the angular diameter stored in the scene.
export function moonDiameterPixels(diameter=.52,fov=60,height=720) {
  return Math.max(1,finite(height,720))*Math.tan(clamp(finite(diameter,.52),.1,5)*rad/2)/Math.tan(clamp(finite(fov,60),15,120)*rad/2);
}
export function lunarReflectance(incidence,emission) {
  const mu0=clamp(finite(incidence,0),0,1),mu=clamp(finite(emission,0),0,1);
  return .8*2*mu0/Math.max(.001,mu0+mu)+.2*mu0;
}
export function magnitudeFlux(magnitude) { return Math.pow(10,-.4*finite(magnitude,0)); }
// Compact catalogue: each cell stores sub-cell position, magnitude and colour
// temperature. The GPU reconstructs unresolved points at the display pixel
// scale instead of enlarging a blurred equirectangular star image.
export function starCatalogue(seed=2387,count=3200,width=512,height=256) {
  count=clamp(Math.round(finite(count,3200)),0,12000);
  width=clamp(Math.round(finite(width,512)),16,2048);height=clamp(Math.round(finite(height,256)),8,1024);
  let s=(seed>>>0)||1;const random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
  const data=new Uint8Array(width*height*4),entries=[];
  for(let i=0;i<count;i++){
    const az=random()*2*PI,z=random()*2-1,el=Math.asin(z);
    // A steep magnitude distribution gives many faint points and a few bright
    // ones. Quantise in magnitudes, retaining faint flux instead of clipping it.
    const magnitude=-1.5+8.5*Math.pow(random(),.16),temperature=3200+random()*7800;
    const x=az/(2*PI)*width,y=(.5+el/PI)*height,offset=(Math.min(height-1,Math.floor(y))*width+Math.floor(x))*4;
    const encoded=Math.round((magnitude+1.5)/8.5*255);
    if(data[offset+3]===0||encoded<data[offset+2]){
      data[offset]=Math.round((x-Math.floor(x))*255);data[offset+1]=Math.round((y-Math.floor(y))*255);
      data[offset+2]=encoded;data[offset+3]=1+Math.round((temperature-3200)/7800*254);
    }
    entries.push({azimuth:az,elevation:el,magnitude,temperature});
  }
  return {width,height,data,count,seed,entries,packedCount:data.filter((v,i)=>i%4===3&&v>0).length};
}
// Wyman / Sloan / Shirley (JCGT 2013), Eq. 2 analytical CIE 1931 fit.
export function spectralXYZ(wavelengthNm) {
  const w=clamp(finite(wavelengthNm,550),380,700),g=(v,c,s)=>Math.exp(-.5*((v-c)/s)**2);
  return [1.065*g(w,595.8,33.33)+.366*g(w,446.8,19.44),1.014*g(Math.log(w),Math.log(556.3),.075),1.839*g(Math.log(w),Math.log(449.8),.051)];
}
export function xyzToLinearRGB([x,y,z]) { return [3.2406*x-1.5372*y-.4986*z,-.9689*x+1.8758*y+.0415*z,.0557*x-.204*y+1.057*z].map(v=>Math.max(0,v)); }
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
uniform vec2 uStarFieldSize;
uniform vec3 uMoon,uMoonRight,uMoonUp,uMoonAmbient,uZenithOpticalDepth,uRainbowAngles,uRainbowSecondaryAngles;
uniform float uStarsEnabled,uStarBrightness,uStarRotation,uMoonEnabled,uMoonRadius,uMoonPhase,uMoonBrightness,uMoonEarthshine,uPixelAngle;
uniform float uAuroraEnabled,uAuroraIntensity,uAuroraAzimuth,uAuroraAltitude,uAuroraHeight,uAuroraWidth,uAuroraCurtains,uAuroraSpeed;
uniform float uRainbowEnabled,uRainbowIntensity,uRainbowWidth,uRainbowSecondary;
`;
// Integrate overlapping wavelength lobes in XYZ before the RGB conversion.
// This preserves mixed colours instead of painting seven saturated stripes.
const SPECTRUM=Array.from({length:17},(_,i)=>{const w=380+i*20;return {w,xyz:spectralXYZ(w)};});
export function rainbowSpectrumXYZ(angleDegrees,softnessDegrees=.4,order=1){
 const angle=finite(angleDegrees,42)*rad,sigma=Math.max(.0006,clamp(finite(softnessDegrees,.4),.1,2)*rad*.42);
 return SPECTRUM.reduce((sum,{w,xyz})=>{const weight=Math.exp(-.5*((angle-rainbowAngle(w,order))/sigma)**2);return sum.map((v,i)=>v+xyz[i]*weight);},[0,0,0]);
}
const rainbowSpectrum=order=>SPECTRUM.map(({w,xyz})=>`vec3(${xyz.map(v=>v.toFixed(6)).join(',')})*exp(-0.5*pow((angle-${rainbowAngle(w,order).toFixed(9)})/sigma,2.0))`).join('+');
export const CELESTIAL_GLSL=`
vec3 celestialTransmission(vec3 rd){
 float elevation=asin(clamp(rd.z,0.0,1.0))*180.0/PI;
 float mass=1.0/max(0.025,rd.z+0.50572*pow(elevation+6.07995,-1.6364));
 return exp(-uZenithOpticalDepth*mass);
}
vec3 starPoints(vec3 rd){
 float az=mod(atan(rd.x,rd.y)+uStarRotation+2.0*PI,2.0*PI),el=asin(clamp(rd.z,-1.0,1.0));
 vec2 position=vec2(az/(2.0*PI),0.5+el/PI)*uStarFieldSize,cell=floor(position);
 vec3 light=vec3(0.0);float sigma=max(0.00002,uPixelAngle*0.48);
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 id=cell+vec2(float(x),float(y));if(id.y<0.0||id.y>=uStarFieldSize.y)continue;
  vec4 record=texture2D(uStarField,(vec2(mod(id.x+uStarFieldSize.x,uStarFieldSize.x),id.y)+0.5)/uStarFieldSize);
  if(record.a<=0.0)continue;
  vec2 delta=(id+record.rg-position)/uStarFieldSize*vec2(2.0*PI*cos(el),PI);
  float d2=dot(delta,delta),magnitude=record.b*8.5-1.5;
  float flux=pow(10.0,-0.4*magnitude),t=(record.a*255.0-1.0)/254.0;
  vec3 color=mix(vec3(1.0,0.64,0.35),vec3(0.67,0.8,1.0),smoothstep(0.0,1.0,t));
  float core=exp(-0.5*d2/(sigma*sigma)),halo=exp(-0.5*d2/(sigma*sigma*5.0))*min(0.05,flux*.008);
  light+=color*(core+halo)*flux*1.8;
 }
 return light;
}
vec3 auroraEmission(vec3 ro,vec3 rd){
 if(uAuroraEnabled<0.5||uAuroraIntensity<=0.0||rd.z<0.01)return vec3(0.0);
 vec2 axis=vec2(sin(uAuroraAzimuth),cos(uAuroraAzimuth)),across=vec2(axis.y,-axis.x);
 float forward=dot(rd.xy,axis),side=dot(rd.xy,across);if(forward<=0.025)return vec3(0.0);
 vec3 observer=ro*.001,radiance=vec3(0.0);float time=uTime*uAuroraSpeed;
 for(int band=0;band<3;band++){
  if(float(band)>=uAuroraCurtains)break;
  float base=240.0+float(band)*110.0,t=base/forward,phaseOffset=float(band)*2.13;
  // Locate a folded curtain then integrate a short volume through its finite
  // thickness. Importance sampling keeps the brightest lower edge resolved.
  for(int step=0;step<4;step++){
   vec2 p=observer.xy+rd.xy*t;float x=dot(p,across),phase=x*.025+time*.16+phaseOffset;
   float wave=24.0*sin(phase)+9.0*sin(x*.073-time*.11+phaseOffset);
   float derivative=forward-(.6*cos(phase)+.657*cos(x*.073-time*.11+phaseOffset))*side;
   float signedSlope=(derivative<0.0?-1.0:1.0)*max(.08,abs(derivative));
   t=clamp(t-(dot(p,axis)-base-wave)/signedSlope,1.0,1800.0);
  }
  vec2 middle=observer.xy+rd.xy*t;float mx=dot(middle,across),mp=mx*.025+time*.16+phaseOffset;
  float slope=max(.12,abs(forward-(.6*cos(mp)+.657*cos(mx*.073-time*.11+phaseOffset))*side));
  float halfPath=min(90.0,uAuroraWidth*2.4/slope),stepLength=halfPath*.25;
  for(int sampleIndex=0;sampleIndex<8;sampleIndex++){
   vec3 p=observer+rd*(t-halfPath+(float(sampleIndex)+.5)*stepLength);
   float x=dot(p.xy,across),f=dot(p.xy,axis),h=p.z+dot(p.xy,p.xy)/(2.0*6360.0);
   float phase=x*.025+time*.16+phaseOffset;
   float residual=f-base-24.0*sin(phase)-9.0*sin(x*.073-time*.11+phaseOffset);
   float sheet=exp(-.5*pow(residual/max(1.0,uAuroraWidth*.55),2.0));
   float bottom=uAuroraAltitude+9.0*noise(vec2(x*.028,float(band)*7.1)),height=h-bottom;
   float edge=smoothstep(-2.0,6.0,height),top=1.0-smoothstep(uAuroraHeight*.7,uAuroraHeight,height);
   float green=exp(-.5*pow((height-22.0)/max(12.0,uAuroraHeight*.19),2.0));
   float red=exp(-.5*pow((height-uAuroraHeight*.62)/max(20.0,uAuroraHeight*.28),2.0))*.14;
   float purple=exp(-.5*pow((height-3.0)/5.0,2.0))*.065;
   float bent=x+height*.11*sin(x*.031+time*.09+phaseOffset);
   float fine=noise(vec2(bent*.27+noise(vec2(x*.041,time*.08))*3.0,float(band)*13.7+time*.12));
   float rays=.16+.84*pow(fine,1.6),structure=.15+.85*noise(vec2(x*.011+time*.06,float(band)*3.7));
   vec3 emission=vec3(.11,.82,.22)*green+vec3(.72,.06,.045)*red+vec3(.28,.075,.5)*purple;
   radiance+=emission*sheet*edge*top*rays*structure*exp(-x*x/180000.0)*stepLength*.014*uAuroraIntensity;
  }
 }
 return radiance;
}
float lunarAlbedo(vec2 q){
 // Dark basalt basins and small impact rings, fixed to the disc, not the camera.
 float rough=fbm(q*12.0+vec2(37.2,19.1));
 float basins=exp(-dot((q-vec2(-.3,.23))*vec2(1.9,2.9),(q-vec2(-.3,.23))*vec2(1.9,2.9)))
  +.7*exp(-dot((q-vec2(.32,.42))*vec2(3.0,3.4),(q-vec2(.32,.42))*vec2(3.0,3.4)))
  +.6*exp(-dot((q-vec2(-.58,-.16))*3.5,(q-vec2(-.58,-.16))*3.5));
 float albedo=.63-.31*clamp(basins*(.7+.6*rough),0.0,1.0)+.06*(rough-.5);
 vec2 cells=q*24.0,id=floor(cells);float ring=0.0;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 cell=id+vec2(float(x),float(y));vec2 centre=cell+vec2(hash(cell+7.1),hash(cell+21.3));
  float r=.08+.2*hash(cell+38.4),d=length(cells-centre);
  ring+=.07*exp(-pow((d-r)/.05,2.0))-.045*exp(-d*d/max(.003,r*r*.5));
 }
 return clamp(albedo+ring,.15,.8);
}
vec3 celestialSky(vec3 sky,vec3 ro,vec3 rd){
 if(rd.z<=0.0)return sky;
 vec3 transmission=celestialTransmission(rd);
 float night=1.0-smoothstep(-0.16,0.01,uSun.z);
 if(uStarsEnabled>0.5){
  float moonWash=1.0/(1.0+uMoonEnabled*uMoonBrightness*max(0.0,uMoon.z)*0.8*(0.5-0.5*cos(uMoonPhase)));
  sky+=starPoints(rd)*transmission*uStarBrightness*night*moonWash;
 }
 sky+=auroraEmission(ro,rd)*transmission*night;
 if(uMoonEnabled>0.5&&uMoon.z>0.0&&dot(rd,uMoon)>cos(uMoonRadius*1.3+uPixelAngle*2.0)){
  float facing=max(.0001,dot(rd,uMoon));
  vec2 q=vec2(dot(rd,uMoonRight),dot(rd,uMoonUp))/(facing*tan(uMoonRadius));
  float r2=dot(q,q),edge=1.0-smoothstep(1.0-uPixelAngle/uMoonRadius,1.0+uPixelAngle/uMoonRadius,sqrt(r2));
  vec3 n=vec3(q,sqrt(max(0.0,1.0-min(r2,1.0))));
  vec3 light=vec3(sin(uMoonPhase),0.0,-cos(uMoonPhase));
  float illumination=max(0.0,dot(n,light));
  float response=.8*2.0*illumination/max(.001,illumination+n.z)+.2*illumination;
  float albedo=lunarAlbedo(q);
  vec3 moon=vec3(1.0,.98,.94)*albedo*(response+uMoonEarthshine)*uMoonBrightness*.75*transmission;
  sky=mix(sky,moon,edge);
 }
 return sky;
}
vec3 rainbowRGB(vec3 xyz){
 return max(vec3(3.2406*xyz.x-1.5372*xyz.y-.4986*xyz.z,-.9689*xyz.x+1.8758*xyz.y+.0415*xyz.z,.0557*xyz.x-.2040*xyz.y+1.0570*xyz.z),vec3(0.0));
}
vec3 addRainbow(vec3 sky,vec3 rd){
 if(uRainbowEnabled<0.5||uSun.z<=0.0||rd.z<=0.0||uRainbowIntensity<=0.0)return sky;
 float angle=acos(clamp(dot(rd,-uSun),-1.0,1.0)),sigma=max(.0006,uRainbowWidth*.42);
 vec3 primary=vec3(0.0),secondary=vec3(0.0);
 if(abs(angle-.726)<.035+sigma*4.0)primary=rainbowRGB(${rainbowSpectrum(1)})*.025;
 if(uRainbowSecondary>0.5&&abs(angle-.90)<.047+sigma*4.0)secondary=rainbowRGB(${rainbowSpectrum(2)})*.0038;
 // Single-reflection rays also brighten the inside of the primary cone. The
 // gap between bows gets no added caustic light (Alexander's band).
 float interior=(1.0-smoothstep(.707,.74,angle))*.012;
 vec2 shaft=rd.xy/max(.15,rd.z)*3.0;
 float rainShaft=smoothstep(.16,.8,noise(shaft+vec2(12.6,35.8)));
 float horizon=smoothstep(0.0,0.035,rd.z);
 return sky+(primary+secondary+vec3(interior))*uSunTint*uIntensity*uRainbowIntensity*horizon*rainShaft;
}
`;
