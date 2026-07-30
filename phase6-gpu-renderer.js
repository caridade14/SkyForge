(function bootstrapSkyForgePhase6(factory) {
  const root = typeof window !== "undefined" ? window : null;
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.SkyForgePhase6Renderer = api;
    if (root.document?.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", api.install, { once: true });
    } else {
      api.install();
    }
  }
})(function createSkyForgePhase6Renderer(root) {
  "use strict";

  const VERSION = "0.6.0";
  const STORAGE_KEY = "skyforge.phase6.renderer.v1";
  const DEFAULTS = Object.freeze({
    enabled: true,
    backend: "auto",
    mode: "hybrid",
    quality: "production",
    exposure: 0,
    bloom: 0.28,
    cloudCoverage: 0.36,
    cloudDensity: 0.58,
    aerialPerspective: 0.72,
    groundBounce: 0.18,
    referenceObjects: false,
    resolutionScale: 0.72,
    galaxy: {
      enabled: true,
      type: "spiral",
      seed: 8347,
      starDensity: 0.72,
      armCount: 4,
      armTwist: 3.6,
      radius: 1.0,
      thickness: 0.22,
      coreSize: 0.24,
      coreIntensity: 1.25,
      dust: 0.48,
      nebula: 0.42,
      temperature: 6200,
      rotation: 0.0,
      inclination: 0.28,
      blackHole: 0.0,
      lensing: 0.0,
      animate: true,
      animationSpeed: 0.018
    }
  });

  const state = {
    installed: false,
    canvas: null,
    viewport: null,
    backend: null,
    backendName: "none",
    frameHandle: null,
    resizeObserver: null,
    lastFrameMs: 0,
    startMs: 0,
    fps: 0,
    frameCounter: 0,
    fpsWindowStart: 0,
    settings: clone(DEFAULTS),
    webgpu: null,
    webgl: null,
    statusBadge: null,
    hooksInstalled: false,
    needsResize: true,
    lastError: null
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function finiteOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function mergeSettings(base, patch) {
    const next = clone(base);
    if (!patch || typeof patch !== "object") return next;
    for (const [key, value] of Object.entries(patch)) {
      if (key === "galaxy" && value && typeof value === "object") {
        next.galaxy = { ...next.galaxy, ...value };
      } else if (value !== undefined) {
        next[key] = value;
      }
    }
    return sanitizeSettings(next);
  }

  function sanitizeSettings(input) {
    const next = clone(DEFAULTS);
    const source = input && typeof input === "object" ? input : {};
    next.enabled = source.enabled !== false;
    next.backend = ["auto", "webgpu", "webgl2"].includes(source.backend) ? source.backend : "auto";
    next.mode = ["atmosphere", "galaxy", "hybrid"].includes(source.mode) ? source.mode : "hybrid";
    next.quality = ["realtime", "production", "reference"].includes(source.quality) ? source.quality : "production";
    next.exposure = clamp(source.exposure ?? 0, -8, 8);
    next.bloom = clamp(source.bloom ?? DEFAULTS.bloom, 0, 2);
    next.cloudCoverage = clamp(source.cloudCoverage ?? DEFAULTS.cloudCoverage, 0, 1);
    next.cloudDensity = clamp(source.cloudDensity ?? DEFAULTS.cloudDensity, 0, 2);
    next.aerialPerspective = clamp(source.aerialPerspective ?? DEFAULTS.aerialPerspective, 0, 2);
    next.groundBounce = clamp(source.groundBounce ?? DEFAULTS.groundBounce, 0, 1);
    next.referenceObjects = Boolean(source.referenceObjects);
    next.resolutionScale = clamp(source.resolutionScale ?? DEFAULTS.resolutionScale, 0.3, 1);

    const galaxy = source.galaxy && typeof source.galaxy === "object" ? source.galaxy : {};
    next.galaxy.enabled = galaxy.enabled !== false;
    next.galaxy.type = ["spiral", "barred", "elliptical", "irregular", "ring"].includes(galaxy.type)
      ? galaxy.type
      : DEFAULTS.galaxy.type;
    next.galaxy.seed = Math.round(clamp(galaxy.seed ?? DEFAULTS.galaxy.seed, 0, 999999));
    next.galaxy.starDensity = clamp(galaxy.starDensity ?? DEFAULTS.galaxy.starDensity, 0, 1.5);
    next.galaxy.armCount = Math.round(clamp(galaxy.armCount ?? DEFAULTS.galaxy.armCount, 1, 8));
    next.galaxy.armTwist = clamp(galaxy.armTwist ?? DEFAULTS.galaxy.armTwist, 0.2, 8);
    next.galaxy.radius = clamp(galaxy.radius ?? DEFAULTS.galaxy.radius, 0.2, 2.5);
    next.galaxy.thickness = clamp(galaxy.thickness ?? DEFAULTS.galaxy.thickness, 0.03, 0.8);
    next.galaxy.coreSize = clamp(galaxy.coreSize ?? DEFAULTS.galaxy.coreSize, 0.03, 0.8);
    next.galaxy.coreIntensity = clamp(galaxy.coreIntensity ?? DEFAULTS.galaxy.coreIntensity, 0, 4);
    next.galaxy.dust = clamp(galaxy.dust ?? DEFAULTS.galaxy.dust, 0, 1.5);
    next.galaxy.nebula = clamp(galaxy.nebula ?? DEFAULTS.galaxy.nebula, 0, 1.5);
    next.galaxy.temperature = clamp(galaxy.temperature ?? DEFAULTS.galaxy.temperature, 1800, 18000);
    next.galaxy.rotation = clamp(galaxy.rotation ?? DEFAULTS.galaxy.rotation, -Math.PI * 8, Math.PI * 8);
    next.galaxy.inclination = clamp(galaxy.inclination ?? DEFAULTS.galaxy.inclination, -1.45, 1.45);
    next.galaxy.blackHole = clamp(galaxy.blackHole ?? DEFAULTS.galaxy.blackHole, 0, 1);
    next.galaxy.lensing = clamp(galaxy.lensing ?? DEFAULTS.galaxy.lensing, 0, 1);
    next.galaxy.animate = galaxy.animate !== false;
    next.galaxy.animationSpeed = clamp(galaxy.animationSpeed ?? DEFAULTS.galaxy.animationSpeed, 0, 0.2);
    return next;
  }

  function loadSettings() {
    try {
      const raw = root?.localStorage?.getItem(STORAGE_KEY);
      if (raw) state.settings = mergeSettings(DEFAULTS, JSON.parse(raw));
    } catch {
      state.settings = clone(DEFAULTS);
    }
  }

  function persistSettings() {
    try {
      root?.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch {
      // Storage is optional.
    }
  }

  function emit(name, detail) {
    if (!root?.dispatchEvent || typeof root.CustomEvent !== "function") return;
    root.dispatchEvent(new root.CustomEvent(name, { detail }));
  }

  function createCanvas() {
    const documentRef = root?.document;
    const viewport = documentRef?.getElementById("vp");
    if (!documentRef || !viewport) return null;
    state.viewport = viewport;
    try {
      if (root.getComputedStyle?.(viewport).position === "static") viewport.style.position = "relative";
    } catch {
      // Optional.
    }
    let canvas = documentRef.getElementById("sf-phase6-gpu-canvas");
    if (!canvas) {
      canvas = documentRef.createElement("canvas");
      canvas.id = "sf-phase6-gpu-canvas";
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.cssText = [
        "position:absolute",
        "inset:0",
        "width:100%",
        "height:100%",
        "pointer-events:none",
        "z-index:1",
        "opacity:1",
        "transition:opacity .2s ease",
        "background:#02040a"
      ].join(";");
      const anchor = documentRef.getElementById("ab-canvas") || viewport.firstChild;
      viewport.insertBefore(canvas, anchor);
    }
    state.canvas = canvas;
    if (typeof root.ResizeObserver === "function") {
      state.resizeObserver?.disconnect();
      state.resizeObserver = new root.ResizeObserver(() => {
        state.needsResize = true;
      });
      state.resizeObserver.observe(viewport);
    }
    return canvas;
  }

  function createStatusBadge() {
    const documentRef = root?.document;
    const host = documentRef?.querySelector(".vp-bar .vp-r") || documentRef?.querySelector(".vp-r");
    if (!host) return null;
    let badge = documentRef.getElementById("sf-phase6-badge");
    if (!badge) {
      badge = documentRef.createElement("button");
      badge.id = "sf-phase6-badge";
      badge.type = "button";
      badge.className = "sf-phase6-badge loading";
      badge.title = "Toggle SkyForge Phase 6 GPU renderer";
      badge.addEventListener("click", () => setEnabled(!state.settings.enabled));
      host.prepend(badge);
    }
    state.statusBadge = badge;
    updateBadge("loading", "GPU 6 · INIT");
    return badge;
  }

  function updateBadge(status, text) {
    const badge = state.statusBadge;
    if (!badge) return;
    badge.classList.remove("loading", "error", "off", "live");
    badge.classList.add(status);
    badge.textContent = text;
    badge.title = state.lastError || `SkyForge Phase 6 · ${state.backendName} · ${Math.round(state.fps)} FPS`;
  }

  function qualitySteps() {
    if (state.settings.quality === "reference") return 72;
    if (state.settings.quality === "realtime") return 28;
    return 48;
  }

  function galaxyTypeId(type) {
    return { spiral: 0, barred: 1, elliptical: 2, irregular: 3, ring: 4 }[type] ?? 0;
  }

  function modeId(mode) {
    return { atmosphere: 0, galaxy: 1, hybrid: 2 }[mode] ?? 2;
  }

  function collectHostLighting() {
    const phase5 = root?.SkyForgeNaturalLightPhase5?.getState?.();
    const phase4 = root?.SkyForgeNaturalLightPreview?.getState?.();
    const evaluation = phase5?.pipeline?.evaluation || phase5?.payload?.evaluation || phase4?.evaluation || null;
    const solar = evaluation?.solarPosition || {};
    const direction = solar.sunDirection || { x: 0.4, y: 0.55, z: 0.72 };
    return {
      sunDirection: [finiteOr(direction.x, 0.4), finiteOr(direction.y, 0.55), finiteOr(direction.z, 0.72)],
      sunElevation: finiteOr(solar.apparentElevationDeg, 34) * Math.PI / 180,
      sunAzimuth: finiteOr(solar.azimuthDeg, 220) * Math.PI / 180,
      dni: finiteOr(evaluation?.irradiance?.directNormalWm2, 720),
      cct: finiteOr(evaluation?.color?.directSunCctEstimatedK, 5600),
      skyRgb: evaluation?.color?.zenithSkyLinearSrgb || { r: 0.18, g: 0.36, b: 0.8 }
    };
  }

  function buildUniformValues(timeSeconds, width, height) {
    const s = state.settings;
    const g = s.galaxy;
    const light = collectHostLighting();
    return new Float32Array([
      width, height, timeSeconds, Math.pow(2, s.exposure),
      light.sunDirection[0], light.sunDirection[1], light.sunDirection[2], light.dni / 1000,
      light.skyRgb.r || 0.18, light.skyRgb.g || 0.36, light.skyRgb.b || 0.8, s.bloom,
      s.cloudCoverage, s.cloudDensity, s.aerialPerspective, s.groundBounce,
      modeId(s.mode), qualitySteps(), s.referenceObjects ? 1 : 0, galaxyTypeId(g.type),
      g.enabled ? 1 : 0, g.seed, g.starDensity, g.armCount,
      g.armTwist, g.radius, g.thickness, g.coreSize,
      g.coreIntensity, g.dust, g.nebula, g.temperature,
      g.rotation, g.inclination, g.blackHole, g.lensing,
      g.animate ? 1 : 0, g.animationSpeed, light.sunElevation, light.sunAzimuth
    ]);
  }

  const WGSL = String.raw`
struct Uniforms {
  resolutionTimeExposure: vec4f,
  sunDirDni: vec4f,
  skyBloom: vec4f,
  atmosphere: vec4f,
  renderFlags: vec4f,
  galaxyA: vec4f,
  galaxyB: vec4f,
  galaxyC: vec4f,
  galaxyD: vec4f,
  galaxyE: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn hash21(p: vec2f) -> f32 {
  let q = fract(p * vec2f(123.34,456.21));
  return fract((q.x + q.y) * (q.x + q.y + 45.32));
}
fn hash22(p: vec2f) -> vec2f {
  return vec2f(hash21(p), hash21(p + 37.17));
}
fn noise2(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let s = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2f(1,0)),s.x),mix(hash21(i+vec2f(0,1)),hash21(i+vec2f(1,1)),s.x),s.y);
}
fn fbm(p0: vec2f) -> f32 {
  var p = p0; var a = 0.5; var v = 0.0;
  for (var i=0; i<5; i=i+1) { v += a*noise2(p); p = p*2.03+17.1; a *= 0.5; }
  return v;
}
fn aces(x: vec3f) -> vec3f {
  let a=2.51; let b=0.03; let c=2.43; let d=0.59; let e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),vec3f(0),vec3f(1));
}
fn kelvin(k0: f32) -> vec3f {
  let k = clamp(k0,1800.0,18000.0)/100.0;
  var r: f32; var g: f32; var b: f32;
  if (k <= 66.0) { r=1.0; g=clamp((99.4708*log(k)-161.1196)/255.0,0.0,1.0); }
  else { r=clamp((329.6987*pow(k-60.0,-0.1332))/255.0,0.0,1.0); g=clamp((288.1222*pow(k-60.0,-0.0755))/255.0,0.0,1.0); }
  if (k >= 66.0) { b=1.0; } else if (k <= 19.0) { b=0.0; } else { b=clamp((138.5177*log(k-10.0)-305.0448)/255.0,0.0,1.0); }
  return vec3f(r,g,b);
}
fn rotate(p: vec2f,a:f32)->vec2f{let c=cos(a);let s=sin(a);return vec2f(c*p.x-s*p.y,s*p.x+c*p.y);}
fn galaxy(uv0: vec2f, time: f32) -> vec3f {
  if (u.galaxyA.x < 0.5) { return vec3f(0); }
  var uv = rotate(uv0, u.galaxyD.x + time*u.galaxyE.y*u.galaxyE.x);
  uv.y /= max(cos(u.galaxyD.y),0.12);
  let r = length(uv)/max(u.galaxyB.y,0.01);
  let a = atan2(uv.y,uv.x);
  let typ = i32(u.renderFlags.w+0.5);
  var structure = 0.0;
  if (typ == 2) {
    structure = exp(-r*r*2.8);
  } else if (typ == 3) {
    structure = smoothstep(1.05,0.0,r)*(0.35+0.9*fbm(uv*3.2+u.galaxyA.y));
  } else if (typ == 4) {
    structure = exp(-pow((r-0.55)/0.16,2.0));
  } else {
    let arms = max(u.galaxyA.w,1.0);
    let spiral = abs(sin(a*arms + log(max(r,0.03))*u.galaxyB.x));
    let armBand = pow(1.0-smoothstep(0.06,0.55,spiral),1.5);
    let bar = select(0.0,exp(-abs(uv.y)*15.0)*smoothstep(0.72,0.0,abs(uv.x)),typ==1);
    structure = smoothstep(1.05,0.0,r)*(0.16+1.2*armBand)+bar;
  }
  let core = exp(-pow(r/max(u.galaxyB.w,0.03),1.35))*u.galaxyC.x;
  let dustNoise = fbm(uv*7.0+vec2f(u.galaxyA.y*0.001,17.0));
  let dust = exp(-abs(dustNoise-0.48)*7.0)*u.galaxyC.y*structure;
  let nebula = pow(fbm(uv*4.1+vec2f(23.4,u.galaxyA.y*0.002)),2.2)*u.galaxyC.z*structure;
  var color = kelvin(u.galaxyC.w)*(structure*0.28+core*1.55);
  color += vec3f(0.18,0.26,0.9)*nebula*0.7 + vec3f(0.95,0.15,0.48)*nebula*0.38;
  color *= 1.0-dust*0.72;
  let grid = floor((uv+2.0)*850.0);
  let cell = fract((uv+2.0)*850.0)-0.5;
  let rnd = hash22(grid+u.galaxyA.y);
  let starMask = step(1.0-u.galaxyA.z*0.035*structure,rnd.x);
  let star = starMask*exp(-dot(cell,cell)*mix(500.0,2600.0,rnd.y));
  color += mix(vec3f(1.0,0.64,0.36),vec3f(0.55,0.72,1.0),rnd.y)*star*6.0;
  let bh = u.galaxyD.z;
  if (bh > 0.001) {
    let d = length(uv);
    let ring = exp(-pow((d-0.052-0.025*u.galaxyD.w)/0.012,2.0));
    color += vec3f(1.0,0.55,0.12)*ring*bh*3.0;
    color *= smoothstep(0.018*bh,0.045*bh,d);
  }
  return color;
}
fn atmosphere(uv: vec2f) -> vec3f {
  let horizon = clamp(1.0-uv.y,0.0,1.0);
  let zenith = u.skyBloom.xyz;
  var col = mix(zenith*1.15,vec3f(0.72,0.48,0.28),pow(horizon,2.3));
  let sunUv = normalize(vec2f(u.sunDirDni.x,u.sunDirDni.y+0.0001));
  let viewUv = normalize(vec2f(uv.x,uv.y+0.15));
  let mu = clamp(dot(sunUv,viewUv),-1.0,1.0);
  let mie = pow(max(mu,0.0),64.0)*u.sunDirDni.w;
  let disc = smoothstep(0.99975,0.99996,mu)*u.sunDirDni.w;
  col += vec3f(1.0,0.72,0.38)*mie*1.8 + vec3f(1.0,0.92,0.72)*disc*8.0;
  let cloudP = vec2f(uv.x*2.0+u.resolutionTimeExposure.z*0.006,uv.y*2.7);
  let c = smoothstep(1.0-u.atmosphere.x,1.0,fbm(cloudP))*u.atmosphere.y;
  col = mix(col,col*0.48+vec3f(0.54,0.58,0.62)*0.72,c*0.72);
  return col;
}
fn sceneObjects(uv: vec2f, bg: vec3f) -> vec3f {
  if (u.renderFlags.z < 0.5) { return bg; }
  var col = bg;
  let p = uv-vec2f(0.24,-0.18);
  let rr = dot(p,p);
  if (rr < 0.095) {
    let z = sqrt(0.095-rr);
    let n = normalize(vec3f(p.x,p.y,z));
    let l = normalize(u.sunDirDni.xyz);
    let ndl = max(dot(n,l),0.0);
    let v = vec3f(0,0,1);
    let h = normalize(l+v);
    let spec = pow(max(dot(n,h),0.0),64.0);
    let fres = pow(1.0-max(dot(n,v),0.0),5.0);
    col = vec3f(0.07,0.09,0.12)*(0.22+ndl*1.1)+vec3f(0.95,0.72,0.42)*spec*2.0+bg*(0.12+fres*0.65);
  }
  if (uv.y < -0.38) {
    let haze = exp(-(uv.y+0.38)*-7.0);
    col = mix(vec3f(0.05,0.055,0.06)*(1.0+u.atmosphere.w),bg,haze*0.32);
  }
  return col;
}
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
  var p=array<vec2f,3>(vec2f(-1,-3),vec2f(3,1),vec2f(-1,1));
  return vec4f(p[i],0,1);
}
@fragment fn fs(@builtin(position) frag:vec4f)->@location(0) vec4f {
  let res=u.resolutionTimeExposure.xy;
  var uv=(frag.xy/res)*2.0-1.0;
  uv.x*=res.x/max(res.y,1.0);
  let mode=i32(u.renderFlags.x+0.5);
  var col=vec3f(0);
  if (mode != 1) { col += atmosphere(uv); }
  if (mode != 0) {
    let g=galaxy(uv*0.72,u.resolutionTimeExposure.z);
    col = select(g,col+g*mix(0.45,1.0,smoothstep(-0.1,0.7,uv.y)),mode==2);
  }
  col=sceneObjects(uv,col);
  let vig=1.0-0.16*dot(uv*0.48,uv*0.48);
  col*=max(vig,0.45)*u.resolutionTimeExposure.w;
  col += max(col-vec3f(1.0),vec3f(0))*u.skyBloom.w*0.16;
  return vec4f(aces(col),1.0);
}`;

  const GLSL_VERTEX = `#version 300 es
  precision highp float;
  const vec2 p[3]=vec2[3](vec2(-1.0,-3.0),vec2(3.0,1.0),vec2(-1.0,1.0));
  void main(){gl_Position=vec4(p[gl_VertexID],0.0,1.0);}`;

  const GLSL_FRAGMENT = `#version 300 es
  precision highp float;
  out vec4 outColor;
  uniform vec4 uData[10];
  #define U0 uData[0]
  #define U1 uData[1]
  #define U2 uData[2]
  #define U3 uData[3]
  #define U4 uData[4]
  #define U5 uData[5]
  #define U6 uData[6]
  #define U7 uData[7]
  #define U8 uData[8]
  #define U9 uData[9]
  float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));return fract((p.x+p.y)*(p.x+p.y+45.32));}
  vec2 hash22(vec2 p){return vec2(hash21(p),hash21(p+37.17));}
  float noise2(vec2 p){vec2 i=floor(p),f=fract(p),s=f*f*(3.0-2.0*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),s.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),s.x),s.y);}
  float fbm(vec2 p){float a=.5,v=0.;for(int i=0;i<5;i++){v+=a*noise2(p);p=p*2.03+17.1;a*=.5;}return v;}
  vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
  vec3 kelvin(float k0){float k=clamp(k0,1800.,18000.)/100.;float r,g,b;if(k<=66.){r=1.;g=clamp((99.4708*log(k)-161.1196)/255.,0.,1.);}else{r=clamp((329.6987*pow(k-60.,-.1332))/255.,0.,1.);g=clamp((288.1222*pow(k-60.,-.0755))/255.,0.,1.);}if(k>=66.)b=1.;else if(k<=19.)b=0.;else b=clamp((138.5177*log(k-10.)-305.0448)/255.,0.,1.);return vec3(r,g,b);}
  vec2 rot(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
  vec3 galaxy(vec2 uv,float time){if(U5.x<.5)return vec3(0);uv=rot(uv,U8.x+time*U9.y*U9.x);uv.y/=max(cos(U8.y),.12);float r=length(uv)/max(U6.y,.01),a=atan(uv.y,uv.x);int typ=int(U4.w+.5);float structure=0.;if(typ==2)structure=exp(-r*r*2.8);else if(typ==3)structure=smoothstep(1.05,0.,r)*(.35+.9*fbm(uv*3.2+U5.y));else if(typ==4)structure=exp(-pow((r-.55)/.16,2.));else{float arms=max(U5.w,1.);float spiral=abs(sin(a*arms+log(max(r,.03))*U6.x));float arm=pow(1.-smoothstep(.06,.55,spiral),1.5);float bar=typ==1?exp(-abs(uv.y)*15.)*smoothstep(.72,0.,abs(uv.x)):0.;structure=smoothstep(1.05,0.,r)*(.16+1.2*arm)+bar;}float core=exp(-pow(r/max(U6.w,.03),1.35))*U7.x;float dust=exp(-abs(fbm(uv*7.+vec2(U5.y*.001,17.))-.48)*7.)*U7.y*structure;float neb=pow(fbm(uv*4.1+vec2(23.4,U5.y*.002)),2.2)*U7.z*structure;vec3 col=kelvin(U7.w)*(structure*.28+core*1.55);col+=vec3(.18,.26,.9)*neb*.7+vec3(.95,.15,.48)*neb*.38;col*=1.-dust*.72;vec2 grid=floor((uv+2.)*850.),cell=fract((uv+2.)*850.)-.5,rnd=hash22(grid+U5.y);float star=step(1.-U5.z*.035*structure,rnd.x)*exp(-dot(cell,cell)*mix(500.,2600.,rnd.y));col+=mix(vec3(1.,.64,.36),vec3(.55,.72,1.),rnd.y)*star*6.;if(U8.z>.001){float d=length(uv);float ring=exp(-pow((d-.052-.025*U8.w)/.012,2.));col+=vec3(1.,.55,.12)*ring*U8.z*3.;col*=smoothstep(.018*U8.z,.045*U8.z,d);}return col;}
  vec3 atmosphere(vec2 uv){float horizon=clamp(1.-uv.y,0.,1.);vec3 col=mix(U2.xyz*1.15,vec3(.72,.48,.28),pow(horizon,2.3));vec2 su=normalize(vec2(U1.x,U1.y+.0001)),vu=normalize(vec2(uv.x,uv.y+.15));float mu=clamp(dot(su,vu),-1.,1.);float mie=pow(max(mu,0.),64.)*U1.w,disc=smoothstep(.99975,.99996,mu)*U1.w;col+=vec3(1.,.72,.38)*mie*1.8+vec3(1.,.92,.72)*disc*8.;float c=smoothstep(1.-U3.x,1.,fbm(vec2(uv.x*2.+U0.z*.006,uv.y*2.7)))*U3.y;return mix(col,col*.48+vec3(.54,.58,.62)*.72,c*.72);}
  vec3 objects(vec2 uv,vec3 bg){if(U4.z<.5)return bg;vec3 col=bg;vec2 p=uv-vec2(.24,-.18);float rr=dot(p,p);if(rr<.095){float z=sqrt(.095-rr);vec3 n=normalize(vec3(p,z)),l=normalize(U1.xyz),v=vec3(0,0,1),h=normalize(l+v);float ndl=max(dot(n,l),0.),spec=pow(max(dot(n,h),0.),64.),fres=pow(1.-max(dot(n,v),0.),5.);col=vec3(.07,.09,.12)*(.22+ndl*1.1)+vec3(.95,.72,.42)*spec*2.+bg*(.12+fres*.65);}if(uv.y<-.38){float haze=exp(-(uv.y+.38)*-7.);col=mix(vec3(.05,.055,.06)*(1.+U3.w),bg,haze*.32);}return col;}
  void main(){vec2 res=U0.xy,uv=gl_FragCoord.xy/res*2.-1.;uv.x*=res.x/max(res.y,1.);int mode=int(U4.x+.5);vec3 col=vec3(0);if(mode!=1)col+=atmosphere(uv);if(mode!=0){vec3 g=galaxy(uv*.72,U0.z);col=mode==2?col+g*mix(.45,1.,smoothstep(-.1,.7,uv.y)):g;}col=objects(uv,col);float vig=1.-.16*dot(uv*.48,uv*.48);col*=max(vig,.45)*U0.w;col+=max(col-1.,0.)*U2.w*.16;outColor=vec4(aces(col),1.);}`;

  async function initWebGPU() {
    if (!root?.navigator?.gpu || !state.canvas) throw new Error("WebGPU unavailable");
    const adapter = await root.navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter");
    const device = await adapter.requestDevice();
    const context = state.canvas.getContext("webgpu");
    const format = root.navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });
    const module = device.createShaderModule({ code: WGSL });
    const uniformBuffer = device.createBuffer({
      size: 160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }]
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    const pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" }
    });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
    });
    device.lost.then((info) => {
      state.lastError = `WebGPU device lost: ${info.message || info.reason}`;
      switchBackend("webgl2");
    });
    state.webgpu = { adapter, device, context, format, pipeline, uniformBuffer, bindGroup };
    state.backendName = "WebGPU";
    state.backend = "webgpu";
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${log}`);
    }
    return shader;
  }

  function initWebGL2() {
    if (!state.canvas) throw new Error("Canvas unavailable");
    const gl = state.canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
      premultipliedAlpha: true
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    const vs = compileShader(gl, gl.VERTEX_SHADER, GLSL_VERTEX);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, GLSL_FRAGMENT);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    const vao = gl.createVertexArray();
    const uniformLocation = gl.getUniformLocation(program, "uData[0]");
    state.webgl = { gl, program, vao, uniformLocation };
    state.backendName = "WebGL2";
    state.backend = "webgl2";
  }

  async function initializeBackend() {
    const requested = state.settings.backend;
    state.lastError = null;
    if (requested !== "webgl2") {
      try {
        await initWebGPU();
        updateBadge("live", "GPU 6 · WEBGPU");
        return;
      } catch (error) {
        state.lastError = error?.message || String(error);
        if (requested === "webgpu") throw error;
      }
    }
    initWebGL2();
    updateBadge("live", "GPU 6 · WEBGL2");
  }

  async function switchBackend(backend) {
    state.settings.backend = backend;
    persistSettings();
    stopLoop();
    state.webgpu = null;
    state.webgl = null;
    try {
      await initializeBackend();
      startLoop();
      emit("skyforge:phase6-backend", getState());
    } catch (error) {
      state.lastError = error?.message || String(error);
      updateBadge("error", "GPU 6 · ERROR");
    }
  }

  function resizeCanvas() {
    if (!state.canvas || !state.viewport) return;
    const rect = state.viewport.getBoundingClientRect();
    const dpr = clamp(root?.devicePixelRatio || 1, 1, 2);
    const scale = state.settings.resolutionScale;
    const width = Math.max(2, Math.round(rect.width * dpr * scale));
    const height = Math.max(2, Math.round(rect.height * dpr * scale));
    if (state.canvas.width !== width || state.canvas.height !== height) {
      state.canvas.width = width;
      state.canvas.height = height;
      state.needsResize = false;
      if (state.webgpu?.context) {
        state.webgpu.context.configure({
          device: state.webgpu.device,
          format: state.webgpu.format,
          alphaMode: "premultiplied"
        });
      }
    }
  }

  function renderWebGPU(timeSeconds) {
    const gpu = state.webgpu;
    if (!gpu) return;
    const values = buildUniformValues(timeSeconds, state.canvas.width, state.canvas.height);
    gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, values);
    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.context.getCurrentTexture().createView(),
        clearValue: { r: 0.002, g: 0.004, b: 0.012, a: 1 },
        loadOp: "clear",
        storeOp: "store"
      }]
    });
    pass.setPipeline(gpu.pipeline);
    pass.setBindGroup(0, gpu.bindGroup);
    pass.draw(3);
    pass.end();
    gpu.device.queue.submit([encoder.finish()]);
  }

  function renderWebGL2(timeSeconds) {
    const data = state.webgl;
    if (!data) return;
    const { gl, program, vao, uniformLocation } = data;
    const values = buildUniformValues(timeSeconds, state.canvas.width, state.canvas.height);
    gl.viewport(0, 0, state.canvas.width, state.canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform4fv(uniformLocation, values);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now) {
    if (!state.settings.enabled) return;
    if (state.needsResize) resizeCanvas();
    if (!state.startMs) state.startMs = now;
    const timeSeconds = (now - state.startMs) / 1000;
    try {
      if (state.backend === "webgpu") renderWebGPU(timeSeconds);
      else if (state.backend === "webgl2") renderWebGL2(timeSeconds);
    } catch (error) {
      state.lastError = error?.message || String(error);
      updateBadge("error", "GPU 6 · ERROR");
    }
    state.frameCounter += 1;
    if (!state.fpsWindowStart) state.fpsWindowStart = now;
    const elapsed = now - state.fpsWindowStart;
    if (elapsed >= 1000) {
      state.fps = state.frameCounter * 1000 / elapsed;
      state.frameCounter = 0;
      state.fpsWindowStart = now;
      if (!state.lastError) updateBadge("live", `GPU 6 · ${state.backendName.toUpperCase()} · ${Math.round(state.fps)} FPS`);
      emit("skyforge:phase6-stats", getState());
    }
    state.frameHandle = root.requestAnimationFrame(frame);
  }

  function startLoop() {
    stopLoop();
    if (!state.settings.enabled || !root?.requestAnimationFrame) return;
    state.frameHandle = root.requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (state.frameHandle && root?.cancelAnimationFrame) root.cancelAnimationFrame(state.frameHandle);
    state.frameHandle = null;
  }

  function setEnabled(enabled) {
    state.settings.enabled = Boolean(enabled);
    if (state.canvas) state.canvas.style.opacity = state.settings.enabled ? "1" : "0";
    persistSettings();
    if (state.settings.enabled) {
      updateBadge("live", `GPU 6 · ${state.backendName.toUpperCase()}`);
      startLoop();
    } else {
      stopLoop();
      updateBadge("off", "GPU 6 · OFF");
    }
    emit("skyforge:phase6-settings", getState());
    return state.settings.enabled;
  }

  function setSettings(patch, options = {}) {
    const previousBackend = state.settings.backend;
    state.settings = mergeSettings(state.settings, patch);
    persistSettings();
    state.needsResize = true;
    if (patch?.backend && patch.backend !== previousBackend && options.reinitialize !== false) {
      switchBackend(state.settings.backend);
    }
    if (state.settings.enabled) startLoop();
    emit("skyforge:phase6-settings", getState());
    return getState();
  }

  function setGalaxy(patch) {
    return setSettings({ galaxy: patch });
  }

  function applyPreset(name) {
    const presets = {
      milkyWay: { type: "barred", seed: 8347, starDensity: 0.82, armCount: 4, armTwist: 4.1, coreSize: 0.22, dust: 0.72, nebula: 0.32, temperature: 6000, inclination: 0.18 },
      andromeda: { type: "spiral", seed: 31031, starDensity: 0.78, armCount: 2, armTwist: 2.9, coreSize: 0.34, dust: 0.42, nebula: 0.24, temperature: 6400, inclination: 0.55 },
      sombrero: { type: "spiral", seed: 4594, starDensity: 0.72, armCount: 2, armTwist: 2.1, coreSize: 0.42, dust: 1.1, nebula: 0.12, temperature: 5200, inclination: 1.18 },
      whirlpool: { type: "spiral", seed: 5194, starDensity: 0.9, armCount: 2, armTwist: 5.3, coreSize: 0.18, dust: 0.38, nebula: 0.7, temperature: 7200, inclination: 0.12 },
      starburst: { type: "irregular", seed: 823, starDensity: 1.12, armCount: 3, armTwist: 2.2, coreSize: 0.3, dust: 0.28, nebula: 1.15, temperature: 9400, inclination: 0.08 },
      elliptical: { type: "elliptical", seed: 870, starDensity: 0.92, armCount: 1, armTwist: 1, coreSize: 0.48, dust: 0.08, nebula: 0.06, temperature: 4600, inclination: 0.35 },
      ring: { type: "ring", seed: 9981, starDensity: 0.88, armCount: 2, armTwist: 2.8, coreSize: 0.1, dust: 0.22, nebula: 0.58, temperature: 7600, inclination: 0.28 }
    };
    if (!presets[name]) return getState();
    return setGalaxy(presets[name]);
  }

  function wrapAfter(name, callback) {
    const current = root?.[name];
    if (typeof current !== "function" || current.__sfPhase6Wrapped) return false;
    function wrapped(...args) {
      const result = current.apply(this, args);
      try { callback(args, result); } catch { /* Host safety. */ }
      return result;
    }
    wrapped.__sfPhase6Wrapped = true;
    wrapped.__sfPhase6Original = current;
    root[name] = wrapped;
    return true;
  }

  function installSceneHooks() {
    if (!root) return;
    const collectScene = root.sfCollectScene;
    if (typeof collectScene === "function" && !collectScene.__sfPhase6Wrapped) {
      function collectScenePhase6(...args) {
        const scene = collectScene.apply(this, args) || {};
        scene.rendering = scene.rendering && typeof scene.rendering === "object" ? scene.rendering : {};
        scene.rendering.phase6 = clone(state.settings);
        scene.galaxy = clone(state.settings.galaxy);
        return scene;
      }
      collectScenePhase6.__sfPhase6Wrapped = true;
      collectScenePhase6.__sfPhase6Original = collectScene;
      root.sfCollectScene = collectScenePhase6;
    }
    ["sfApplyScene", "sfApplySkyForgeScene", "sfNormalizeSkyForgeScene"].forEach((name) => {
      wrapAfter(name, (args, result) => {
        const candidate = result && typeof result === "object" ? result : args[0];
        const phase6 = candidate?.rendering?.phase6;
        const galaxy = candidate?.galaxy;
        if (phase6 || galaxy) setSettings({ ...(phase6 || {}), ...(galaxy ? { galaxy } : {}) });
      });
    });
    state.hooksInstalled = true;
  }

  async function install() {
    if (state.installed || !root?.document) return;
    state.installed = true;
    loadSettings();
    createCanvas();
    createStatusBadge();
    installSceneHooks();
    root.addEventListener("skyforge:galaxy-updated", (event) => setGalaxy(event.detail || {}));
    root.addEventListener("skyforge:natural-light-updated", () => { /* Read live in uniforms. */ });
    try {
      await initializeBackend();
      resizeCanvas();
      setEnabled(state.settings.enabled);
      emit("skyforge:phase6-ready", getState());
    } catch (error) {
      state.lastError = error?.message || String(error);
      updateBadge("error", "GPU 6 · UNAVAILABLE");
      emit("skyforge:phase6-error", { error: state.lastError });
    }
  }

  function destroy() {
    stopLoop();
    state.resizeObserver?.disconnect();
    state.canvas?.remove();
    state.statusBadge?.remove();
    state.installed = false;
  }

  function getState() {
    return {
      installed: state.installed,
      enabled: state.settings.enabled,
      backend: state.backendName,
      backendRequested: state.settings.backend,
      fps: state.fps,
      settings: clone(state.settings),
      version: VERSION,
      error: state.lastError
    };
  }

  return {
    VERSION,
    DEFAULTS,
    install,
    destroy,
    getState,
    setEnabled,
    setSettings,
    setGalaxy,
    applyPreset,
    switchBackend,
    sanitizeSettings,
    buildUniformValues
  };
});
