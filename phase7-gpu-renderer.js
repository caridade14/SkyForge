(function bootstrapSkyForgePhase7(factory) {
  const root = typeof window !== "undefined" ? window : null;
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.SkyForgePhase7Renderer = api;
    if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", api.install, { once: true });
    else api.install();
  }
})(function createSkyForgePhase7Renderer(root) {
  "use strict";

  const VERSION = "0.7.0";
  const STORAGE_KEY = "skyforge.phase7.renderer.v1";
  const DEFAULTS = Object.freeze({
    enabled: true,
    quality: "production",
    resolutionScale: 0.78,
    mode: "atmosphere",
    weather: {
      enabled: false,
      live: false,
      label: "Neutral atmosphere",
      isDay: true,
      weatherCode: 0,
      cloudCoverage: 0.18,
      cloudDensity: 0.46,
      cloudLow: 0.08,
      cloudMid: 0.08,
      cloudHigh: 0.06,
      humidity: 0.5,
      visibilityFactor: 1,
      fogDensity: 0.04,
      precipitation: 0,
      precipitationType: "none",
      storm: 0,
      windSpeed: 0.12,
      windDirection: Math.PI * 1.5,
      temperature: 18,
      latitude: 0,
      longitude: 0,
      localTime: null,
      timezone: "UTC"
    },
    aurora: {
      enabled: false,
      intensity: 0.6,
      waveSpeed: 0.4,
      altitude: 110,
      bandCount: 5,
      curtainWidth: 120,
      lowerEdge: 38,
      magneticTilt: -12,
      shimmer: 0.35,
      softness: 82,
      palette: ["#00e87a", "#00c8ff", "#9b6bff", "#ff6baa"]
    },
    colorGrade: {
      enabled: true,
      exposure: 0,
      contrast: 1,
      saturation: 1,
      temperature: 0,
      tint: 0,
      hueShift: 0,
      lift: 0,
      gamma: 1,
      gain: 1,
      highlightRolloff: 0.65,
      gamutCompression: 0.35,
      look: "Neutral ACES"
    },
    stars: { enabled: true, density: 0.72, milkyWay: true },
    moon: { enabled: true, phase: 0.5, illumination: 1, azimuth: Math.PI, elevation: 0.45, size: 1 },
    galaxy: {
      enabled: false,
      type: "spiral",
      seed: 8347,
      starDensity: 0.72,
      armCount: 4,
      armTwist: 3.6,
      radius: 1,
      thickness: 0.22,
      coreSize: 0.24,
      coreIntensity: 1.25,
      dust: 0.48,
      nebula: 0.42,
      temperature: 6200,
      rotation: 0,
      inclination: 0.28,
      blackHole: 0,
      lensing: 0,
      animate: true,
      animationSpeed: 0.018
    }
  });

  const state = {
    installed: false,
    canvas: null,
    viewport: null,
    gl: null,
    program: null,
    vao: null,
    uniforms: {},
    settings: clone(DEFAULTS),
    frameHandle: null,
    resizeObserver: null,
    lastFrame: 0,
    startTime: 0,
    fps: 0,
    fpsFrames: 0,
    fpsStart: 0,
    badge: null,
    oldRenderer: null,
    error: null
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function finiteOr(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, finiteOr(value, 0))); }
  function mergeDeep(target, patch) {
    const output = clone(target);
    if (!patch || typeof patch !== "object") return output;
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === "object" && !Array.isArray(value) && output[key] && typeof output[key] === "object") output[key] = mergeDeep(output[key], value);
      else if (value !== undefined) output[key] = value;
    }
    return output;
  }
  function hexRgb(hex) {
    const text = String(hex || "#ffffff").replace("#", "");
    const normalized = text.length === 3 ? text.split("").map((c) => c + c).join("") : text.padEnd(6, "f").slice(0, 6);
    return [parseInt(normalized.slice(0, 2), 16) / 255, parseInt(normalized.slice(2, 4), 16) / 255, parseInt(normalized.slice(4, 6), 16) / 255];
  }
  function sanitize(input) {
    const next = mergeDeep(DEFAULTS, input || {});
    next.enabled = next.enabled !== false;
    next.quality = ["realtime", "production", "reference"].includes(next.quality) ? next.quality : "production";
    next.mode = ["atmosphere", "galaxy", "hybrid"].includes(next.mode) ? next.mode : "atmosphere";
    next.resolutionScale = clamp(next.resolutionScale, 0.35, 1);
    next.weather.cloudCoverage = clamp(next.weather.cloudCoverage, 0, 1);
    next.weather.cloudDensity = clamp(next.weather.cloudDensity, 0.02, 1.5);
    next.weather.cloudLow = clamp(next.weather.cloudLow, 0, 1);
    next.weather.cloudMid = clamp(next.weather.cloudMid, 0, 1);
    next.weather.cloudHigh = clamp(next.weather.cloudHigh, 0, 1);
    next.weather.humidity = clamp(next.weather.humidity, 0, 1);
    next.weather.visibilityFactor = clamp(next.weather.visibilityFactor, 0, 1);
    next.weather.fogDensity = clamp(next.weather.fogDensity, 0, 1.5);
    next.weather.precipitation = clamp(next.weather.precipitation, 0, 1);
    next.weather.storm = clamp(next.weather.storm, 0, 1);
    next.weather.windSpeed = clamp(next.weather.windSpeed, 0, 2);
    next.aurora.enabled = Boolean(next.aurora.enabled);
    next.aurora.intensity = clamp(next.aurora.intensity, 0, 2);
    next.aurora.waveSpeed = clamp(next.aurora.waveSpeed, 0, 2);
    next.aurora.bandCount = Math.round(clamp(next.aurora.bandCount, 1, 16));
    next.aurora.shimmer = clamp(next.aurora.shimmer, 0, 1);
    next.colorGrade.exposure = clamp(next.colorGrade.exposure, -8, 8);
    next.colorGrade.contrast = clamp(next.colorGrade.contrast, 0.35, 2.5);
    next.colorGrade.saturation = clamp(next.colorGrade.saturation, 0, 2.5);
    next.colorGrade.temperature = clamp(next.colorGrade.temperature, -1, 1);
    next.colorGrade.tint = clamp(next.colorGrade.tint, -1, 1);
    next.colorGrade.hueShift = clamp(next.colorGrade.hueShift, -Math.PI, Math.PI);
    next.colorGrade.lift = clamp(next.colorGrade.lift, -0.5, 0.5);
    next.colorGrade.gamma = clamp(next.colorGrade.gamma, 0.25, 3);
    next.colorGrade.gain = clamp(next.colorGrade.gain, 0.1, 4);
    next.colorGrade.highlightRolloff = clamp(next.colorGrade.highlightRolloff, 0, 2);
    next.colorGrade.gamutCompression = clamp(next.colorGrade.gamutCompression, 0, 1.5);
    next.galaxy.enabled = Boolean(next.galaxy.enabled);
    return next;
  }
  function load() {
    try {
      const raw = root?.localStorage?.getItem(STORAGE_KEY);
      if (raw) state.settings = sanitize(JSON.parse(raw));
    } catch { state.settings = clone(DEFAULTS); }
    if (!state.settings.__galaxyExplicit) state.settings.galaxy.enabled = false;
  }
  function persist() {
    try { root?.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state.settings)); } catch { }
  }
  function emit(name, detail) {
    if (root?.dispatchEvent && typeof root.CustomEvent === "function") root.dispatchEvent(new root.CustomEvent(name, { detail }));
  }

  const VERTEX = `#version 300 es
  in vec2 aPosition;
  out vec2 vUv;
  void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`;

  const FRAGMENT = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform vec4 uSun;
  uniform vec4 uWeatherA;
  uniform vec4 uWeatherB;
  uniform vec4 uCloudLayers;
  uniform vec4 uMoonA;
  uniform vec4 uMoonB;
  uniform vec4 uAuroraA;
  uniform vec4 uAuroraB;
  uniform vec3 uAuroraC1;
  uniform vec3 uAuroraC2;
  uniform vec3 uAuroraC3;
  uniform vec3 uAuroraC4;
  uniform vec4 uGradeA;
  uniform vec4 uGradeB;
  uniform vec4 uGradeC;
  uniform vec4 uGalaxyA;
  uniform vec4 uGalaxyB;
  uniform vec4 uGalaxyC;
  uniform vec4 uGalaxyD;
  uniform vec4 uFlags;

  #define PI 3.14159265359
  float hash21(vec2 p){p=fract(p*vec2(123.34,345.45));p+=dot(p,p+34.345);return fract(p.x*p.y);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+1.),f.x),f.y);}
  float fbm(vec2 p){float v=0.,a=.5;mat2 r=mat2(.8,-.6,.6,.8);for(int i=0;i<6;i++){v+=a*noise(p);p=r*p*2.03+17.1;a*=.5;}return v;}
  vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
  vec3 hueRotate(vec3 color,float angle){
    const mat3 rgb2yiq=mat3(.299,.587,.114,.596,-.275,-.321,.212,-.523,.311);
    const mat3 yiq2rgb=mat3(1.,.956,.621,1.,-.272,-.647,1.,-1.106,1.703);
    vec3 yiq=rgb2yiq*color;float h=atan(yiq.z,yiq.y)+angle;float c=length(yiq.yz);yiq.yz=vec2(c*cos(h),c*sin(h));return max(yiq2rgb*yiq,0.);
  }
  vec3 kelvin(float k){float t=clamp((k-1800.)/16200.,0.,1.);return mix(vec3(1.,.35,.08),vec3(.42,.66,1.),smoothstep(0.,1.,t));}
  vec3 directionFromScreen(vec2 uv){
    vec2 p=uv*2.-1.;p.x*=uResolution.x/max(uResolution.y,1.);float az=p.x*.82;float alt=(p.y+.10)*.83;return normalize(vec3(sin(az)*cos(alt),sin(alt),cos(az)*cos(alt)));
  }
  vec3 dirFromAngles(float az,float el){return normalize(vec3(sin(az)*cos(el),sin(el),cos(az)*cos(el)));}
  float starField(vec3 d,float density){
    vec2 cell=vec2(atan(d.z,d.x)/PI,asin(clamp(d.y,-1.,1.))/PI)*vec2(1300.,720.);float h=hash21(floor(cell));float gate=mix(.99955,.9965,clamp(density,0.,1.5)/1.5);float s=smoothstep(gate,1.,h);float tw=.65+.35*sin(uTime*(2.+h*5.)+h*100.);return s*tw*mix(.4,2.6,pow(h,28.));
  }
  float cloudLayer(vec3 d,float scale,float speed,float threshold,float softness,vec2 wind){
    float horizon=max(d.y+.16,.08);vec2 p=d.xz/horizon*scale+wind*uTime*speed;float n=fbm(p)+.32*fbm(p*2.6+11.);return smoothstep(threshold,threshold+softness,n);
  }
  vec4 clouds(vec3 d,vec3 sunDir,float night){
    float cover=uWeatherA.x,density=uWeatherA.y;vec2 wind=vec2(cos(uWeatherB.z),sin(uWeatherB.z))*(.015+.09*uWeatherB.y);
    float low=cloudLayer(d,1.15,1.,1.06-cover*.75,.13,wind)*uCloudLayers.x;
    float mid=cloudLayer(d,2.05,.62,1.10-cover*.68,.11,wind*1.4+3.)*uCloudLayers.y;
    float high=cloudLayer(d,3.9,.34,1.13-cover*.55,.08,wind*.7-5.)*uCloudLayers.z;
    float mask=clamp((low+mid*.75+high*.5)*density,0.,1.);
    float forward=pow(max(dot(d,sunDir),0.),10.);vec3 dayLit=mix(vec3(.36,.40,.48),vec3(1.12,.98,.82),.32+forward*.55);
    vec3 nightLit=mix(vec3(.018,.026,.045),vec3(.12,.16,.24),forward*.3);vec3 col=mix(dayLit,nightLit,night);
    col*=mix(.55,1.25,high)+uWeatherB.w*.08;return vec4(col,mask);
  }
  vec3 galaxy(vec3 d){
    if(uGalaxyA.x<.5)return vec3(0);float rot=uGalaxyD.x+(uGalaxyD.z>.5?uTime*uGalaxyD.w:0.);float ca=cos(rot),sa=sin(rot);vec2 p=vec2(ca*d.x-sa*d.z,sa*d.x+ca*d.z);p.y=mix(p.y,d.y,uGalaxyC.w);float r=length(p)/max(uGalaxyB.x,.01);float a=atan(p.y,p.x);float arms=max(1.,uGalaxyA.w);float arm=pow(.5+.5*cos(a*arms-log(max(r,.03))*uGalaxyA.z*2.),8.);float disk=exp(-r*r*2.2);float core=exp(-r*r/max(uGalaxyB.z*uGalaxyB.z,.002))*uGalaxyB.w;float n=fbm(p*vec2(14.,9.)+uGalaxyA.y*.001);float stars=smoothstep(.72,.995,n+arm*.28)*disk*uGalaxyA.y*.0012;vec3 base=kelvin(uGalaxyC.z);vec3 neb=vec3(.24,.18,.75)*fbm(p*6.+4.)*uGalaxyC.y;float dust=1.-smoothstep(.38,.78,fbm(p*11.+19.))*uGalaxyC.x*.55;vec3 col=(base*(stars+arm*disk*.14)+vec3(1.,.65,.32)*core+neb*disk)*dust;float hole=smoothstep(uGalaxyD.y*.10,uGalaxyD.y*.02,r);col*=1.-hole*.9;return col;
  }
  vec3 aurora(vec3 d,float night,float cloudMask){
    if(uAuroraA.x<.5)return vec3(0);float lower=mix(.04,.5,uAuroraB.z);float sky=smoothstep(lower,lower+.14,d.y)*smoothstep(.92,.36,d.y);float x=atan(d.x,d.z)/PI+uAuroraB.w*.006;float bands=max(1.,uAuroraA.w);float wave=sin((x*bands*PI*2.)+fbm(vec2(x*3.,d.y*2.+uTime*uAuroraA.z*.12))*7.+uTime*uAuroraA.z);float curtain=pow(.5+.5*wave,mix(4.,12.,uAuroraB.y));curtain*=.42+.58*fbm(vec2(x*9.+uTime*.02,d.y*5.));float t=clamp(d.y+fbm(vec2(x*4.,uTime*.03))*.35,0.,1.);vec3 c=mix(mix(uAuroraC1,uAuroraC2,smoothstep(0.,.4,t)),mix(uAuroraC3,uAuroraC4,smoothstep(.55,1.,t)),smoothstep(.35,.75,t));return c*curtain*sky*uAuroraA.y*night*(1.-cloudMask*.88);
  }
  float rain(vec2 uv,float intensity){vec2 p=uv*vec2(95.,54.);p.y+=uTime*52.;float id=hash21(floor(p));float x=abs(fract(p.x+id)-.5);float y=fract(p.y+id*17.);return smoothstep(.045,0.,x)*smoothstep(.9,.25,y)*step(1.-intensity*.65,id);}
  float snow(vec2 uv,float intensity){vec2 p=uv*vec2(70.,42.);p.y+=uTime*5.;p.x+=sin(p.y*.21+uTime)*1.8;vec2 q=fract(p)-.5;float id=hash21(floor(p));return smoothstep(.08,.0,length(q))*step(1.-intensity*.72,id);}
  vec3 applyGrade(vec3 col){
    col*=exp2(uGradeA.x);col+=uGradeC.x;col=max(col,0.);col=pow(col,vec3(1./max(uGradeC.y,.05)))*uGradeC.z;
    col*=vec3(1.+uGradeB.x*.18,1.-abs(uGradeB.x)*.035+uGradeB.y*.08,1.-uGradeB.x*.18);col=hueRotate(col,uGradeB.z);
    float l=dot(col,vec3(.2126,.7152,.0722));col=mix(vec3(l),col,uGradeA.z);col=(col-.18)*uGradeA.y+.18;
    col=col/(1.+max(col-1.,0.)*uGradeC.w);float mx=max(max(col.r,col.g),col.b);col=mix(col,col/max(mx,1.),clamp((mx-1.)*uGradeB.w,0.,1.));return aces(max(col,0.));
  }
  void main(){
    vec3 d=directionFromScreen(vUv);float sunAz=uSun.x,sunEl=uSun.y;vec3 sunDir=dirFromAngles(sunAz,sunEl);float day=smoothstep(-.12,.06,sunEl);float night=1.-smoothstep(-.18,.01,sunEl);
    vec3 zenith=mix(vec3(.006,.012,.035),vec3(.055,.24,.72),day);vec3 horizon=mix(vec3(.018,.025,.055),vec3(.62,.78,1.02),day);
    float h=clamp(d.y*.85+.22,0.,1.);vec3 col=mix(horizon,zenith,pow(h,.45));float sunGlow=pow(max(dot(d,sunDir),0.),mix(6.,32.,day));col+=mix(vec3(.8,.18,.06),vec3(1.,.86,.58),day)*sunGlow*(.2+day*.5);
    float sunDisc=smoothstep(cos(.0092),cos(.0044),dot(d,sunDir))*day;col+=vec3(18.,13.,7.)*sunDisc;
    vec3 moonDir=dirFromAngles(uMoonA.x,uMoonA.y);float moonDisc=smoothstep(cos(.012*uMoonA.w),cos(.006*uMoonA.w),dot(d,moonDir))*uMoonA.z*night;float moonShade=smoothstep(-.2,.8,uMoonB.x);col+=vec3(.65,.78,1.)*moonDisc*moonShade*2.4;
    float stars=starField(d,uMoonB.y)*night*uMoonB.z;col+=vec3(.72,.82,1.)*stars;
    vec3 gal=galaxy(d)*night;col+=gal*(uFlags.x>.5?1.:0.);
    vec4 cl=clouds(d,sunDir,night);col=mix(col,cl.rgb,cl.a);col+=aurora(d,night,cl.a);
    float fog=uWeatherA.w;vec3 fogColor=mix(vec3(.05,.065,.09),horizon,day);col=mix(col,fogColor,clamp(fog*(1.-max(d.y,0.)*.72),0.,.88));
    if(uFlags.y>.5){float p=uWeatherA.z;if(uFlags.z<1.5)col+=vec3(.42,.55,.72)*rain(vUv,p)*p;else col+=vec3(.88,.94,1.)*snow(vUv,p)*p;}
    if(uWeatherB.w>.5){float flash=pow(max(0.,sin(uTime*7.3+floor(uTime*.37)*18.)),80.)*uWeatherB.w;col+=vec3(.55,.68,1.)*flash*3.;}
    col=applyGrade(col);fragColor=vec4(col,1.);
  }`;

  function compile(gl, type, source) {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`Phase 7 shader compile failed: ${log}`); }
    return shader;
  }
  function createProgram(gl) {
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX); const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.bindAttribLocation(program, 0, "aPosition"); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { const log = gl.getProgramInfoLog(program); gl.deleteProgram(program); throw new Error(`Phase 7 program link failed: ${log}`); }
    return program;
  }
  function createCanvas() {
    const viewport = root?.document?.getElementById("vp"); if (!viewport) throw new Error("SkyForge viewport #vp was not found");
    state.viewport = viewport; if (root.getComputedStyle?.(viewport).position === "static") viewport.style.position = "relative";
    let canvas = root.document.getElementById("sf-phase7-gpu-canvas");
    if (!canvas) { canvas = root.document.createElement("canvas"); canvas.id = "sf-phase7-gpu-canvas"; canvas.setAttribute("aria-hidden", "true"); canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none;background:#02040a;opacity:0;transition:opacity .25s ease"; viewport.insertBefore(canvas, viewport.firstChild); }
    state.canvas = canvas; return canvas;
  }
  function initGl() {
    const gl = state.canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is unavailable in this browser");
    state.gl = gl; state.program = createProgram(gl); state.vao = gl.createVertexArray(); gl.bindVertexArray(state.vao);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    ["uResolution","uTime","uSun","uWeatherA","uWeatherB","uCloudLayers","uMoonA","uMoonB","uAuroraA","uAuroraB","uAuroraC1","uAuroraC2","uAuroraC3","uAuroraC4","uGradeA","uGradeB","uGradeC","uGalaxyA","uGalaxyB","uGalaxyC","uGalaxyD","uFlags"].forEach((name) => { state.uniforms[name] = gl.getUniformLocation(state.program, name); });
  }
  function resize() {
    if (!state.canvas || !state.viewport) return;
    const rect = state.viewport.getBoundingClientRect(); const scale = state.settings.resolutionScale * Math.min(root.devicePixelRatio || 1, 1.5);
    const width = Math.max(2, Math.round(rect.width * scale)); const height = Math.max(2, Math.round(rect.height * scale));
    if (state.canvas.width !== width || state.canvas.height !== height) { state.canvas.width = width; state.canvas.height = height; state.gl.viewport(0, 0, width, height); }
  }
  function collectSun() {
    const p5 = root?.SkyForgeNaturalLightPhase5?.getState?.(); const p4 = root?.SkyForgeNaturalLightPreview?.getState?.();
    const evaluation = p5?.pipeline?.evaluation || p5?.payload?.evaluation || p4?.evaluation || null; const solar = evaluation?.solarPosition || {};
    return { azimuth: finiteOr(solar.azimuthDeg, 220) * Math.PI / 180, elevation: finiteOr(solar.apparentElevationDeg, 34) * Math.PI / 180, dni: finiteOr(evaluation?.irradiance?.directNormalWm2, 720) / 1000 };
  }
  function precipitationFlag(type) { return type === "snow" ? 2 : type === "rain" ? 1 : 0; }
  function setUniforms(time) {
    const gl = state.gl, u = state.uniforms, s = state.settings, w = s.weather, a = s.aurora, g = s.colorGrade, x = s.galaxy, m = s.moon, sun = collectSun();
    const palette = (a.palette || DEFAULTS.aurora.palette).map(hexRgb);
    gl.uniform2f(u.uResolution, state.canvas.width, state.canvas.height); gl.uniform1f(u.uTime, time);
    gl.uniform4f(u.uSun, sun.azimuth, sun.elevation, sun.dni, w.temperature);
    gl.uniform4f(u.uWeatherA, w.cloudCoverage, w.cloudDensity, w.precipitation, w.fogDensity);
    gl.uniform4f(u.uWeatherB, w.humidity, w.windSpeed, w.windDirection, w.storm);
    gl.uniform4f(u.uCloudLayers, w.cloudLow, w.cloudMid, w.cloudHigh, w.visibilityFactor);
    gl.uniform4f(u.uMoonA, m.azimuth, m.elevation, m.enabled ? m.illumination : 0, m.size || 1);
    gl.uniform4f(u.uMoonB, m.phase, s.stars.density, s.stars.enabled ? 1 : 0, s.stars.milkyWay ? 1 : 0);
    gl.uniform4f(u.uAuroraA, a.enabled ? 1 : 0, a.intensity, a.waveSpeed, a.bandCount);
    gl.uniform4f(u.uAuroraB, a.altitude / 300, a.shimmer, a.lowerEdge / 100, a.magneticTilt);
    gl.uniform3fv(u.uAuroraC1, palette[0]); gl.uniform3fv(u.uAuroraC2, palette[1]); gl.uniform3fv(u.uAuroraC3, palette[2]); gl.uniform3fv(u.uAuroraC4, palette[3]);
    gl.uniform4f(u.uGradeA, g.exposure, g.contrast, g.saturation, g.enabled ? 1 : 0);
    gl.uniform4f(u.uGradeB, g.temperature, g.tint, g.hueShift, g.gamutCompression);
    gl.uniform4f(u.uGradeC, g.lift, g.gamma, g.gain, g.highlightRolloff);
    gl.uniform4f(u.uGalaxyA, x.enabled ? 1 : 0, x.starDensity, x.armTwist, x.armCount);
    gl.uniform4f(u.uGalaxyB, x.radius, x.thickness, x.coreSize, x.coreIntensity);
    gl.uniform4f(u.uGalaxyC, x.dust, x.nebula, x.temperature, x.inclination);
    gl.uniform4f(u.uGalaxyD, x.rotation, x.blackHole, x.animate ? 1 : 0, x.animationSpeed);
    gl.uniform4f(u.uFlags, (s.mode === "galaxy" || s.mode === "hybrid") && x.enabled ? 1 : 0, precipitationFlag(w.precipitationType) > 0 ? 1 : 0, precipitationFlag(w.precipitationType), s.quality === "reference" ? 2 : s.quality === "realtime" ? 0 : 1);
  }
  function frame(now) {
    if (!state.settings.enabled || !state.gl) return;
    resize(); const gl = state.gl; gl.useProgram(state.program); gl.bindVertexArray(state.vao); setUniforms((now - state.startTime) / 1000); gl.drawArrays(gl.TRIANGLES, 0, 3);
    state.fpsFrames += 1; if (!state.fpsStart) state.fpsStart = now; if (now - state.fpsStart > 750) { state.fps = state.fpsFrames * 1000 / (now - state.fpsStart); state.fpsFrames = 0; state.fpsStart = now; updateBadge(); emit("skyforge:phase7-stats", getState()); }
    state.frameHandle = root.requestAnimationFrame(frame);
  }
  function start() { if (state.frameHandle) root.cancelAnimationFrame(state.frameHandle); if (state.settings.enabled) state.frameHandle = root.requestAnimationFrame(frame); }
  function stop() { if (state.frameHandle) root.cancelAnimationFrame(state.frameHandle); state.frameHandle = null; }
  function createBadge() {
    const host = root.document.querySelector(".vp-bar .vp-r") || root.document.querySelector(".vp-r"); if (!host) return;
    let badge = root.document.getElementById("sf-phase7-badge"); if (!badge) { badge = root.document.createElement("button"); badge.id = "sf-phase7-badge"; badge.className = "sf-phase7-badge"; badge.addEventListener("click", () => setEnabled(!state.settings.enabled)); host.prepend(badge); }
    state.badge = badge; updateBadge();
  }
  function updateBadge() {
    if (!state.badge) return; const live = state.settings.weather.live ? "LIVE" : "MANUAL"; state.badge.textContent = `GPU 7 · ${live} · ${Math.round(state.fps || 0)} FPS`; state.badge.classList.toggle("off", !state.settings.enabled); state.badge.title = `${state.settings.weather.label} · ${state.settings.colorGrade.look}`;
  }
  function setEnabled(enabled) { state.settings.enabled = Boolean(enabled); if (state.canvas) state.canvas.style.opacity = state.settings.enabled ? "1" : "0"; persist(); state.settings.enabled ? start() : stop(); updateBadge(); return state.settings.enabled; }
  function setSettings(patch) { state.settings = sanitize(mergeDeep(state.settings, patch)); persist(); if (state.settings.enabled) start(); emit("skyforge:phase7-settings", getState()); return getState(); }
  function setWeather(weather) { return setSettings({ weather }); }
  function setAurora(aurora) { return setSettings({ aurora }); }
  function setColorGrade(colorGrade) { return setSettings({ colorGrade }); }
  function setGalaxy(patch) { const structural = patch && Object.keys(patch).some((key) => key !== "enabled"); const galaxy = { ...patch, ...(structural && patch.enabled === undefined ? { enabled: true } : {}) }; state.settings.__galaxyExplicit = true; return setSettings({ galaxy }); }
  function applyPreset(name) {
    const presets = {
      milkyWay:{type:"barred",seed:8347,starDensity:.82,armCount:4,armTwist:4.1,coreSize:.22,dust:.72,nebula:.32,temperature:6000,inclination:.18},
      andromeda:{type:"spiral",seed:31031,starDensity:.78,armCount:2,armTwist:2.9,coreSize:.34,dust:.42,nebula:.24,temperature:6400,inclination:.55},
      sombrero:{type:"spiral",seed:4594,starDensity:.72,armCount:2,armTwist:2.1,coreSize:.42,dust:1.1,nebula:.12,temperature:5200,inclination:1.18},
      whirlpool:{type:"spiral",seed:5194,starDensity:.9,armCount:2,armTwist:5.3,coreSize:.18,dust:.38,nebula:.7,temperature:7200,inclination:.12},
      starburst:{type:"irregular",seed:823,starDensity:1.12,armCount:3,armTwist:2.2,coreSize:.3,dust:.28,nebula:1.15,temperature:9400,inclination:.08},
      elliptical:{type:"elliptical",seed:870,starDensity:.92,armCount:1,armTwist:1,coreSize:.48,dust:.08,nebula:.06,temperature:4600,inclination:.35},
      ring:{type:"ring",seed:9981,starDensity:.88,armCount:2,armTwist:2.8,coreSize:.1,dust:.22,nebula:.58,temperature:7600,inclination:.28}
    };
    if (!presets[name]) return getState(); state.settings.__galaxyExplicit = true; return setSettings({ mode: "hybrid", galaxy: { enabled: true, ...presets[name] } });
  }
  function installSceneHooks() {
    const collect = root.sfCollectScene; if (typeof collect === "function" && !collect.__sfPhase7Wrapped) {
      function wrapped(...args) { const scene = collect.apply(this, args) || {}; scene.rendering = scene.rendering && typeof scene.rendering === "object" ? scene.rendering : {}; scene.rendering.phase7 = clone(state.settings); scene.galaxy = clone(state.settings.galaxy); scene.weatherLive = clone(state.settings.weather); scene.aurora = clone(state.settings.aurora); scene.colorGrade = clone(state.settings.colorGrade); return scene; }
      wrapped.__sfPhase7Wrapped = true; wrapped.__sfPhase7Original = collect; root.sfCollectScene = wrapped;
    }
    ["sfApplyScene", "sfApplySkyForgeScene"].forEach((name) => { const original = root[name]; if (typeof original !== "function" || original.__sfPhase7Wrapped) return; function wrapped(...args) { const result = original.apply(this, args); const scene = result && typeof result === "object" ? result : args[0]; if (scene?.rendering?.phase7) setSettings(scene.rendering.phase7); else { if (scene?.galaxy?.enabled === true) setGalaxy(scene.galaxy); if (scene?.aurora) setAurora(scene.aurora); if (scene?.colorGrade) setColorGrade(scene.colorGrade); } return result; } wrapped.__sfPhase7Wrapped = true; wrapped.__sfPhase7Original = original; root[name] = wrapped; });
  }
  async function install() {
    if (state.installed || !root?.document) return; state.installed = true; load();
    try {
      createCanvas(); initGl(); createBadge(); state.resizeObserver = new root.ResizeObserver(resize); state.resizeObserver.observe(state.viewport); resize();
      state.oldRenderer = root.SkyForgePhase6Renderer; if (state.oldRenderer && state.oldRenderer !== api) state.oldRenderer.destroy?.();
      root.SkyForgePhase6Renderer = api; installSceneHooks(); root.addEventListener("skyforge:galaxy-updated", (event) => setGalaxy(event.detail || {}));
      state.startTime = performance.now(); setEnabled(state.settings.enabled); state.canvas.style.opacity = state.settings.enabled ? "1" : "0"; emit("skyforge:phase7-ready", getState());
    } catch (error) {
      state.error = error?.message || String(error); state.canvas?.remove(); state.installed = false; root.SkyForgePhase6Renderer = state.oldRenderer || root.SkyForgePhase6Renderer; emit("skyforge:phase7-error", { error: state.error }); console.error("SkyForge Phase 7 renderer:", error);
    }
  }
  function destroy() { stop(); state.resizeObserver?.disconnect(); state.canvas?.remove(); state.badge?.remove(); state.installed = false; }
  function getState() { return { installed: state.installed, enabled: state.settings.enabled, backend: "WebGL2", fps: state.fps, settings: clone(state.settings), version: VERSION, error: state.error }; }

  const api = { VERSION, DEFAULTS, install, destroy, getState, setEnabled, setSettings, setWeather, setAurora, setColorGrade, setGalaxy, applyPreset, sanitizeSettings: sanitize };
  return api;
});
