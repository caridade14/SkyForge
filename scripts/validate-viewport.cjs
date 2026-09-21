// Integration gate against the real gateway, shaders and legacy page. No mocked renderer.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.SKYFORGE_TEST_URL||'http://127.0.0.1:3000';
const out=process.env.SKYFORGE_TEST_OUTPUT||'/tmp/skyforge-viewport-browser';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const requests=[];page.on('request',r=>{if(r.url().includes('/api/lighting/preview'))requests.push(r.postData());});
 try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.SkyForgeCore?.viewport?.renderer?.frames>0,{},{timeout:30000});
  assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.active),true,'WebGL must initialize on the real page');
  assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.renderer.gl.getError()),0,'No WebGL errors');
  const canvas=page.locator('.sf-3d-canvas'),box=await canvas.boundingBox();assert.ok(box&&box.width>0);
  const cx=box.x+box.width*0.5,cy=box.y+box.height*0.55;
  const read=()=>page.evaluate(()=>SkyForgeCore.store.get('viewport.camera'));
  const original=await read();
  const before=await canvas.screenshot();await page.screenshot({path:path.join(out,'viewport-initial.png')});
  await page.mouse.move(cx,cy);await page.mouse.down({button:'middle'});await page.mouse.move(cx+90,cy+30,{steps:6});await page.mouse.up({button:'middle'});
  const orbited=await read();assert.notEqual(orbited.yaw,original.yaw,'MMB orbits');
  await page.evaluate(()=>SkyForgeCore.store.undo());assert.deepEqual(await read(),original,'one gesture = one undo step');
  await page.evaluate(()=>SkyForgeCore.store.redo());assert.deepEqual(await read(),orbited);
  await page.keyboard.down('Shift');await page.mouse.move(cx,cy);await page.mouse.down({button:'middle'});await page.mouse.move(cx+35,cy-25,{steps:4});await page.mouse.up({button:'middle'});await page.keyboard.up('Shift');
  const panned=await read();assert.notDeepEqual(panned.target,orbited.target);assert.equal(panned.yaw,orbited.yaw);
  await page.mouse.wheel(0,-150);await page.waitForTimeout(150);assert.ok((await read()).distance<panned.distance);
  const beforeAlt=await read();await page.keyboard.down('Alt');await page.mouse.down();await page.mouse.move(cx-45,cy+10,{steps:4});await page.mouse.up();await page.keyboard.up('Alt');assert.notEqual((await read()).yaw,beforeAlt.yaw,'Mac emulation orbits');
  await canvas.focus();await page.keyboard.press('Numpad7');assert.equal((await read()).projection,'orthographic');assert.ok((await read()).pitch>1.5);
  await page.screenshot({path:path.join(out,'viewport-top.png')});
  await page.keyboard.press('Numpad5');assert.equal((await read()).projection,'perspective');
  await page.keyboard.press('Home');assert.deepEqual(await read(),original);
  // Cancellation does not add history or alter persistent camera state.
  const history=await page.evaluate(()=>SkyForgeCore.store.history.length);
  await page.mouse.move(cx,cy);await page.mouse.down({button:'middle'});await page.mouse.move(cx+60,cy+10,{steps:4});await page.keyboard.press('Escape');await page.mouse.up({button:'middle'});
  assert.deepEqual(await read(),original);assert.equal(await page.evaluate(()=>SkyForgeCore.store.history.length),history);
  // Store edits, timeline seek and project reload all update the same renderer.
  await page.evaluate(()=>{SkyForgeCore.store.set('sun.elevation',55);SkyForgeCore.store.set('clouds.coverage',0.1);SkyForgeCore.store.set('camera.exposure',2);});
  await page.waitForTimeout(150);assert.notDeepEqual(await canvas.screenshot(),before,'scene controls affect rendered pixels');
  const serialized=await page.evaluate(()=>SkyForgeCore.projects.createDocument());
  await page.evaluate(doc=>SkyForgeCore.projects.loadDocument(doc),serialized);
  assert.equal(await page.evaluate(()=>SkyForgeCore.store.get('sun.elevation')),55);
  // Wait for initial physical work, then prove camera-only navigation is local.
  await page.waitForFunction(()=>SkyForgeNaturalLightPreview.getState().skyViewLut!==null,{},{timeout:30000});
  await page.waitForTimeout(1200);
  const requestCount=requests.length;
  await page.mouse.move(cx,cy);await page.mouse.down({button:'middle'});await page.mouse.move(cx+50,cy+20,{steps:5});await page.mouse.up({button:'middle'});
  await page.waitForTimeout(700);assert.equal(requests.length,requestCount,'camera navigation must not evaluate Natural Light');
  // Rendering must sleep while idle, even when the legacy UI polls bridge/status.
  const frames=await page.evaluate(()=>SkyForgeCore.viewport.renderer.frames);await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.renderer.frames),frames,'no permanent render loop');
  await page.locator('[data-vp=sun]').click();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.renderer.usingLut),true);
  await page.screenshot({path:path.join(out,'viewport-physical-lut.png')});
  await page.locator('[data-vp=mode]').click();assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.active),false);
  assert.equal(await page.locator('#vp-canvas').isVisible(),true,'legacy renderer still available');
  await page.locator('[data-vp=mode]').click();assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.active),true);
  // Actual context loss/recovery via the WebGL extension, not a mocked context.
  await page.evaluate(()=>{const gl=SkyForgeCore.viewport.renderer.gl;window.testLoss=gl.getExtension('WEBGL_lose_context');testLoss.loseContext();});
  await page.waitForFunction(()=>!SkyForgeCore.viewport.active);assert.equal(await page.locator('#vp-canvas').isVisible(),true);
  await page.evaluate(()=>testLoss.restoreContext());await page.waitForFunction(()=>SkyForgeCore.viewport.active);
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.renderer.gl.getError()),0);
  await page.evaluate(()=>{SkyForgeCore.store.set('viewport.camera',{...SkyForgeCore.store.get('viewport.camera'),yaw:1.234});SkyForgeCore.store.persist();});
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>SkyForgeCore?.viewport?.active);assert.equal((await read()).yaw,1.234,'autosave restores camera after reload');
  await page.evaluate(()=>SkyForgeCore.viewport.dispose());assert.equal(await page.locator('.sf-3d-host').count(),0);assert.equal(await page.evaluate(()=>SF_VIEWPORT_3D_ACTIVE),false);
  const fallback=await browser.newPage({viewport:{width:1280,height:900}});
  await fallback.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(type==='webgl'||type==='webgl2')return null;return original.call(this,type,...args);};});
  await fallback.goto(base,{waitUntil:'domcontentloaded'});await fallback.waitForFunction(()=>globalThis.SkyForgeCore?.viewport);
  assert.equal(await fallback.evaluate(()=>SkyForgeCore.viewport.active),false);assert.equal(await fallback.locator('#vp-canvas').isVisible(),true);
  assert.match(await fallback.locator('.sf-3d-message').innerText(),/WebGL unavailable/);await fallback.close();
  assert.ok(!errors.some(e=>/Shader|WebGL.*INVALID|viewport\/|SkyViewportRenderer/.test(e)),errors.join('\n'));
  console.log('PASS: real WebGL, navigation, state, undo, LUT, idle rendering, no physical requests, fallback, context recovery and dispose');
 }catch(error){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(out,'browser-errors.json'),JSON.stringify(errors,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
