// Real WebGL/material/shadow gate. Run against the existing SkyForge gateway.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=process.env.SKYFORGE_TEST_OUTPUT||'/tmp/skyforge-lighting';fs.mkdirSync(out,{recursive:true});
(async()=>{
  const launch={headless:true};if(process.env.PLAYWRIGHT_CHANNEL)launch.channel=process.env.PLAYWRIGHT_CHANNEL;if(process.env.PLAYWRIGHT_EXECUTABLE_PATH)launch.executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if(process.env.SKYFORGE_WEBGL_BACKEND!=='native')launch.args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'];
  const browser=await chromium.launch(launch),page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(20000);
  const errors=[],results={backend:process.env.SKYFORGE_WEBGL_BACKEND||'swiftshader',checks:[],metrics:{}};
  page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+m.location().url);});
  const stage=name=>{console.log('Lighting: '+name);results.checks.push(name);};
  const read=p=>page.evaluate(p=>SkyForgeCore.store.get(p),p);
  const command=async(menu,action)=>{await page.locator(`[data-studio-menu="${menu}"]`).click();await page.locator(`#sf-studio-menus [aria-label="${menu}"] [data-studio-command="${action}"]`).click();};
  const frame=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
    const v=SkyForgeCore.viewport,t=setTimeout(()=>reject(new Error('Lighting readback timeout')),20000);v.invalidate();requestAnimationFrame(()=>{
      try{const g=v.renderer.gl,w=v.canvas.width,h=v.canvas.height,p=new Uint8Array(w*h*4);g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,p);clearTimeout(t);resolve({pixels:[...p],w,h,error:g.getError(),lighting:v.renderer.lightingMetrics,clouds:v.renderer.cloudMetrics});}catch(e){clearTimeout(t);reject(e);}
    });
  }));
  const difference=(a,b)=>{assert.equal(a.pixels.length,b.pixels.length);let sum=0,count=0;for(let i=0;i<a.pixels.length;i+=4){const d=Math.abs(a.pixels[i]-b.pixels[i])+Math.abs(a.pixels[i+1]-b.pixels[i+1])+Math.abs(a.pixels[i+2]-b.pixels[i+2]);sum+=d/3;if(d>12)count++;}return{mean:sum/(a.w*a.h),fraction:count/(a.w*a.h)};};
  const probeFrame=()=>page.evaluate(()=>{
    const g=SkyForgeCore.viewport.renderer.gl,p=SkyForgeCore.viewport.renderer.reflectionProbe,pixels=new Uint8Array(p.width*p.height*4);
    g.bindFramebuffer(g.FRAMEBUFFER,p.framebuffer);g.readPixels(0,0,p.width,p.height,g.RGBA,g.UNSIGNED_BYTE,pixels);g.bindFramebuffer(g.FRAMEBUFFER,null);
    return {pixels:[...pixels],w:p.width,h:p.height,error:g.getError()};
  });
  const region=async(image,point,radius=8)=>{
    const p=await page.evaluate(async point=>{const {projectPoint}=await import('/src/client/viewport/reference-geometry.js'),v=SkyForgeCore.viewport;return projectPoint(point,v.getCamera(),v.canvas.width/v.canvas.height,SkyForgeCore.store.get('camera.fov'));},point);
    assert.equal(p.behind,false);const x=Math.round((p.x+1)*image.w/2),y=Math.round((p.y+1)*image.h/2),pixels=[];
    for(let dy=-radius;dy<radius;dy++)for(let dx=-radius;dx<radius;dx++){const i=((y+dy)*image.w+x+dx)*4;assert.ok(i>=0&&i+3<image.pixels.length);pixels.push(...image.pixels.slice(i,i+4));}
    return {pixels,w:radius*2,h:radius*2};
  };
  const material=p=>page.locator(`[data-material="${p}"]`);
  try{
    await page.goto(process.env.SKYFORGE_TEST_URL||'http://127.0.0.1:3000',{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForFunction(()=>SkyForgeCore?.workspace?.lightingBench&&SkyForgeCore.viewport.renderer.frames>0);
    stage('add a real reference bench, preserve the sky, and undo the whole scene addition');
    const sky=await read('sun'),clouds=await read('clouds'),camera=await read('viewport.camera'),history=await page.evaluate(()=>SkyForgeCore.store.history.length);
    await command('Sky','sky-lighting');assert.equal(await page.locator('#sec-sf-lighting').isVisible(),true);
    await page.locator('[data-lighting-add]').click();assert.equal(Object.keys(await read('scene.referenceObjects')).length,4);
    assert.deepEqual(await read('sun'),sky);assert.deepEqual(await read('clouds'),clouds);assert.equal(await page.evaluate(()=>SkyForgeCore.store.history.length),history+1);
    await command('Edit','undo');assert.equal(Object.keys(await read('scene.referenceObjects')).length,0);assert.deepEqual(await read('viewport.camera'),camera);
    await command('Edit','redo');assert.equal(Object.keys(await read('scene.referenceObjects')).length,4);
    const id=await read('scene.selectedReferenceId');assert.equal(await page.locator('.sf-reference-materials').isVisible(),true);
    await command('Sky','sky-sun');await page.locator('[data-studio-sun-preset="Noon"]').click();await command('Sky','sky-clouds');await page.locator('[data-cloud-preset="Clear"]').click();
    await page.evaluate(()=>{SkyForgeCore.store.set('viewport.grid',false,{record:false});SkyForgeCore.store.set('viewport.overlays',false,{record:false});});
    stage('object shadows change real framebuffer pixels and reuse the cached depth pass');
    const shaded=await frame();assert.equal(shaded.error,0);assert.equal(shaded.lighting.objectShadows,true);assert.equal(shaded.lighting.shadowMapSize,512);assert.ok(shaded.w*shaded.h<=250000);
    await page.screenshot({path:path.join(out,'lighting-bench.png')});
    const repeated=await frame();assert.equal(repeated.lighting.shadowDraws,shaded.lighting.shadowDraws,'unchanged scene reuses its depth map');
    assert.equal(shaded.lighting.reflectionProbe,true,shaded.lighting.reflectionFallback);assert.deepEqual(shaded.lighting.reflectionSize,[128,64]);
    assert.equal(repeated.lighting.reflectionDraws,shaded.lighting.reflectionDraws,'unchanged sky reuses its reflection probe');
    await command('View','shadows');const unshadowed=await frame();assert.equal(unshadowed.lighting.objectShadows,false);
    await page.screenshot({path:path.join(out,'lighting-no-shadows.png')});
    results.metrics.shadows=difference(shaded,unshadowed);assert.ok(results.metrics.shadows.fraction>.001,JSON.stringify(results.metrics.shadows));
    results.metrics.unoccludedGround=difference(await region(shaded,[6,-5,0]),await region(unshadowed,[6,-5,0]));
    assert.ok(results.metrics.unoccludedGround.mean<.1&&results.metrics.unoccludedGround.fraction===0,'unoccluded ground must not acquire self-shadow stripes');
    assert.ok(results.metrics.shadows.mean>.05);await command('View','shadows');const cached=await frame();assert.equal(cached.lighting.shadowDraws,shaded.lighting.shadowDraws);
    await page.evaluate(id=>SkyForgeCore.store.set(`scene.referenceObjects.${id}.position`,[-2,1,1.05]),id);const moved=await frame();assert.ok(moved.lighting.shadowDraws>cached.lighting.shadowDraws);
    stage('material presets, metallic reflection and base color change the actual mesh shading');
    await page.locator('[data-studio-inspector="selection"]').click();const matte=await frame();
    await page.getByLabel('Material preset',{exact:true}).selectOption('Chrome');const chrome=await frame();
    assert.equal((await read(`scene.referenceObjects.${id}.material`)).metalness,1);assert.equal(chrome.error,0);
    assert.equal(chrome.lighting.shadowDraws,matte.lighting.shadowDraws,'material edits preserve the depth map');
    assert.equal(chrome.lighting.reflectionDraws,matte.lighting.reflectionDraws,'material edits preserve the sky probe');
    results.metrics.material=difference(matte,chrome);assert.ok(results.metrics.material.fraction>.002,JSON.stringify(results.metrics.material));
    stage('clouds update the actual GPU sky probe and the chrome sphere reflection');
    const clearProbe=await probeFrame();await command('Sky','sky-clouds');await page.locator('[data-cloud-preset="Overcast"]').click();
    const cloudy=await frame(),cloudProbe=await probeFrame();assert.equal(cloudProbe.error,0);
    assert.ok(cloudy.lighting.reflectionDraws>chrome.lighting.reflectionDraws);assert.equal(cloudy.lighting.shadowDraws,chrome.lighting.shadowDraws);
    results.metrics.cloudProbe=difference(clearProbe,cloudProbe);assert.ok(results.metrics.cloudProbe.fraction>.01,JSON.stringify(results.metrics.cloudProbe));
    results.metrics.cloudReflection=difference(await region(chrome,[-2,1,1.05]),await region(cloudy,[-2,1,1.05]));
    assert.ok(results.metrics.cloudReflection.mean>.1,JSON.stringify(results.metrics.cloudReflection));
    await page.screenshot({path:path.join(out,'lighting-cloud-reflections.png')});
    // Clear only the actual GPU environment target. Keep the Sun, cloud-shadow
    // pass and material fixed so the next readback isolates the reflection.
    await page.evaluate(()=>{const r=SkyForgeCore.viewport.renderer,g=r.gl;g.bindFramebuffer(g.FRAMEBUFFER,r.reflectionProbe.framebuffer);g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);g.bindFramebuffer(g.FRAMEBUFFER,null);g.clearColor(0,0,0,1);});
    const blackEnvironment=await frame();results.metrics.probeContribution=difference(await region(cloudy,[-2,1,1.05]),await region(blackEnvironment,[-2,1,1.05]));
    assert.ok(results.metrics.probeContribution.mean>.2,JSON.stringify(results.metrics.probeContribution));
    await page.evaluate(()=>{SkyForgeCore.viewport.renderer.reflectionProbe.key=null;});await frame();
    await page.locator('[data-cloud-preset="Clear"]').click();await frame();await page.locator('[data-studio-inspector="selection"]').click();
    await material('baseColor').evaluate(input=>{input.value='#cc2200';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
    const color=await read(`scene.referenceObjects.${id}.material.baseColor`);assert.ok(Math.abs(color[0]-.603827)<1e-5);assert.ok(color[1]<.02);assert.equal(color[2],0);
    stage('live roughness edits commit one Undo, Escape restores the prior material, and locked references refuse edits');
    const count=await page.evaluate(()=>SkyForgeCore.store.history.length);await material('roughness').focus();
    await material('roughness').evaluate(input=>{for(const value of [.3,.5,.7,.85]){input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));}});
    assert.equal((await read(`scene.referenceObjects.${id}.material`)).roughness,.85);assert.equal(await page.evaluate(()=>SkyForgeCore.store.history.length),count);
    const committedRoughness=await page.evaluate(id=>SkyForgeCore.projects.createDocument().payload.scene.referenceObjects[id].material.roughness,id);assert.equal(committedRoughness,.1);
    await material('roughness').evaluate(input=>input.dispatchEvent(new Event('change',{bubbles:true})));assert.equal(await page.evaluate(()=>SkyForgeCore.store.history.length),count+1);
    await command('Edit','undo');assert.equal((await read(`scene.referenceObjects.${id}.material`)).roughness,.1);assert.equal(Number(await material('roughness').inputValue()),.1);
    await material('roughness').focus();await material('roughness').evaluate(input=>{input.value='.6';input.dispatchEvent(new Event('input',{bubbles:true}));});await page.keyboard.press('Escape');
    assert.equal((await read(`scene.referenceObjects.${id}.material`)).roughness,.1);assert.equal(await page.evaluate(()=>SkyForgeCore.store.history.length),count);
    await page.evaluate(id=>SkyForgeCore.store.set(`scene.referenceObjects.${id}.locked`,true),id);assert.equal(await material('roughness').isDisabled(),true);
    await page.evaluate(id=>SkyForgeCore.store.set(`scene.referenceObjects.${id}.locked`,false),id);
    stage('project save/open and duplicate keep the material and both shadow flags');
    await material('castShadow').uncheck();await material('receiveShadow').uncheck();const savedMaterial=await read(`scene.referenceObjects.${id}.material`);
    const downloading=page.waitForEvent('download');await command('File','save');const download=await downloading,chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);const saved=Buffer.concat(chunks);
    assert.deepEqual(JSON.parse(saved).payload.scene.referenceObjects[id].material,savedMaterial);
    await command('Edit','duplicate');const duplicate=await read('scene.selectedReferenceId');assert.notEqual(duplicate,id);assert.deepEqual(await read(`scene.referenceObjects.${duplicate}.material`),savedMaterial);
    const choosing=page.waitForEvent('filechooser');await command('File','open');await(await choosing).setFiles({name:'lighting.skyforge',mimeType:'application/json',buffer:saved});
    await page.waitForFunction(()=>!SkyForgeCore.store.canUndo());assert.deepEqual(await read(`scene.referenceObjects.${id}.material`),savedMaterial);
    await command('Sky','sky-lighting');assert.equal(await page.locator('[data-lighting-shadows]').isChecked(),true);
    assert.ok((await page.locator('.sf-lighting-readout').innerText()).includes('Physical irradiance not evaluated'));
    stage('dispose releases shadow and reflection framebuffers, textures and programs');
    const released=await page.evaluate(()=>{const v=SkyForgeCore.viewport,g=v.renderer.gl,s=v.renderer.objectShadows,p=v.renderer.reflectionProbe,handles={framebuffer:s.framebuffer,depth:s.depth,texture:s.texture,program:s.program,probeFramebuffer:p.framebuffer,probeTexture:p.texture,probePrograms:[...p.programs.values()]};v.dispose();return{framebuffer:g.isFramebuffer(handles.framebuffer),depth:g.isRenderbuffer(handles.depth),texture:g.isTexture(handles.texture),program:g.isProgram(handles.program),probeFramebuffer:g.isFramebuffer(handles.probeFramebuffer),probeTexture:g.isTexture(handles.probeTexture),probePrograms:handles.probePrograms.some(p=>g.isProgram(p)),pending:v.frame};});
    assert.deepEqual(released,{framebuffer:false,depth:false,texture:false,program:false,probeFramebuffer:false,probeTexture:false,probePrograms:false,pending:null});
    const fatal=errors.filter(e=>!/fonts\.googleapis\.com/.test(e)&&!/status of 404.*\/assets\/(?:startup-skyforge-splash\.png|earth-blue-marble\.jpg|world-map-reference(?:-significados)?\.(?:jpg|png))$/.test(e));assert.deepEqual(fatal,[]);
    console.log('PASS: real materials, object shadows, reference bench, transactions and persistence');
  }catch(e){results.failure=e.stack||e.message;await page.screenshot({path:path.join(out,'lighting-failure.png')}).catch(()=>{});throw e;}
  finally{results.errors=errors;fs.writeFileSync(path.join(out,'lighting-results.json'),JSON.stringify(results,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
