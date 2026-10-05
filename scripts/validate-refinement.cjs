// Reproduce saved-layout/Legacy mistakes and read actual separate cloud and
// display framebuffers. Browser tools remain outside the runtime project.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=process.env.SKYFORGE_TEST_OUTPUT||'/tmp/skyforge-refinement';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const launch={headless:true};if(process.env.PLAYWRIGHT_EXECUTABLE_PATH)launch.executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH;if(process.env.PLAYWRIGHT_CHANNEL)launch.channel=process.env.PLAYWRIGHT_CHANNEL;
 if(process.env.SKYFORGE_WEBGL_BACKEND!=='native')launch.args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'];
 const b=await chromium.launch(launch),context=await b.newContext({viewport:{width:1280,height:800},acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(45000);
 const errors=[],results={checks:[],metrics:{}};page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+m.location().url);});
 const stage=name=>{results.checks.push(name);console.log('Refinement: '+name);};
 const frame=p=>p.evaluate(()=>new Promise((resolve,reject)=>{const v=SkyForgeCore.viewport,t=setTimeout(()=>reject(new Error('Refinement frame timeout')),45000);v.invalidate();requestAnimationFrame(()=>{try{const g=v.renderer.gl,w=v.canvas.width,h=v.canvas.height,all=new Uint8Array(w*h*4),pixels=[];g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,all);for(let y=0;y<h;y+=3)for(let x=0;x<w;x+=3){const i=(y*w+x)*4;pixels.push(all[i],all[i+1],all[i+2]);}clearTimeout(t);resolve({w,h,pixels,clouds:v.renderer.cloudMetrics,error:g.getError()});}catch(e){clearTimeout(t);reject(e);}});}));
 const diff=(a,b)=>{assert.equal(a.length,b.length);let sum=0,changed=0;for(let i=0;i<a.length;i+=3){const d=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;sum+=d;if(d>6)changed++;}return{mean:sum/(a.length/3),changed};};
 const ready=async p=>{await p.goto(process.env.SKYFORGE_TEST_URL||'http://127.0.0.1:3000',{waitUntil:'domcontentloaded',timeout:45000});await p.waitForFunction(()=>globalThis.SkyForgeCore?.workspace?.looks&&SkyForgeCore.viewport.renderer?.frames>0);await p.waitForFunction(()=>getComputedStyle(document.getElementById('sf-studio-menus')).display==='flex');};
 try{
  await ready(page);stage('native display resolution with an independently bounded float cloud pass');
  const initial=await frame(page);assert.equal(initial.error,0);assert.equal(initial.clouds.pipeline,'separate');assert.ok(initial.clouds.pixels<=250000);assert.ok(initial.w*initial.h>initial.clouds.pixels);assert.ok(initial.w*initial.h<=2000000);assert.ok(['rgba16f','rgba32f','rgba8-log'].includes(initial.clouds.bufferFormat));results.metrics.initial=initial.clouds;
  assert.equal(await page.locator('.sf-studio-version').textContent(),'R16');
  assert.equal(await page.locator('[data-vp="mode"]').textContent(),'3D View');assert.equal(await page.locator('[data-vp="mode"]').getAttribute('aria-pressed'),'true');
  stage('adding a celestial layer from Legacy opens real 3D in one Undo; navigation buttons reflect the active tool');
  await page.evaluate(()=>SkyForgeCore.store.set('viewport.mode','legacy'));assert.equal(await page.locator('.sf-3d-alert').isVisible(),true);
  assert.equal(await page.locator('[data-vp="mode"]').textContent(),'Legacy View');assert.equal(await page.locator('[data-vp="mode"]').getAttribute('aria-pressed'),'false');
  const history=await page.evaluate(()=>SkyForgeCore.store.history.length);await page.locator('[data-effect-add="moon"]').click();
  assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.active),true);assert.equal(await page.evaluate(()=>SkyForgeCore.store.history.length),history+1);assert.equal(await page.locator('#sec-sf-effects').isVisible(),true);
  await page.evaluate(()=>SkyForgeCore.store.undo());assert.equal(await page.evaluate(()=>SkyForgeCore.store.get('viewport.mode')),'legacy');assert.equal(await page.evaluate(()=>SkyForgeCore.store.get('moon.enabled')),false);
  await page.locator('.sf-3d-alert button').click();await frame(page);await page.locator('[data-vp-rail="orbit"]').click();
  assert.equal(await page.locator('[data-studio-action="move"]').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('[data-vp-rail="orbit"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-studio-space]').isDisabled(),true);
  stage('six complete sky looks update actual GPU pixels, preserve references and commit one edit');
  await page.evaluate(()=>SkyForgeCore.viewport.objectAdapter.add('cube'));const objects=await page.evaluate(()=>SkyForgeCore.store.get('scene.referenceObjects'));
  await page.locator('.sf-open-looks').click();let prior=null;
  const gallery=await page.locator('.sf-sky-looks').evaluate(el=>{const [a,b]=[...el.querySelectorAll('button')].map(b=>b.getBoundingClientRect());return{display:getComputedStyle(el).display,firstTop:a.top,secondTop:b.top,secondLeft:b.left,firstRight:a.right};});
  assert.equal(gallery.display,'grid');assert.ok(Math.abs(gallery.firstTop-gallery.secondTop)<1);assert.ok(gallery.secondLeft>gallery.firstRight);
  for(const name of ['Cumulus daylight','Warm sunset','Storm front','Moonlit night','Aurora night','Sunshower']){
   const history=await page.evaluate(()=>SkyForgeCore.store.history.length);await page.locator(`[data-scene-look="${name}"]`).click();const image=await frame(page);
   assert.equal(image.error,0);assert.equal(image.clouds.pipeline,'separate');assert.equal(await page.evaluate(()=>SkyForgeCore.store.history.length),history+1);assert.deepEqual(await page.evaluate(()=>SkyForgeCore.store.get('scene.referenceObjects')),objects);
   const observerHeight=await page.evaluate(()=>{const c=SkyForgeCore.store.get('viewport.camera');return c.target[2]+Math.sin(c.pitch)*c.distance;});assert.ok(observerHeight>=1.7);
   if(prior)assert.ok(diff(prior.pixels,image.pixels).changed>500,'scene look affects real framebuffer pixels');prior=image;
   await page.screenshot({path:path.join(out,'look-'+name.toLowerCase().replaceAll(' ','-')+'.png')});
  }
  stage('display grading reuses cloud transport; cloud-size editing cancels or commits exactly once');
  await page.locator('[data-scene-look="Cumulus daylight"]').click();await frame(page);const draws=await page.evaluate(()=>SkyForgeCore.viewport.renderer.cloudPass.draws);
  await page.evaluate(()=>SkyForgeCore.store.set('camera.exposure',2));const exposed=await frame(page);assert.equal(exposed.clouds.cloudDraws,draws,'linear cloud pass is independent of display exposure');
  await page.evaluate(()=>SkyForgeCore.store.set('camera.exposure',1));await page.evaluate(()=>SkyForgeCore.workspace.showSky('clouds'));
  const scale=page.getByRole('spinbutton',{name:'Cloud size in metres',exact:true}),old=await scale.inputValue(),before=await frame(page),count=await page.evaluate(()=>SkyForgeCore.store.history.length);
  await scale.fill('700');await scale.press('Escape');assert.equal(await scale.inputValue(),old);assert.equal(await page.evaluate(()=>SkyForgeCore.store.history.length),count);
  await scale.fill('700');await scale.press('Tab');const resized=await frame(page);assert.equal(await page.evaluate(()=>SkyForgeCore.store.get('clouds.scale')),700);assert.equal(await page.evaluate(()=>SkyForgeCore.store.history.length),count+1);assert.ok(diff(before.pixels,resized.pixels).changed>100);
  stage('cloud solar lighting uses layer altitude instead of ground extinction in actual GPU pixels');
  await page.evaluate(()=>{SkyForgeCore.store.set('sun.elevation',3);});const airborne=await frame(page);
  const transmission=await page.evaluate(()=>{const r=SkyForgeCore.viewport.renderer,t=r.transport;r.correctSunTransmission=t.sunTransmission;const ground=t.sunTransmission(20,3);t.sunTransmission=function(_height,elevation){return r.correctSunTransmission.call(this,20,elevation);};return{cloud:r.lightingMetrics.cloudSunTransmission,ground,altitude:r.lightingMetrics.cloudSunAltitudeMetres,opticalBuilds:t.opticalBuilds};});
  assert.ok(transmission.altitude>2000);assert.ok(transmission.cloud[2]>transmission.ground[2]*2);
  const groundLit=await frame(page);results.metrics.cloudAltitudeLighting=diff(airborne.pixels,groundLit.pixels);assert.ok(results.metrics.cloudAltitudeLighting.changed>100);
  await page.evaluate(()=>{const r=SkyForgeCore.viewport.renderer;r.transport.sunTransmission=r.correctSunTransmission;delete r.correctSunTransmission;});await frame(page);assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.renderer.transport.opticalBuilds),transmission.opticalBuilds);
  stage('the unoccluded smooth sphere does not acquire triangle self-shadow stripes');
  await page.evaluate(()=>{const s=SkyForgeCore.store;s.batch('Shadow regression',d=>{d.scene.referenceObjects={};d.viewport.referenceSphere=true;d.viewport.grid=false;d.clouds.coverage=0;Object.assign(d.sun,{elevation:7,azimuth:215});Object.assign(d.viewport.camera,{target:[0,0,1.2],distance:6,yaw:0,pitch:.1});d.viewport.objectShadows=true;});});
  const sphereWith=await frame(page);await page.evaluate(()=>SkyForgeCore.store.set('viewport.objectShadows',false));const sphereWithout=await frame(page);
  // Both frames use the same sphere, camera, sky and material. Only the genuine
  // shadow pass differs; the centre region has no other possible occluder.
  const sphereDiff=await page.evaluate(()=>new Promise(resolve=>{const v=SkyForgeCore.viewport,g=v.renderer.gl,w=v.canvas.width,h=v.canvas.height,read=()=>{const p=new Uint8Array(64*64*4);g.readPixels(Math.round(w/2)-32,Math.round(h/2)-32,64,64,g.RGBA,g.UNSIGNED_BYTE,p);return [...p];};let without;v.invalidate();requestAnimationFrame(()=>{without=read();SkyForgeCore.store.set('viewport.objectShadows',true);v.invalidate();requestAnimationFrame(()=>{const withShadow=read();let sum=0,max=0;for(let i=0;i<without.length;i+=4)for(let c=0;c<3;c++){const d=Math.abs(without[i+c]-withShadow[i+c]);sum+=d;max=Math.max(max,d);}resolve({mean:sum/(64*64*3),max,error:g.getError()});});});}));
  assert.equal(sphereDiff.error,0);assert.ok(sphereDiff.mean<1.5,JSON.stringify(sphereDiff));results.metrics.sphereSelfShadow=sphereDiff;await page.screenshot({path:path.join(out,'sphere-shadow-receiver.png')});
  stage('visible graphics failure and a working retry; diagnostic download reports the actual renderer');
  await page.evaluate(()=>{const v=SkyForgeCore.viewport;v.error='Regression recovery example';v.setActive(false,false);});assert.equal(await page.locator('.sf-3d-alert').isVisible(),true);
  assert.match(await page.locator('.sf-studio-status').textContent(),/Legacy View/);await page.locator('.sf-3d-alert button').click();const recovered=await frame(page);assert.equal(recovered.error,0);assert.equal(await page.locator('.sf-3d-alert').isVisible(),false);assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.error),null);
  await page.evaluate(()=>SkyForgeCore.workspace.showGraphics());const report=JSON.parse(await page.locator('.sf-graphics-report pre').textContent());assert.equal(report.version,'Studio R16');assert.equal(report.renderer,'WebGL');assert.equal(report.clouds.pipeline,'separate');
  const download=page.waitForEvent('download');await page.locator('[data-graphics-download]').click();assert.equal((await download).suggestedFilename(),'skyforge-graphics-report.json');await page.locator('.sf-graphics-report form button').click();
  stage('a renderer initialization failure after real context restoration remains retryable');
  await page.evaluate(()=>{const v=SkyForgeCore.viewport,restore=v.createRenderer.bind(v);v.createRenderer=()=>{v.createRenderer=restore;throw new Error('Context restoration regression');};globalThis.refinementLoseContext=v.renderer.gl.getExtension('WEBGL_lose_context');refinementLoseContext.loseContext();});
  await page.waitForFunction(()=>SkyForgeCore.viewport.lost===true);assert.equal(await page.locator('.sf-3d-alert button').isDisabled(),true);
  await page.evaluate(()=>refinementLoseContext.restoreContext());await page.waitForFunction(()=>SkyForgeCore.viewport.error==='Context restoration regression');
  assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.lost),false);assert.equal(await page.locator('.sf-3d-alert button').isDisabled(),false);await page.locator('.sf-3d-alert button').click();assert.equal((await frame(page)).error,0);
  stage('fixed-point cloud fallback renders the same linear transport within bounded display quantization');
  await page.evaluate(()=>{SkyForgeCore.workspace.selectLook('Cumulus daylight');SkyForgeCore.store.set('viewport.referenceSphere',false);SkyForgeCore.store.set('viewport.grid',false);SkyForgeCore.store.set('scene.referenceObjects',{});});const floating=await frame(page);
  const fallbackContext=await b.newContext({viewport:{width:1280,height:800}});await fallbackContext.addInitScript(()=>{const old=WebGLRenderingContext.prototype.getExtension;WebGLRenderingContext.prototype.getExtension=function(name){return ['OES_texture_half_float','EXT_color_buffer_half_float','WEBGL_color_buffer_float'].includes(name)?null:old.call(this,name);};});const fallback=await fallbackContext.newPage();fallback.on('pageerror',e=>errors.push(e.message));await ready(fallback);
  await fallback.evaluate(()=>{SkyForgeCore.workspace.selectLook('Cumulus daylight');SkyForgeCore.store.set('viewport.referenceSphere',false);SkyForgeCore.store.set('viewport.grid',false);SkyForgeCore.store.set('scene.referenceObjects',{});});const packed=await frame(fallback);assert.equal(packed.error,0);assert.equal(packed.clouds.bufferFormat,'rgba8-log');assert.equal(packed.clouds.pipeline,'separate');results.metrics.quantization=diff(floating.pixels,packed.pixels);assert.ok(results.metrics.quantization.mean<4,JSON.stringify(results.metrics.quantization));await fallbackContext.close();
  stage('on-demand rendering and disposal release the separate cloud framebuffer, texture and programs');
  await frame(page);const countFrames=await page.evaluate(()=>SkyForgeCore.viewport.renderer.frames);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.renderer.frames),countFrames);
  const released=await page.evaluate(()=>{const v=SkyForgeCore.viewport,g=v.renderer.gl,c=v.renderer.cloudPass,t=c.texture,f=c.framebuffer,programs=[...c.programs.values()];SkyForgeCore.dispose();return{texture:g.isTexture(t),framebuffer:g.isFramebuffer(f),programs:programs.some(p=>g.isProgram(p)),rail:!!document.querySelector('.sf-3d-rail'),alerts:!!document.querySelector('.sf-3d-alert'),looks:!!document.querySelector('#sec-sf-looks'),report:!!document.querySelector('.sf-graphics-report')};});assert.deepEqual(released,{texture:false,framebuffer:false,programs:false,rail:false,alerts:false,looks:false,report:false});
  const unexpected=errors.filter(error=>!/fonts\.googleapis\.com|assets\/(?:startup-skyforge-splash\.png|earth-blue-marble\.jpg|world-map-reference(?:-significados)?\.jpg|world-map-reference\.png)/.test(error));assert.deepEqual(unexpected,[]);
  fs.writeFileSync(path.join(out,'refinement-results.json'),JSON.stringify(results,null,2));console.log('PASS: separate cloud rendering, Studio recovery, scene looks and sphere shadows');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
