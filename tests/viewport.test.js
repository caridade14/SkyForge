const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const source=p=>fs.readFileSync(path.join(root,p),'utf8');
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const cameraUrl=url(source('src/client/viewport/camera.js'));
const storeUrl=url(source('src/client/core/state-store.js'));
const camera=()=>import(cameraUrl);
const renderer=()=>import(url(source('src/client/viewport/renderer.js').replace("'./camera.js'",JSON.stringify(cameraUrl))));
const close=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);

test('viewport modules parse without a build system',()=>{
 for(const name of fs.readdirSync(path.join(root,'src/client/viewport')).filter(x=>x.endsWith('.js'))){
  const r=spawnSync(process.execPath,['--input-type=module','--check'],{input:source('src/client/viewport/'+name),encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 }
});
test('camera normalization bounds invalid projects, poles and dolly extremes',async()=>{
 const m=await camera();const c=m.normalizeCamera({yaw:Infinity,pitch:99,distance:-1,target:[NaN,Infinity,5],projection:'bad'});
 assert.equal(c.distance,0.25);assert.ok(c.pitch<Math.PI/2);assert.equal(c.projection,'perspective');assert.deepEqual(c.target,[0,0,5]);
 const d=m.dolly(m.normalizeCamera(),1e9);assert.ok(d.distance<=100000);assert.ok(d.distance>12);
});
test('Z-up orbit basis stays orthonormal including axis views',async()=>{
 const m=await camera();for(const v of ['home','front','right','top'])for(const opposite of [false,true]){
  const c=m.axisView(m.normalizeCamera(),v,opposite),b=m.cameraBasis(c);
  for(const vec of [b.forward,b.right,b.up])close(Math.hypot(...vec),1);
  close(m.dot(b.forward,b.up),0);close(m.dot(b.right,b.up),0);
  const r=m.rayAt(c,0,0);for(let i=0;i<3;i++)close(r.direction[i],b.forward[i]);
 }
});
test('perspective matrix projects target at screen centre and agrees with sky rays',async()=>{
 const m=await camera();for(const projection of ['perspective','orthographic']){
  const c=m.normalizeCamera({projection});const vp=m.viewProjection(c,1.7,60);
  const project=p=>{const q=[...p,1];return [0,1,2,3].map(row=>q.reduce((s,v,k)=>s+v*vp[k*4+row],0));};
  const p=project(c.target);close(p[0]/p[3],0);close(p[1]/p[3],0);
  const ray=m.rayAt(c,0.4,-0.3,1.7,60),point=m.add(ray.origin,m.mul(ray.direction,15)),q=project(point);
  close(q[0]/q[3],0.4);close(q[1]/q[3],-0.3);
 }
});
test('pan translates eye and target equally; dolly changes distance, not field of view',async()=>{
 const m=await camera(),c=m.normalizeCamera(),p=m.pan(c,100,-40,600,60);
 assert.notDeepEqual(p.target,c.target);assert.equal(p.yaw,c.yaw);assert.equal(p.distance,c.distance);
 const e=m.cameraBasis(c).eye,pe=m.cameraBasis(p).eye;for(let i=0;i<3;i++)close(pe[i]-e[i],p.target[i]-c.target[i]);
 const d=m.dolly(c,-100);assert.ok(d.distance<c.distance);assert.deepEqual(d.target,c.target);
});
test('Blender mouse mapping includes Mac trackpad emulation',async()=>{
 const {dragMode}=await import(url(source('src/client/viewport/navigation.js').replace("'./camera.js'",JSON.stringify(cameraUrl))));
 assert.equal(dragMode({button:1}),'orbit');assert.equal(dragMode({button:1,shiftKey:true}),'pan');assert.equal(dragMode({button:1,ctrlKey:true}),'dolly');
 assert.equal(dragMode({button:0,altKey:true}),'orbit');assert.equal(dragMode({button:0,altKey:true,shiftKey:true}),'pan');assert.equal(dragMode({button:0}),null);assert.equal(dragMode({button:2}),null);
});
test('physical sun orientation uses north/east/up consistently',async()=>{
 const m=await camera();for(const [sun,want] of [[{azimuth:0,elevation:0},[0,1,0]],[{azimuth:90,elevation:0},[1,0,0]],[{elevation:90},[0,0,1]]]){
  const got=m.sunDirection(sun);got.forEach((v,i)=>close(v,want[i]));
 }
 const r=await renderer();assert.equal(r.lutMatchesSun({evaluation:{solarPosition:{azimuthDeg:359.9,apparentElevationDeg:20}}},{azimuth:0.1,elevation:20}),true);
 assert.equal(r.lutMatchesSun({evaluation:{solarPosition:{azimuthDeg:90,apparentElevationDeg:20}}},{azimuth:0,elevation:20}),false);
});
test('LUT upload preserves float radiance and handles RGB/RGBA and invalid data',async()=>{
 const {packLut}=await renderer();const rgb={layout:{width:1,height:1,channels:['R','G','B']},pixels:[2,0.25,0.5]};
 assert.deepEqual([...packLut(rgb).data],[2,0.25,0.5,1]);assert.deepEqual([...packLut(rgb,false).data],[255,64,128,255]);
 assert.deepEqual([...packLut({layout:{width:1,height:1},pixels:[1,0.5,0.25,0]}).data],[1,0.5,0.25,1]);
 assert.equal(packLut({layout:{width:2048,height:1024},pixels:[]}),null);assert.equal(packLut(null),null);
});
test('viewport camera roundtrips projects, autosave and undo without scheduling physical light',async()=>{
 const {SkyForgeStore}=await import(storeUrl);const {LightingSync}=await import(url(source('src/client/core/lighting-sync.js')));
 const {ProjectService}=await import(url(source('src/client/core/project-service.js').replace('"./state-store.js"',JSON.stringify(storeUrl))));
 const values=new Map(),storage={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)};
 const s=new SkyForgeStore({storage}),lighting=new LightingSync(s);let calls=0;lighting.schedule=()=>calls++;
 const before=s.get('viewport.camera');s.set('viewport.camera',{...before,yaw:1.1},{label:'Orbit'});assert.equal(calls,0);
 const doc=new ProjectService(s).createDocument();s.undo();assert.deepEqual(s.get('viewport.camera'),before);s.redo();assert.equal(s.get('viewport.camera.yaw'),1.1);
 s.persist();const restored=new SkyForgeStore({storage});restored.restore();assert.equal(restored.get('viewport.camera.yaw'),1.1);
 new ProjectService(restored).loadDocument(doc);assert.equal(restored.get('viewport.camera.yaw'),1.1);
 s.set('sun.elevation',35);assert.equal(calls,1);lighting.dispose();s.destroy();restored.destroy();
});
test('old projects without viewport state get camera defaults without mutating their payload',async()=>{
 const m=await camera();const old={camera:{exposure:2},sun:{elevation:20}};const before=JSON.stringify(old);
 assert.deepEqual(m.normalizeCamera(old.viewport?.camera),m.normalizeCamera());assert.equal(JSON.stringify(old),before);
});

test('splash observer is idempotent and cannot starve viewport animation frames',async()=>{
 const {SkyForgeUIBridge}=await import(url(source('src/client/core/ui-bridge.js')));
 const previous={document:global.document,MutationObserver:global.MutationObserver,close:global.sfCloseStartupSplash,show:global.sfShowStartupSplash};
 let showing=true,removes=0,callback;
 const splash={classList:{contains:()=>showing,remove:()=>{removes++;showing=false;}}};
 global.document={getElementById:()=>splash};global.MutationObserver=class{constructor(fn){callback=fn;}observe(){}};
 try{const ui=new SkyForgeUIBridge({});ui.disableLegacySplash();for(let i=0;i<5;i++)callback();assert.equal(removes,1);showing=true;callback();callback();assert.equal(removes,2);}
 finally{global.document=previous.document;global.MutationObserver=previous.MutationObserver;global.sfCloseStartupSplash=previous.close;global.sfShowStartupSplash=previous.show;}
});
