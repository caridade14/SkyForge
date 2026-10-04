// Bounded WebGL 1 preview budgets for integrated GPUs. These are preview
// settings, independent of the offline render queue or HDR export settings.
export const CLOUD_QUALITIES = Object.freeze({
  low: Object.freeze({ samples: 16, shadowSamples: 2, maxPixels: 250000, maxDpr: 1 }),
  medium: Object.freeze({ samples: 28, shadowSamples: 2, maxPixels: 500000, maxDpr: 1.25 }),
  high: Object.freeze({ samples: 44, shadowSamples: 3, maxPixels: 900000, maxDpr: 1.5 })
});
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function cloudQuality(value) {
  return Object.hasOwn(CLOUD_QUALITIES, value) ? value : 'low';
}

export function cloudPreviewSettings(state = {}) {
  const quality = cloudQuality(state.viewport?.cloudQuality);
  return { quality, mode: state.viewport?.cloudMode === 'layer' ? 'layer' : 'volumetric', ...CLOUD_QUALITIES[quality] };
}

export function cloudUniforms(state = {}) {
  const clouds = state.clouds || {}, timeline = state.timeline || {};
  return {
    uCoverage: clamp(finite(clouds.coverage, 0), 0, 1),
    uDensity: clamp(finite(clouds.density, 0), 0, 1),
    uAltitude: clamp(finite(clouds.altitude, 2400), 1, 50000),
    uThickness: clamp(finite(clouds.thickness, 800), 50, 10000),
    uErosion: clamp(finite(clouds.erosion, 0), 0, 1),
    uDetail: clamp(finite(clouds.detail, 0), 0, 1),
    uTime: clamp(finite(timeline.currentFrame, 0), -1e7, 1e7) / clamp(finite(timeline.fps, 24), 1, 240),
    uWindSpeed: clamp(finite(clouds.windSpeed, 0), -200, 200),
    uWindDirection: (finite(clouds.windDirection, 0) % 360) * Math.PI / 180
  };
}

export function cloudPreviewResolution(width, height, dpr = 1, settings = CLOUD_QUALITIES.low) {
  const w = Math.max(1, finite(width, 1)), h = Math.max(1, finite(height, 1));
  const scale = Math.min(Math.max(0.1, finite(dpr, 1)), settings.maxDpr, Math.sqrt(settings.maxPixels / (w * h)));
  // Floor keeps even extremely wide canvases within the pixel budget.
  const pixelWidth = Math.max(1, Math.min(settings.maxPixels, Math.floor(w * scale)));
  return { width: pixelWidth, height: Math.max(1, Math.min(Math.floor(settings.maxPixels / pixelWidth), Math.floor(h * scale))) };
}

// Functions compose into the existing sky fragment shader. The raymarch is
// actual 3D density, never a precomputed 2D cloud texture. Loops have literal
// bounds so WebGL 1 compilers can compile them on older Intel drivers.
export function volumetricCloudFunctions(value = 'low') {
  const { samples, shadowSamples } = CLOUD_QUALITIES[cloudQuality(value)];
  return `
float cloudHash(vec3 p){
 p=fract(p*0.1031);p+=dot(p,p.yzx+33.33);
 return fract((p.x+p.y)*p.z);
}
float cloudNoise(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(cloudHash(i),cloudHash(i+vec3(1,0,0)),f.x),
                mix(cloudHash(i+vec3(0,1,0)),cloudHash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(cloudHash(i+vec3(0,0,1)),cloudHash(i+vec3(1,0,1)),f.x),
                mix(cloudHash(i+vec3(0,1,1)),cloudHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float cloudDensity(vec3 point){
 float height=(point.z-uAltitude)/uThickness;
 if(height<=0.0||height>=1.0)return 0.0;
 vec3 p=point/900.0;
 p.xy+=vec2(sin(uWindDirection),cos(uWindDirection))*uTime*uWindSpeed/900.0;
 float base=cloudNoise(p)*0.68+cloudNoise(p*2.03+vec3(11.7,4.1,8.8))*0.32;
 float threshold=0.10+(1.0-uCoverage)*0.72;
 float mass=clamp((base-threshold)*4.0,0.0,1.0);
 if(mass<=0.001)return 0.0;
 float fine=cloudNoise(p*(5.0+uDetail*5.0)+vec3(2.3,12.1,6.7));
 mass=max(0.0,mass-uErosion*(1.0-fine)*0.48);
 mass*=mix(1.0,0.72+fine*0.4,uDetail);
 return mass*smoothstep(0.0,0.15,height)*(1.0-smoothstep(0.65,1.0,height))*uDensity;
}
vec3 marchClouds(vec3 sky,vec3 ro,vec3 rd,float daylight){
 if(uCoverage<0.001||uDensity<0.001)return sky;
 float nearT=0.0,farT=12000.0;
 if(abs(rd.z)<0.0001){if(ro.z<uAltitude||ro.z>uAltitude+uThickness)return sky;}
 else{
  float a=(uAltitude-ro.z)/rd.z,b=(uAltitude+uThickness-ro.z)/rd.z;
  nearT=max(0.0,min(a,b));farT=min(12000.0,max(a,b));
 }
 if(farT<=nearT)return sky;
 float stepSize=(farT-nearT)/float(${samples});
 float jitter=cloudHash(vec3(gl_FragCoord.xy,1.0));
 float distanceT=nearT+stepSize*(0.2+jitter*0.6),transmittance=1.0;
 vec3 radiance=vec3(0.0);
 float phase=0.35+0.65*pow(max(0.0,dot(rd,uSun)),8.0);
 for(int sampleIndex=0;sampleIndex<${samples};sampleIndex++){
  vec3 point=ro+rd*distanceT;
  float density=cloudDensity(point);
  if(density>0.001){
   float lightDepth=0.0;
   for(int lightIndex=0;lightIndex<${shadowSamples};lightIndex++){
    float lightStep=240.0+float(lightIndex)*350.0;
    lightDepth+=cloudDensity(point+uSun*lightStep)*350.0;
   }
   float direct=exp(-lightDepth*0.003)*max(0.0,uSun.z)*uIntensity;
   vec3 ambient=mix(vec3(0.008,0.012,0.025),vec3(0.27,0.34,0.43),daylight);
   vec3 light=ambient+uSunTint*direct*phase;
   float opacity=1.0-exp(-density*stepSize*0.004);
   radiance+=transmittance*opacity*light;
   transmittance*=1.0-opacity;
   if(transmittance<0.015)break;
  }
  distanceT+=stepSize;
 }
 return sky*transmittance+radiance;
}`;
}
