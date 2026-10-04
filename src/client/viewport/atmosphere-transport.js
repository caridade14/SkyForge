// Spherical RGB radiative transport. Lengths are kilometres, coefficients km^-1.
// This is a bounded real-time approximation, not Bruneton's full 4-D solver.
// References and approximation limits: docs/ATMOSPHERE_CELESTIAL_STUDIO.md.
const PI = Math.PI;
const R = 6360, TOP = 6460;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const finite = (x, d) => Number.isFinite(Number(x)) ? Number(x) : d;
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const luminance = c => c[0]*.2126+c[1]*.7152+c[2]*.0722;
export const ATMOSPHERE_BUDGETS = Object.freeze({
  low: { width: 48, height: 24, steps: 20 },
  medium: { width: 64, height: 32, steps: 28 },
  high: { width: 96, height: 48, steps: 36 }
});
export function atmosphereParameters(value = {}) {
  const aod = clamp(finite(value.aerosolOpticalDepth550,
    (finite(value.turbidity, 2.4)-1)*.025+finite(value.mieCoefficient, .005)*.6+(finite(value.haze,.3)-.3)*.04), 0, 2);
  const alpha = clamp(finite(value.angstromExponent, 1.3), 0, 3);
  const air = clamp(finite(value.rayleigh, 2.8)/2.8, 0, 4)*clamp(finite(value.pressureHpa, 1013.25)/1013.25, .1, 1.5)*288.15/clamp(273.15+finite(value.temperatureC, 15), 180, 330);
  const mie = [.680, .550, .440].map(w => aod/1.2*Math.pow(w/.550, -alpha));
  const ozone = value.ozoneDobsonUnits === undefined ? finite(value.ozone, .6)/.6 : finite(value.ozoneDobsonUnits, 300)/300;
  return {
    rayleigh: [.005802, .013558, .033100].map(v => v*air),
    mieExtinction: mie,
    mieScattering: mie.map(v => v*clamp(finite(value.aerosolSingleScatteringAlbedo, .9), 0, 1)),
    ozone: [.000650, .001881, .000085].map(v => v*clamp(ozone, 0, 4)),
    g: clamp(finite(value.mieAsymmetry, finite(value.mieDirectionalG, .8)), -.95, .95),
    groundAlbedo: clamp(finite(value.groundAlbedo, .2), 0, .9),
    multiple: clamp(finite(value.multipleScattering, 1), 0, 2)
  };
}
export function densityProfile(h) {
  h = Math.max(0, h);
  return [Math.exp(-h/8), Math.exp(-h/1.2), Math.max(0, 1-Math.abs(h-25)/15)];
}
export function phaseRayleigh(mu) { return 3/(16*PI)*(1+clamp(mu, -1, 1)**2); }
export function phaseMie(mu, g = .8) {
  g = clamp(g, -.95, .95);
  return (1-g*g)/(4*PI*Math.pow(1+g*g-2*g*clamp(mu, -1, 1), 1.5));
}
function groundHit(r, mu) { return mu < 0 && r*r*(mu*mu-1)+R*R >= 0; }
function boundary(r, mu) {
  return groundHit(r, mu) ? -r*mu-Math.sqrt(Math.max(0, r*r*(mu*mu-1)+R*R))
    : -r*mu+Math.sqrt(Math.max(0, r*r*(mu*mu-1)+TOP*TOP));
}
function altitudeAt(r, mu, t) { return Math.sqrt(r*r+2*r*mu*t+t*t)-R; }
export function opticalDepth(parameters, altitude, mu, steps = 48, distance = null) {
  const r = R+clamp(altitude, .001, 99.99);
  const length = distance === null ? boundary(r, mu) : Math.max(0, distance);
  const column = [0, 0, 0];
  for (let i=0; i<steps; i++) {
    // Quadratic spacing resolves dense air near the observer without wasting
    // the same number of samples in the near-vacuum upper atmosphere.
    const a=length*(i/steps)**2, b=length*((i+1)/steps)**2;
    const d=densityProfile(altitudeAt(r, mu, (a+b)*.5));
    for (let c=0; c<3; c++) column[c]+=d[c]*(b-a);
  }
  return [0, 1, 2].map(c => parameters.rayleigh[c]*column[0]+parameters.mieExtinction[c]*column[1]+parameters.ozone[c]*column[2]);
}
export function atmosphericTransmittance(parameters, altitude, mu, steps = 48) {
  if (groundHit(R+Math.max(.001, altitude), mu)) return [0, 0, 0];
  return opticalDepth(parameters, altitude, mu, steps).map(t => Math.exp(-t));
}
export function blackbodyTint(temperature = 5778) {
  // Planck radiance at representative RGB wavelengths, relative to solar 5778 K.
  // This is an RGB tint, not a CIE spectral integration / colour temperature fit.
  const t=clamp(finite(temperature, 5778), 1500, 15000), c2=.01438776877;
  const color=[680e-9, 550e-9, 440e-9].map(w => Math.expm1(c2/(w*5778))/Math.expm1(c2/(w*t)));
  const y=Math.max(1e-12, luminance(color));
  return color.map(v => v/y);
}

class OpticalTables {
  constructor(parameters) {
    this.parameters=parameters; this.width=96; this.height=32;
    this.data=new Float32Array(this.width*this.height*3);
    for (let y=0; y<this.height; y++) for (let x=0; x<this.width; x++) {
      const h=.001+99.998*(y/(this.height-1))**2, v=x/(this.width-1)*2-1, mu=Math.sign(v)*v*v;
      this.data.set(atmosphericTransmittance(parameters, h, mu, 40), (y*this.width+x)*3);
    }
    this.multiHeights=[.02, 2, 6, 14, 30, 65, 99]; this.multiWidth=16;
    this.multiple=new Float32Array(this.multiHeights.length*this.multiWidth*3);
    // Angular mean of first-order transport, with an isotropic higher-order
    // geometric closure. No claim of full angular multiple-scattering transport.
    for (let y=0; y<this.multiHeights.length; y++) for (let x=0; x<this.multiWidth; x++) {
      const h=this.multiHeights[y], muSun=x/(this.multiWidth-1)*1.3-.3;
      const sun=[Math.sqrt(Math.max(0,1-muSun*muSun)), 0, muSun], sum=[0,0,0], feedback=[0,0,0];
      for (let i=0; i<12; i++) {
        const mu=1-2*(i+.5)/12, az=i*2.39996323;
        const rd=[Math.cos(az)*Math.sqrt(1-mu*mu),Math.sin(az)*Math.sqrt(1-mu*mu),mu];
        const radiance=this.integrate(h,rd,sun,12,false), tau=opticalDepth(parameters,h,mu,20);
        for (let c=0; c<3; c++) {
          sum[c]+=radiance[c]/12;
          const scattering=parameters.rayleigh[c]*8+parameters.mieScattering[c]*1.2;
          const extinction=parameters.rayleigh[c]*8+parameters.mieExtinction[c]*1.2+parameters.ozone[c]*15;
          feedback[c]+=(1-Math.exp(-tau[c]))*scattering/Math.max(1e-9,extinction)/12;
        }
      }
      this.multiple.set(sum.map((v,c) => v/(1-clamp(feedback[c],0,.85))), (y*this.multiWidth+x)*3);
    }
  }
  transmittance(h, mu) {
    if (groundHit(R+Math.max(.001,h),mu)) return [0,0,0];
    const v=Math.sign(mu)*Math.sqrt(Math.abs(clamp(mu,-1,1)));
    return this.sample(this.data,this.width,this.height,(v+1)*.5*(this.width-1),Math.sqrt(clamp(h,.001,99.99)/100)*(this.height-1));
  }
  sample(data,w,h,x,y) {
    x=clamp(x,0,w-1);y=clamp(y,0,h-1);
    const a=Math.floor(x),b=Math.floor(y),fx=x-a,fy=y-b;
    return [0,1,2].map(c => {
      const at=(i,j)=>data[(Math.min(j,h-1)*w+Math.min(i,w-1))*3+c];
      return (at(a,b)*(1-fx)+at(a+1,b)*fx)*(1-fy)+(at(a,b+1)*(1-fx)+at(a+1,b+1)*fx)*fy;
    });
  }
  multi(h, mu) {
    let y=0; while(y<this.multiHeights.length-2 && h>this.multiHeights[y+1]) y++;
    const position=y+clamp((h-this.multiHeights[y])/(this.multiHeights[y+1]-this.multiHeights[y]),0,1);
    return this.sample(this.multiple,this.multiWidth,this.multiHeights.length,clamp((mu+.3)/1.3,0,1)*(this.multiWidth-1),position);
  }
  integrate(height, rd, sun, steps, multiple=true) {
    const r=R+height, length=boundary(r,rd[2]), p=this.parameters;
    const phaseR=phaseRayleigh(dot(rd,sun)), phaseM=phaseMie(dot(rd,sun),p.g);
    const transmission=[1,1,1], radiance=[0,0,0];
    for (let i=0; i<steps; i++) {
      const a=length*(i/steps)**2, b=length*((i+1)/steps)**2, t=(a+b)*.5, ds=b-a;
      const point=[rd[0]*t,rd[1]*t,r+rd[2]*t], radius=Math.hypot(...point), h=Math.max(0,radius-R), mu=dot(point,sun)/radius;
      const d=densityProfile(h), direct=this.transmittance(h,mu), indirect=multiple&&p.multiple>0?this.multi(h,mu):[0,0,0];
      for (let c=0; c<3; c++) {
        const scatter=p.rayleigh[c]*d[0]+p.mieScattering[c]*d[1];
        const extinction=p.rayleigh[c]*d[0]+p.mieExtinction[c]*d[1]+p.ozone[c]*d[2];
        const stepT=Math.exp(-extinction*ds);
        const source=direct[c]*(p.rayleigh[c]*d[0]*phaseR+p.mieScattering[c]*d[1]*phaseM)+scatter*indirect[c]*p.multiple;
        radiance[c]+=transmission[c]*source*(extinction>1e-10?(1-stepT)/extinction:ds);
        transmission[c]*=stepT;
      }
    }
    if (groundHit(r,rd[2])) {
      const point=[rd[0]*length,rd[1]*length,r+rd[2]*length], mu=dot(point,sun)/R, direct=this.transmittance(.02,mu);
      for (let c=0; c<3; c++) radiance[c]+=transmission[c]*p.groundAlbedo/PI*direct[c]*Math.max(0,mu);
    }
    return radiance;
  }
}

export function buildAtmosphereLut(tables, elevation, quality='low') {
  const {width,height,steps}=ATMOSPHERE_BUDGETS[quality]||ATMOSPHERE_BUDGETS.low;
  const e=clamp(finite(elevation,7),-90,90)*PI/180, sun=[0,Math.cos(e),Math.sin(e)];
  const data=new Float32Array(width*height*4), ambient=[0,0,0]; let weightSum=0;
  for(let y=0;y<height;y++) {
    const el=(1-(y+.5)/height)**2*PI*.5, ce=Math.cos(el), se=Math.sin(el);
    const solidAngleWeight=ce*se*Math.max(1e-6,1-(y+.5)/height);
    for(let x=0;x<width;x++) {
      const az=(x+.5)/width*2*PI;
      const c=tables.integrate(.02,[Math.sin(az)*ce,Math.cos(az)*ce,se],sun,steps);
      for(let i=0;i<3;i++) { data[(y*width+x)*4+i]=c[i]*6;ambient[i]+=c[i]*6*solidAngleWeight; }
      data[(y*width+x)*4+3]=1;weightSum+=solidAngleWeight;
    }
  }
  return {width,height,data,ambient:ambient.map(v=>v/Math.max(1e-12,weightSum)),direct:tables.transmittance(.02,Math.sin(e)),parameters:tables.parameters};
}
export function encodeAtmosphereRGBM(data) {
  const bytes=new Uint8Array(data.length);
  for(let i=0;i<data.length;i+=4) {
    const m=clamp(Math.ceil(Math.max(data[i],data[i+1],data[i+2])/32*255),1,255);
    for(let c=0;c<3;c++) bytes[i+c]=Math.round(clamp(data[i+c]/(m/255*32),0,1)*255);
    bytes[i+3]=m;
  }
  return bytes;
}
export class AtmosphereTransport {
  constructor(){this.builds=0;this.opticalBuilds=0;}
  // Cloud layer lighting samples the existing optical table at its own altitude.
  // Metres enter here; the spherical transport table uses kilometres.
  sunTransmission(altitudeMetres=20,elevation=7) {
    if(!this.tables)throw new Error('Update atmosphere transport before sampling sunlight.');
    return this.tables.transmittance(clamp(finite(altitudeMetres,20)*.001,.001,99.99),Math.sin(clamp(finite(elevation,7),-90,90)*PI/180));
  }
  update(atmosphere={},sun={},quality='low') {
    const params=atmosphereParameters(atmosphere), opticalKey=JSON.stringify(params);
    if(opticalKey!==this.opticalKey) { this.tables=new OpticalTables(params);this.opticalKey=opticalKey;this.opticalBuilds++;this.skyKey=null; }
    const key=JSON.stringify([opticalKey,finite(sun.elevation,7),quality]);
    if(key!==this.skyKey) { this.lut=buildAtmosphereLut(this.tables,sun.elevation,quality);this.skyKey=key;this.builds++; }
    return this.lut;
  }
}
