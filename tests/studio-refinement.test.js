const test=require('node:test'),assert=require('node:assert/strict');
const {clientSource}=require('./helpers/client-source.cjs');
const mod=name=>import('data:text/javascript;base64,'+Buffer.from(clientSource(name)).toString('base64'));

test('a selected sky look replaces legacy rendering settings in one reversible edit and preserves scene/graph/animation data',async()=>{
 const {createSkyForgeStore}=await mod('src/client/core/state-store.js'),{SCENE_LOOKS,applySceneLook}=await mod('src/client/studio/scene-looks.js');
 const store=createSkyForgeStore();store.set('viewport.mode','legacy');store.set('viewport.cloudMode','layer');store.set('scene.authority','graph');store.set('clouds.scale',6000);
 store.set('scene.referenceObjects',{asset:{id:'asset',type:'cube',position:[3,4,5]}});store.set('timeline.keyframes',{'sun.elevation':[{frame:1,value:3},{frame:24,value:30}]});
 const before=store.snapshot(),history=store.history.length;
 store.batch('Select look',draft=>applySceneLook(draft,'Cumulus daylight'));
 assert.equal(store.history.length,history+1);assert.equal(store.get('viewport.mode'),'webgl');assert.equal(store.get('viewport.cloudMode'),'volumetric');assert.equal(store.get('scene.authority'),'direct');assert.equal(store.get('clouds.scale'),1200);
 for(const path of ['scene.referenceObjects','nodes','timeline.keyframes'])assert.deepEqual(store.get(path),path.split('.').reduce((a,k)=>a[k],before));
 store.undo();assert.equal(store.get('viewport.mode'),'legacy');assert.equal(store.get('scene.authority'),'graph');assert.equal(store.get('clouds.scale'),6000);
 for(const root of ['sun','atmosphere','clouds','moon','stars','aurora','rainbow','camera','viewport'])assert.deepEqual(store.get(root),before[root]);
 store.redo();assert.equal(store.get('sun.elevation'),35);
 const {cameraBasis}=await mod('src/client/viewport/camera.js');
 for(const name of Object.keys(SCENE_LOOKS)){const draft=store.snapshot();applySceneLook(draft,name);assert.ok(Number.isFinite(draft.viewport.camera.pitch));assert.equal(draft.viewport.mode,'webgl');assert.ok(cameraBasis(draft.viewport.camera).eye[2]>=1.7,'sky look observer stays above the ground');}
 assert.throws(()=>applySceneLook(store.snapshot(),'invalid'),/Unknown sky look/);store.destroy();
});

test('sky framing faces celestial directions without swinging the observer below the ground',async()=>{
 const {frameSky,cameraBasis,normalizeCamera,sunDirection}=await mod('src/client/viewport/camera.js');
 const camera=normalizeCamera({target:[10,20,2],distance:12,pitch:.4});
 const before=cameraBasis(camera).eye;
 for(const [azimuth,elevation]of [[0,32],[315,60],[210,12],[30,-5]]){
  const aimed=frameSky(camera,azimuth,elevation),basis=cameraBasis(aimed),direction=sunDirection({azimuth,elevation});
  assert.equal(aimed.distance,camera.distance);assert.equal(aimed.projection,'perspective');
  for(let i=0;i<3;i++){assert.ok(Math.abs(basis.eye[i]-before[i])<1e-10,'framing preserves the observer position');assert.ok(Math.abs(basis.forward[i]-direction[i])<1e-10,'screen centre points at the selected direction');}
 }
 const underground=normalizeCamera({target:[1,2,1],distance:20,pitch:-.6});
 assert.ok(cameraBasis(frameSky(underground,0,34)).eye[2]>=1.7-1e-10);
 assert.ok(Object.values(frameSky(camera,NaN,Infinity)).every(v=>Array.isArray(v)?v.every(Number.isFinite):typeof v!=='number'||Number.isFinite(v)));
});

test('cloud altitude changes spherical solar transmission and twilight ground shadow without rebuilding optics',async()=>{
 const {AtmosphereTransport}=await mod('src/client/viewport/atmosphere-transport.js'),solver=new AtmosphereTransport();
 assert.throws(()=>solver.sunTransmission(),/Update atmosphere/);
 const surface=solver.update({}, {elevation:3}),builds=solver.builds,optics=solver.opticalBuilds;
 assert.deepEqual(solver.sunTransmission(20,3),surface.direct);
 const low=solver.sunTransmission(600,3),high=solver.sunTransmission(8000,3);
 assert.ok(high.every((v,i)=>v>low[i]&&v<=1));assert.ok(high[2]>low[2]*5,'high clouds retain more blue solar light');
 assert.ok(high[0]/high[2]<low[0]/low[2],'the airborne source is less red than the low source');
 assert.deepEqual(solver.sunTransmission(20,-1),[0,0,0]);assert.deepEqual(solver.sunTransmission(600,-1),[0,0,0]);
 assert.ok(solver.sunTransmission(3000,-1)[0]>0,'a high layer remains sunlit after the ground enters planet shadow');
 assert.deepEqual(solver.sunTransmission(3000,-18),[0,0,0]);
 assert.ok(solver.sunTransmission(Infinity,NaN).every(v=>Number.isFinite(v)&&v>=0&&v<=1));
 assert.equal(solver.opticalBuilds,optics);assert.equal(solver.builds,builds);
});

test('display and cloud resolutions have independent hard budgets, and cloud size uses bounded metre units',async()=>{
 const {DISPLAY_BUDGET}=await mod('src/client/viewport/cloud-pass.js'),{cloudPreviewResolution,CLOUD_QUALITIES,cloudUniforms}=await mod('src/client/viewport/volumetric-clouds.js');
 for(const [w,h,dpr]of [[720,665,1],[2560,1600,2],[1e7,2,3],[2,1e7,3]]){
  const display=cloudPreviewResolution(w,h,dpr,DISPLAY_BUDGET),cloud=cloudPreviewResolution(w,h,dpr,CLOUD_QUALITIES.low);
  assert.ok(display.width*display.height<=2000000);assert.ok(cloud.width*cloud.height<=250000);
  assert.ok(display.width>=cloud.width);assert.ok(display.height>=cloud.height);
 }
 assert.deepEqual(cloudPreviewResolution(720,665,1,DISPLAY_BUDGET),{width:720,height:665});
 assert.equal(cloudUniforms({}).uCloudScale,1200);assert.equal(cloudUniforms({clouds:{scale:Infinity}}).uCloudScale,1200);assert.equal(cloudUniforms({clouds:{scale:-20}}).uCloudScale,250);assert.equal(cloudUniforms({clouds:{scale:10000}}).uCloudScale,6000);
});

test('old projects and graph bases gain cloud size without overwriting existing sizes; the real Clouds node evaluates it',async()=>{
 const {completeProjectState}=await mod('src/client/core/project-service.js'),{NodeGraph}=await mod('src/client/core/node-graph.js');
 const loaded=completeProjectState({clouds:{coverage:.3},scene:{directState:{clouds:{coverage:.6}}}});assert.equal(loaded.clouds.scale,1200);assert.equal(loaded.scene.directState.clouds.scale,1200);
 assert.equal(completeProjectState({clouds:{scale:1700}}).clouds.scale,1700);
 const graph=new NodeGraph();graph.createDefaultGraph();graph.updateNode('clouds',{params:{scale:850}});assert.equal(graph.evaluateOutput({state:loaded}).clouds.scale,850);assert.equal(graph.nodes.size,6);
});
