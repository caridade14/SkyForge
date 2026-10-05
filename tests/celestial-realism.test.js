const test=require('node:test'),assert=require('node:assert/strict');
const {clientSource}=require('./helpers/client-source.cjs');
const load=name=>import('data:text/javascript;base64,'+Buffer.from(clientSource(name)).toString('base64'));
const effects=()=>load('src/client/viewport/celestial-effects.js');
const close=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);

test('Moon keeps a half-degree angular diameter and only its projection changes with the lens',async()=>{
 const m=await effects();close(m.moonDiameterPixels(.52,60,720),5.659093,1e-6);
 close(m.moonDiameterPixels(.52,60,1440),m.moonDiameterPixels(.52,60,720)*2);
 assert.ok(m.moonDiameterPixels(.52,20,720)>m.moonDiameterPixels(.52,60,720)*3);
 assert.ok(m.moonDiameterPixels(1.04,60,720)/m.moonDiameterPixels(.52,60,720)>1.999);
 assert.ok(Number.isFinite(m.moonDiameterPixels(Infinity,NaN,-1)));
});
test('Lunar single-scattering response has a flatter full disc and a dark unlit terminator',async()=>{
 const m=await effects();close(m.lunarReflectance(1,1),1);close(m.lunarReflectance(.1,.1),.82);
 close(m.lunarReflectance(0,.6),0);assert.ok(m.lunarReflectance(.05,.8)<.12);
 assert.ok(m.lunarReflectance(.8,.05)>1);assert.ok(Number.isFinite(m.lunarReflectance(0,0)));
});
test('Unresolved star catalogue preserves magnitudes, solid-angle distribution and bounded storage',async()=>{
 const m=await effects(),a=m.starCatalogue(2387,12000),b=m.starCatalogue(2387,12000),c=m.starCatalogue(2388,12000);
 assert.deepEqual(a.data,b.data);assert.notDeepEqual(a.data,c.data);assert.equal(a.data.length,512*256*4);
 assert.equal(a.count,12000);assert.ok(a.packedCount>11000);assert.ok(a.packedCount<=a.count);
 let mean=0,square=0;for(const star of a.entries){const z=Math.sin(star.elevation);mean+=z;square+=z*z;assert.ok(star.magnitude>=-1.5&&star.magnitude<=7);}
 assert.ok(Math.abs(mean/a.count)<.02);close(square/a.count,1/3,.01);
 assert.equal(m.starCatalogue(1,0).packedCount,0);assert.equal(m.starCatalogue(1,Infinity).count,3200);
 close(m.magnitudeFlux(5)/m.magnitudeFlux(0),.01);assert.ok(a.entries.filter(s=>s.magnitude>5).length>9000);
});
test('Spectral rainbow mixes wavelengths and reverses colour order in the secondary bow',async()=>{
 const m=await effects();const red=m.xyzToLinearRGB(m.rainbowSpectrumXYZ(m.rainbowAngle(650)*180/Math.PI,.15));
 const blue=m.xyzToLinearRGB(m.rainbowSpectrumXYZ(m.rainbowAngle(450)*180/Math.PI,.15));
 assert.ok(red[0]>red[2]*3);assert.ok(blue[2]>blue[0]*3);
 assert.ok(m.rainbowAngle(650)>m.rainbowAngle(450));assert.ok(m.rainbowAngle(650,2)<m.rainbowAngle(450,2));
 const band=m.rainbowSpectrumXYZ(46,.4).map((v,i)=>v+m.rainbowSpectrumXYZ(46,.4,2)[i]);assert.ok(Math.max(...band)<1e-6);
 assert.ok(m.spectralXYZ(550)[1]>.9);assert.ok(m.spectralXYZ(450)[2]>1);
 const soft=m.rainbowSpectrumXYZ(42,.4),hard=m.rainbowSpectrumXYZ(42,.1);assert.ok(soft.reduce((a,b)=>a+b)>hard.reduce((a,b)=>a+b));
});
test('R16 scene looks retain authored objects, graph documents and complete reversible celestial controls',async()=>{
 const {SkyForgeStore}=await load('src/client/core/state-store.js'),{applySceneLook,STUDIO_VERSION}=await load('src/client/studio/scene-looks.js');
 const store=new SkyForgeStore({storage:null});store.set('moon.angularDiameter',3);store.set('scene.referenceObjects',{x:{id:'x',name:'Kept'}});store.set('future',{keep:true});
 const before=store.snapshot();store.batch('Aurora look',draft=>applySceneLook(draft,'Aurora night'));
 assert.equal(STUDIO_VERSION,'Studio R16');assert.equal(store.get('moon.angularDiameter'),.52);assert.equal(store.get('aurora.width'),6);
 assert.deepEqual(store.get('scene.referenceObjects'),before.scene.referenceObjects);assert.deepEqual(store.get('future'),before.future);
 store.undo();assert.equal(store.get('moon.angularDiameter'),3);assert.deepEqual(store.get('aurora'),before.aurora);store.destroy();
});
