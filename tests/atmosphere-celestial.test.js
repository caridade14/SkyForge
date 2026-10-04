const test=require('node:test'),assert=require('node:assert/strict');
const {clientSource}=require('./helpers/client-source.cjs');
const moduleOf=path=>import('data:text/javascript;base64,'+Buffer.from(clientSource(path)).toString('base64'));
const transport=()=>moduleOf('src/client/viewport/atmosphere-transport.js');
const celestial=()=>moduleOf('src/client/viewport/celestial-effects.js');
const close=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('spherical Beer–Lambert transport conserves transmission, handles ground shadow and attenuates the low Sun',async()=>{
  const m=await transport(),p=m.atmosphereParameters();
  const zenith=m.atmosphericTransmittance(p,.02,1),low=m.atmosphericTransmittance(p,.02,Math.sin(2*Math.PI/180));
  assert.ok(zenith.every((v,i)=>v>low[i]&&v<=1));assert.ok(low[0]>low[2]*10,'long paths remove blue much faster than red');
  assert.deepEqual(m.atmosphericTransmittance(p,.02,-.2),[0,0,0]);
  const tau=m.opticalDepth(p,.02,1,200);for(let c=0;c<3;c++)close(Math.exp(-tau[c]),m.atmosphericTransmittance(p,.02,1,200)[c]);
  const vacuum=m.atmosphereParameters({rayleigh:0,turbidity:1,mieCoefficient:0,haze:.3,ozone:0});
  assert.deepEqual(m.atmosphericTransmittance(vacuum,.02,1),[1,1,1]);
  const columns=m.densityProfile(25);close(columns[2],1);assert.equal(m.densityProfile(5)[2],0);assert.equal(m.densityProfile(45)[2],0);
});
test('phase functions integrate to unity and Rayleigh is reciprocal',async()=>{
  const m=await transport();for(const phase of [m.phaseRayleigh,mu=>m.phaseMie(mu,.8),mu=>m.phaseMie(mu,-.2)]){
    let integral=0;for(let i=0;i<20000;i++)integral+=phase(-1+(i+.5)/10000)*2*Math.PI/10000;
    close(integral,1,.00003);
  }
  for(const mu of [-1,-.6,0,.7,1])close(m.phaseRayleigh(mu),m.phaseRayleigh(-mu));
});
test('integrated atmosphere changes luminance with Sun elevation, stays linear above one and reuses optical / view tables',async()=>{
  const {AtmosphereTransport}=await transport(),solver=new AtmosphereTransport();
  const noon=solver.update({}, {elevation:60,azimuth:0}),dawn=solver.update({}, {elevation:7,azimuth:0}),night=solver.update({}, {elevation:-18});
  assert.ok(noon.ambient[2]>noon.ambient[0]*2);assert.ok(noon.ambient.every((v,i)=>v>dawn.ambient[i]));
  assert.ok(night.ambient.every(v=>v<.00001));assert.deepEqual(night.direct,[0,0,0]);
  assert.ok(dawn.data.some(v=>v>1),'radiance is not normalized to each image maximum');
  const builds=solver.builds,optics=solver.opticalBuilds;
  solver.update({}, {elevation:-18,azimuth:270,intensity:3,temperature:4000});assert.equal(solver.builds,builds);assert.equal(solver.opticalBuilds,optics);
  const dirty=solver.update({haze:.8},{elevation:60});assert.equal(solver.opticalBuilds,optics+1);assert.ok(dirty.direct[1]<noon.direct[1]);
});
test('isotropic multiple-scattering closure adds bounded non-negative indirect radiance',async()=>{
  const {AtmosphereTransport}=await transport(),a=new AtmosphereTransport().update({multipleScattering:0},{elevation:30}),b=new AtmosphereTransport().update({multipleScattering:1},{elevation:30});
  assert.ok(b.ambient.every((v,i)=>v>=a.ambient[i]));assert.ok(b.ambient[2]>a.ambient[2]);assert.ok(b.data.every(v=>Number.isFinite(v)&&v>=0));
});
test('RGBM fallback retains radiance above one; blackbody changes chromaticity without adding luminous energy',async()=>{
  const {encodeAtmosphereRGBM,blackbodyTint}=await transport(),v=[3,.25,.08,1],packed=encodeAtmosphereRGBM(v);
  for(let i=0;i<3;i++)close(packed[i]/255*packed[3]/255*32,v[i],.016);
  const cool=blackbodyTint(9000),warm=blackbodyTint(3200);assert.ok(warm[0]/warm[2]>cool[0]/cool[2]);
  for(const c of [cool,warm,blackbodyTint(Infinity)])close(c[0]*.2126+c[1]*.7152+c[2]*.0722,1);
});
test('cloud noise atlas is deterministic, seamless in XY and seed-specific',async()=>{
  const {makeCloudNoise}=await moduleOf('src/client/viewport/cloud-noise.js'),a=makeCloudNoise(12),b=makeCloudNoise(12),c=makeCloudNoise(13);
  assert.deepEqual(a.data,b.data);assert.notDeepEqual(a.data,c.data);assert.equal(a.width*a.height*4,a.data.length);
  const pixel=(x,y)=>a.data.slice((y*a.width+x)*4,(y*a.width+x)*4+4);
  for(let z=0;z<32;z++){const x=z%8*34,y=Math.floor(z/8)*34;
    for(let k=1;k<=32;k++){assert.deepEqual(pixel(x,y+k),pixel(x+32,y+k));assert.deepEqual(pixel(x+33,y+k),pixel(x+1,y+k));assert.deepEqual(pixel(x+k,y),pixel(x+k,y+32));}
  }
});
test('Moon uses a continuous phase cycle and stationary Snell rainbow cones have correct primary / secondary colour order',async()=>{
  const m=await celestial();close(m.moonIlluminatedFraction(0),0);close(m.moonIlluminatedFraction(.5),1);close(m.moonIlluminatedFraction(.25),.5);
  close(m.moonPhaseFlux(0),0);close(m.moonPhaseFlux(.5),1);assert.ok(m.moonPhaseFlux(.25)<.5);
  const red=m.rainbowAngle(650)*180/Math.PI,blue=m.rainbowAngle(450)*180/Math.PI;
  assert.ok(red>41&&red<43);assert.ok(blue<red);assert.ok(m.rainbowAngle(450,2)>m.rainbowAngle(650,2));
  assert.ok(m.rainbowAngle(550,2)*180/Math.PI>49&&m.rainbowAngle(550,2)*180/Math.PI<54);
});
test('procedural star flux has fixed positions, bounded count and reproducible seed',async()=>{
  const {starField}=await celestial(),a=starField(23,800,256,128),b=starField(23,800,256,128),c=starField(24,800,256,128);
  assert.deepEqual(a.data,b.data);assert.notDeepEqual(a.data,c.data);assert.ok(a.data.some((v,i)=>i%4!==3&&v>100));assert.equal(starField(23,0,16,8).count,0);
});
test('old projects complete disabled celestial defaults; effect gestures save committed state and Undo/Redo restores enabled layers',async()=>{
  const {SkyForgeStore}=await moduleOf('src/client/core/state-store.js'),{ProjectService,completeProjectState}=await moduleOf('src/client/core/project-service.js');
  const old={sun:{elevation:30},legacy:{objects:[{name:'Keep me'}]}},copy=JSON.stringify(old),completed=completeProjectState(old);
  assert.equal(completed.moon.enabled,false);assert.equal(completed.stars.count,3200);assert.equal(JSON.stringify(old),copy);assert.deepEqual(completed.legacy,old.legacy);
  const store=new SkyForgeStore({storage:null}),projects=new ProjectService(store);store.set('moon.enabled',true);store.undo();assert.equal(store.get('moon.enabled'),false);store.redo();
  const edit=store.beginEdit('moon.phase');edit.preview(.1);assert.equal(projects.createDocument().payload.moon.phase,.5);edit.cancel();assert.equal(store.get('moon.phase'),.5);
  store.set('aurora.enabled',true);store.set('rainbow.rainAmount',.8);const doc=projects.createDocument();store.reset();projects.loadDocument(doc);
  assert.equal(store.get('moon.enabled'),true);assert.equal(store.get('aurora.enabled'),true);assert.equal(store.get('rainbow.rainAmount'),.8);store.destroy();
});
test('celestial graph output and timeline compose, survive projects and never schedule a physical preview',async()=>{
  const {SkyForgeStore}=await moduleOf('src/client/core/state-store.js'),{NodeGraph}=await moduleOf('src/client/core/node-graph.js'),{TimelineEngine,isAnimatablePath}=await moduleOf('src/client/core/timeline-engine.js'),{Composition}=await moduleOf('src/client/studio/composition.js'),{LightingSync}=await moduleOf('src/client/core/lighting-sync.js'),{ProjectService}=await moduleOf('src/client/core/project-service.js');
  const store=new SkyForgeStore({storage:null}),graph=new NodeGraph(),timeline=new TimelineEngine(store),lighting=new LightingSync(store);let calls=0;lighting.schedule=()=>calls++;
  graph.createDefaultGraph();const composition=new Composition({store,nodeGraph:graph,timeline}).init();
  for(const [type,root]of [['Moon','moon'],['Stars','stars'],['Aurora','aurora'],['Rainbow','rainbow']]){const node=graph.addNode(type);graph.connect(node.id,root,'sky-scene',root);}
  composition.setAuthority('graph');assert.equal(store.get('moon.enabled'),true);const initial=calls;
  timeline.addKeyframe('moon.phase',1,.1);timeline.addKeyframe('moon.phase',101,.9);timeline.seek(51);close(store.get('moon.phase'),.5);assert.equal(calls,initial);
  for(const p of ['moon.phase','stars.rotation','aurora.intensity','rainbow.rainAmount'])assert.equal(isAnimatablePath(p),true);assert.equal(isAnimatablePath('aurora.__proto__'),false);
  const doc=new ProjectService(store,{nodeGraph:graph,timeline}).createDocument();assert.equal(doc.payload.stars.enabled,true);close(doc.payload.moon.phase,.5);
  const edit=store.beginEdit('aurora.intensity');edit.preview(3);edit.commit();assert.equal(composition.authority,'direct');store.undo();assert.equal(composition.authority,'graph');
  composition.dispose();lighting.dispose();timeline.dispose();store.destroy();
});
test('normalization bounds hostile celestial input without mutation or NaNs',async()=>{
  const {normalizeCelestial,celestialUniforms}=await celestial(),input={moon:{enabled:true,elevation:Infinity,phase:99},stars:{count:1e12},aurora:{altitude:-9,curtains:999}};
  const copy=JSON.stringify(input),safe=normalizeCelestial(input);assert.equal(safe.moon.phase,1);assert.equal(safe.stars.count,12000);assert.equal(safe.aurora.altitude,80);assert.equal(safe.aurora.curtains,3);assert.equal(JSON.stringify(input),copy);
  const u=celestialUniforms(input);assert.ok(Object.values(u.floats).every(Number.isFinite));assert.ok(Object.values(u.vectors).flat().every(Number.isFinite));
});
test('old autosave and graph bases gain disabled layers without replacing legacy data or retaining a disconnected Moon',async()=>{
  const {SkyForgeStore}=await moduleOf('src/client/core/state-store.js'),{NodeGraph}=await moduleOf('src/client/core/node-graph.js'),{Composition}=await moduleOf('src/client/studio/composition.js');
  const saved={sun:{elevation:42,azimuth:215},scene:{authority:'graph',directState:{sun:{elevation:42}}},legacy:{custom:'preserved'},future:{version:9}};
  const storage={getItem:()=>JSON.stringify(saved),setItem:()=>{}},store=new SkyForgeStore({storage}),graph=new NodeGraph();graph.createDefaultGraph();store.restore();
  assert.deepEqual(store.get('legacy'),saved.legacy);assert.deepEqual(store.get('future'),saved.future);assert.equal(store.get('moon.enabled'),false);assert.equal(store.get('scene.directState.moon.enabled'),false);
  store.set('nodes',graph.serialize(),{record:false});const composition=new Composition({store,nodeGraph:graph}).init(),node=graph.addNode('Moon'),connection=graph.connect(node.id,'moon','sky-scene','moon');
  assert.equal(store.get('moon.enabled'),true);graph.disconnect(connection.id);assert.equal(store.get('moon.enabled'),false);
  composition.dispose();store.destroy();
});
