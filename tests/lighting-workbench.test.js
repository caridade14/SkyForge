const test=require('node:test'),assert=require('node:assert/strict');
const {clientSource}=require('./helpers/client-source.cjs');
const load=name=>import('data:text/javascript;base64,'+Buffer.from(clientSource(name)).toString('base64'));
test('reference materials bound GPU inputs and convert display colors to linear values',async()=>{
  const {normalizeReferenceMaterial:normalize,colorFromHex,colorToHex}=await load('src/client/core/reference-material.js');
  assert.deepEqual(normalize(),{baseColor:[.4,.4,.4],roughness:.65,metalness:0,castShadow:true,receiveShadow:true});
  assert.deepEqual(normalize({baseColor:[Infinity,-4,7],roughness:0,metalness:9,castShadow:false}),{baseColor:[.4,0,1],roughness:.04,metalness:1,castShadow:false,receiveShadow:true});
  const gray=colorFromHex('#808080');assert.ok(Math.abs(gray[0]-.2158605)<1e-6);assert.equal(colorToHex(gray),'#808080');
  assert.equal(colorFromHex('invalid'),null);assert.equal(colorToHex([0,1,0]),'#00ff00');
});
test('materials survive canonical normalization, legacy metadata and project migration',async()=>{
  const {normalizeReferenceObject,referenceToLegacy,referenceFromLegacy,prepareReferenceScene}=await load('src/client/core/scene-object-adapter.js');
  const material={baseColor:[.18,.2,.8],roughness:.123,metalness:.7,castShadow:false,receiveShadow:false};
  const object=normalizeReferenceObject({id:'cube',type:'cube',position:[1,2,3],rotation:[15,20,30],scale:[1,2,3],material});
  assert.deepEqual(referenceFromLegacy(referenceToLegacy(object)),object);
  assert.deepEqual(prepareReferenceScene({objects:[referenceToLegacy(object)]}).scene.referenceObjects.cube,object);
  assert.equal(Object.hasOwn(normalizeReferenceObject({id:'old',type:'sphere'}),'material'),false,'old projects retain their original shape');
});
test('lighting references add to the existing scene and undo in one transaction without changing the sky',async()=>{
  const {SkyForgeStore}=await load('src/client/core/state-store.js'),{addLightingReferences}=await load('src/client/studio/lighting-workbench.js');
  const store=new SkyForgeStore({storage:null});store.set('scene.referenceObjects.existing',{id:'existing',type:'cube',position:[10,0,1]},{record:false});
  const before=store.snapshot(),history=store.history.length,ids=addLightingReferences(store,'test');
  assert.equal(ids.length,4);assert.equal(Object.keys(store.get('scene.referenceObjects')).length,5);
  assert.deepEqual(store.get('sun'),before.sun);assert.deepEqual(store.get('clouds'),before.clouds);assert.equal(store.history.length,history+1);
  assert.equal(store.get(`scene.referenceObjects.${ids[1]}.material.metalness`),1);
  store.undo();assert.deepEqual(store.get('scene'),before.scene);assert.deepEqual(store.get('viewport'),before.viewport);
  store.redo();assert.equal(Object.keys(store.get('scene.referenceObjects')).length,5);
});
test('live material edits export the committed state, cancel fully and roundtrip after commit',async()=>{
  const {SkyForgeStore}=await load('src/client/core/state-store.js'),{ProjectService}=await load('src/client/core/project-service.js');
  const store=new SkyForgeStore({storage:null}),projects=new ProjectService(store);
  const object={id:'sphere',type:'sphere',name:'Test',position:[0,0,1],scale:1,visible:true,locked:false};
  store.set('scene.referenceObjects.sphere',object,{record:false});
  const edit=store.beginEdit('scene.referenceObjects.sphere',{label:'Material'});
  edit.preview({...object,material:{baseColor:[.7,.1,.2],roughness:.35,metalness:.8,castShadow:false,receiveShadow:true}});
  assert.deepEqual(projects.createDocument().payload.scene.referenceObjects.sphere,object);
  edit.cancel();assert.deepEqual(store.get('scene.referenceObjects.sphere'),object);
  const committed=store.beginEdit('scene.referenceObjects.sphere',{label:'Material'});committed.preview({...object,material:{baseColor:[.7,.1,.2],roughness:.35,metalness:.8,castShadow:false,receiveShadow:true}});committed.commit();
  const next=new SkyForgeStore({storage:null}),reopen=new ProjectService(next);reopen.loadDocument(projects.createDocument());
  assert.deepEqual(next.get('scene.referenceObjects.sphere.material'),store.get('scene.referenceObjects.sphere.material'));
});
test('shadow fitting contains transformed object radii and remains finite for vertical sunlight',async()=>{
  const {shadowBounds,shadowMatrix}=await load('src/client/viewport/object-shadows.js');
  const casters=[{center:[2,3,4],radius:3},{center:[-4,0,1],radius:2}],bounds=shadowBounds(casters);
  for(const sun of [[0,0,1],[.6,.7,.3],[0,1,.001]]){
    const matrix=shadowMatrix(bounds,sun);assert.ok([...matrix].every(Number.isFinite));
    for(const c of casters){const p=[...c.center,1],v=[0,1,2,3].map(r=>p.reduce((n,x,col)=>n+x*matrix[col*4+r],0));assert.ok(v.slice(0,3).every(x=>Math.abs(x)<1));}
  }
  assert.equal(shadowBounds([]),null);assert.equal(shadowBounds([{center:[0,0,0],radius:Infinity}]),null);
  assert.equal(shadowBounds([{center:[0,0,0],radius:1e6}]),null);
});

// Simulate allocation failure only; visible shading is tested with real WebGL.
function incompleteContext(){
  const alive=new Set(),removed=[],g={lost:false,DITHER:'dither',FRAMEBUFFER_COMPLETE:'complete',isContextLost(){return this.lost;},isEnabled(){return true;},checkFramebufferStatus(){return 'incomplete';}};
  for(const type of ['Texture','Renderbuffer','Framebuffer']){
    g['create'+type]=()=>{const handle={type};alive.add(handle);return handle;};
    g['delete'+type]=handle=>{alive.delete(handle);removed.push(handle);};
  }
  g.deleteProgram=handle=>{alive.delete(handle);removed.push(handle);};
  for(const name of ['disable','enable','bindFramebuffer','bindRenderbuffer','bindTexture','activeTexture','texParameteri','texImage2D','renderbufferStorage','framebufferTexture2D','framebufferRenderbuffer','clearColor'])g[name]=()=>{};
  return {g,alive,removed};
}
test('incomplete shadow and reflection targets free allocations and do not retry on every draw',async()=>{
  const {ObjectShadowMap}=await load('src/client/viewport/object-shadows.js'),{SkyReflectionProbe}=await load('src/client/viewport/sky-reflections.js');
  for(const kind of ['shadow','reflection']){
    const {g,alive,removed}=incompleteContext();let compilations=0;
    const compile=()=>{compilations++;const p={type:'Program'};alive.add(p);return p;};
    const service=kind==='shadow'?new ObjectShadowMap(g,compile):new SkyReflectionProbe(g,compile,()=> '');
    const update=()=>kind==='shadow'?service.update([{id:'s',center:[0,0,1],radius:1,position:[0,0,1],scale:[1,1,1],rotation:[1,0,0,0,1,0,0,0,1]}],[0,0,1]):service.update({key:'sky',quality:'low',mode:'layer'});
    update();assert.match(service.error,/incomplete/);assert.equal(service.active,false);assert.equal(alive.size,0);
    const count=removed.length,attempts=compilations;update();assert.equal(removed.length,count);assert.equal(compilations,attempts);
    assert.equal(service.texture,null);assert.equal(service.framebuffer,null);
  }
});
test('shadow and reflection disposal forget stale handles after context loss without calling GL deletion',async()=>{
  const {ObjectShadowMap}=await load('src/client/viewport/object-shadows.js'),{SkyReflectionProbe}=await load('src/client/viewport/sky-reflections.js');
  const {g,removed}=incompleteContext();g.lost=true;
  const shadow=new ObjectShadowMap(g,()=>{}),probe=new SkyReflectionProbe(g,()=>{},()=>{});
  Object.assign(shadow,{texture:{},framebuffer:{},depth:{},program:{},active:true});
  Object.assign(probe,{texture:{},framebuffer:{},active:true});probe.programs.set('layer:low',{});
  shadow.dispose();probe.dispose();assert.deepEqual(removed,[]);
  assert.equal(shadow.texture,null);assert.equal(shadow.program,null);assert.equal(probe.texture,null);assert.equal(probe.programs.size,0);assert.equal(probe.active,false);
});
