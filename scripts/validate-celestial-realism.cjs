// Real display pixels and real menus; no renderer / service substitutes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=process.env.SKYFORGE_TEST_OUTPUT||'/tmp/skyforge-celestial-realism';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const launch={headless:true};if(process.env.PLAYWRIGHT_EXECUTABLE_PATH)launch.executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH;
 if(process.env.PLAYWRIGHT_CHANNEL)launch.channel=process.env.PLAYWRIGHT_CHANNEL;
 if(process.env.SKYFORGE_WEBGL_BACKEND!=='native')launch.args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'];
 const browser=await chromium.launch(launch),context=await browser.newContext({viewport:{width:1280,height:840}}),page=await context.newPage();page.setDefaultTimeout(45000);
 const errors=[],results={checks:[],metrics:{}};page.on('pageerror',e=>errors.push(e.stack||e.message));
 const stage=name=>{results.checks.push(name);console.log('Celestial realism: '+name);};
 const command=async(menu,action)=>{await page.locator(`[data-studio-menu="${menu}"]`).click();await page.locator(`#sf-studio-menus [aria-label="${menu}"] [data-studio-command="${action}"]`).click();};
 const read=key=>page.evaluate(key=>SkyForgeCore.store.get(key),key);
 const frame=async name=>{
  const value=await page.evaluate(()=>new Promise((resolve,reject)=>{const v=SkyForgeCore.viewport,t=setTimeout(()=>reject(new Error('GPU readback timeout')),45000);v.invalidate();requestAnimationFrame(()=>{try{const g=v.renderer.gl,w=v.canvas.width,h=v.canvas.height,all=new Uint8Array(w*h*4);g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,all);clearTimeout(t);resolve({w,h,pixels:Array.from(all),error:g.getError(),lighting:v.renderer.lightingMetrics,clouds:v.renderer.cloudMetrics});}catch(e){clearTimeout(t);reject(e);}});}));
  assert.equal(value.error,0);assert.ok(value.w*value.h<=2000000);assert.equal(value.clouds.pipeline,'separate');assert.ok(value.clouds.pixels<=250000);
  if(name)await page.screenshot({path:path.join(output,`r16-${name}.png`)});return value;
 };
 const delta=(a,b)=>{let mean=0,changed=0;for(let i=0;i<a.length;i+=4){const d=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);mean+=d/3;if(d>12)changed++;}return{mean:mean/(a.length/4),changed};};
 try{
  await page.goto(process.env.SKYFORGE_TEST_URL||'http://127.0.0.1:3000',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>globalThis.SkyForgeCore?.workspace?.effects&&SkyForgeCore.viewport.renderer?.frames>0);
  stage('one command menu, compact toolbar and real Legacy restore');
  assert.equal(await page.locator('.sf-studio-version').textContent(),'R16');assert.equal(await page.locator('.sf-studio-file').isVisible(),false);assert.equal(await page.locator('.sf-core-status').isVisible(),false);
  for(const action of ['move','rotate','scale']){assert.equal(await page.locator(`[data-studio-action="${action}"]`).isVisible(),false);assert.equal(await page.locator(`[data-vp-rail="${action}"]`).isVisible(),true);}
  for(const action of ['home','frame','grid','overlays','sun'])assert.equal(await page.locator(`[data-vp="${action}"]`).isVisible(),false);
  assert.equal(await page.locator('.menubar .mb-menus').isVisible(),false);assert.equal(await page.locator('#sf-studio-menus').count(),1);
  await command('View','grid');assert.equal(await read('viewport.grid'),false);await command('View','grid');assert.equal(await read('viewport.grid'),true);
  await page.locator('[data-vp-rail="rotate"]').click();assert.equal(await read('viewport.transformTool'),'rotate');
  await page.locator('[data-studio-action="legacy"]').click();assert.equal(await page.locator('.menubar .mb-menus').isVisible(),true);assert.equal(await page.locator('#sf-studio-menus').isVisible(),false);
  await page.locator('[data-studio-action="legacy"]').click();await frame('compact-workspace');
  stage('one effect pane, keyboard tabs and hidden edit completion');
  await page.getByRole('button',{name:'Moon',exact:true}).click();assert.equal(await page.locator('.sf-effect-pane:visible').count(),1);assert.equal(await page.getByRole('tabpanel',{name:'Moon',exact:true}).isVisible(),true);
  const moonTab=page.getByRole('tab',{name:'Moon',exact:true});await moonTab.focus();await moonTab.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'Aurora',exact:true}).getAttribute('aria-selected'),'true');await page.getByRole('tab',{name:'Aurora',exact:true}).press('ArrowLeft');
  const size=page.getByLabel('Moon Angular diameter °',{exact:true});await size.fill('2');await size.press('Tab');const history=await page.evaluate(()=>SkyForgeCore.store.history.length);
  await page.getByRole('button',{name:'Real size · 0.52°',exact:true}).click();assert.equal(await read('moon.angularDiameter'),.52);assert.equal(await page.evaluate(()=>SkyForgeCore.store.history.length),history+1);
  await command('Edit','undo');assert.equal(await read('moon.angularDiameter'),2);await command('Edit','redo');assert.equal(await read('moon.angularDiameter'),.52);
  stage('Moon angular size in real pixels, telephoto framing and one Undo');
  await page.evaluate(()=>{const c=SkyForgeCore;c.store.batch('Moon measurement',s=>{s.sun.elevation=-18;s.camera.fov=60;s.camera.exposure=1;s.viewport.grid=false;s.viewport.overlays=false;s.viewport.referenceSphere=false;s.scene.referenceObjects={};s.clouds.coverage=0;s.stars.enabled=false;s.aurora.enabled=false;s.rainbow.enabled=false;Object.assign(s.moon,{enabled:true,azimuth:0,elevation:35,angularDiameter:.52,phase:.5,brightness:1,earthshine:0});});c.workspace.effects.frame('moon');});
  const wide=await frame('moon-natural-scale');await page.evaluate(()=>SkyForgeCore.store.set('moon.phase',0));const newMoon=await frame();
  const measure=(a,b)=>{let min=a.w,max=-1,n=0;for(let y=0;y<a.h;y++)for(let x=0;x<a.w;x++){const i=(y*a.w+x)*4;if(Math.abs(a.pixels[i]-b.pixels[i])+Math.abs(a.pixels[i+1]-b.pixels[i+1])+Math.abs(a.pixels[i+2]-b.pixels[i+2])>24){min=Math.min(min,x);max=Math.max(max,x);n++;}}return{width:max<0?0:max-min+1,pixels:n};};
  const wideSize=measure(wide,newMoon),expected=wide.h*Math.tan(.52*Math.PI/360)/Math.tan(Math.PI/6);assert.ok(Math.abs(wideSize.width-expected)<3);assert.ok(wideSize.pixels>5);
  await page.evaluate(()=>SkyForgeCore.store.set('moon.phase',.5));const beforeCamera=await read('viewport.camera');const beforeFov=await read('camera.fov');
  await page.getByRole('button',{name:'Telephoto view',exact:true}).click();assert.equal(await read('camera.fov'),20);assert.equal(await read('moon.angularDiameter'),.52);
  const tele=await frame('moon-telephoto');await page.evaluate(()=>SkyForgeCore.store.set('moon.phase',0,{record:false}));const noTeleMoon=await frame();const teleSize=measure(tele,noTeleMoon);assert.ok(teleSize.width>wideSize.width*2.5);
  await command('Edit','undo');assert.equal(await read('camera.fov'),beforeFov);assert.deepEqual(await read('viewport.camera'),beforeCamera);results.metrics.moon={wide:wideSize,telephoto:teleSize,expectedWide:expected};
  stage('star points use a compact catalogue, stable seed and display pixel sized cores');
  await page.evaluate(()=>{const c=SkyForgeCore;c.workspace.selectLook('Moonlit night');c.store.batch('Star isolation',s=>{s.clouds.coverage=0;s.moon.enabled=false;s.camera.exposure=3;s.viewport.overlays=false;s.stars.brightness=2;});c.workspace.effects.frame('moon');});
  const stars=await frame('stars');assert.deepEqual(stars.lighting.starCatalogueSize,[512,256]);assert.ok(stars.lighting.starPackedCount>3000);
  await page.evaluate(()=>SkyForgeCore.store.set('stars.enabled',false));const noStars=await frame();const mask=new Uint8Array(stars.w*stars.h);let visible=0;
  for(let i=0;i<mask.length;i++){const j=i*4;if(stars.pixels[j]+stars.pixels[j+1]+stars.pixels[j+2]-noStars.pixels[j]-noStars.pixels[j+1]-noStars.pixels[j+2]>36){mask[i]=1;visible++;}}
  let largest=0,components=0;for(let i=0;i<mask.length;i++)if(mask[i]){const stack=[i];mask[i]=0;let area=0;while(stack.length){const k=stack.pop();area++;const x=k%stars.w;for(const n of [x>0?k-1:-1,x<stars.w-1?k+1:-1,k-stars.w,k+stars.w])if(n>=0&&n<mask.length&&mask[n]){mask[n]=0;stack.push(n);}}largest=Math.max(largest,area);components++;}
  assert.ok(components>20);assert.ok(largest<30,`stars must remain points, largest component ${largest}`);results.metrics.stars={visible,components,largest};
  await page.evaluate(()=>SkyForgeCore.store.set('stars.enabled',true));const stable=await frame();assert.deepEqual(stars.pixels,stable.pixels);
  stage('aurora finite emission volume changes with depth, timeline and intensity');
  await page.getByRole('button',{name:'Sky looks',exact:true}).click();await page.locator('[data-scene-look="Aurora night"]').click();await page.getByRole('button',{name:'Aurora',exact:true}).click();
  await page.evaluate(()=>SkyForgeCore.store.batch('Aurora measurement',s=>{s.clouds.coverage=0;s.stars.enabled=false;s.viewport.overlays=false;}));const aurora=await frame('aurora-volume');
  await page.evaluate(()=>SkyForgeCore.store.set('aurora.enabled',false));const noAurora=await frame();const auroraChange=delta(aurora.pixels,noAurora.pixels);assert.ok(auroraChange.changed>300);
  await page.evaluate(()=>SkyForgeCore.store.batch('Animate aurora',s=>{s.aurora.enabled=true;s.timeline.currentFrame=180;}));const animated=await frame('aurora-animated');assert.ok(delta(aurora.pixels,animated.pixels).changed>100);
  await page.getByLabel('Aurora Curtain thickness km',{exact:true}).fill('18');await page.getByLabel('Aurora Curtain thickness km',{exact:true}).press('Tab');const thicker=await frame();assert.ok(delta(animated.pixels,thicker.pixels).changed>100);results.metrics.aurora=auroraChange;
  stage('spectral bows, rain shaft variation and Alexander band in actual RGB pixels');
  await page.getByRole('button',{name:'Sky looks',exact:true}).click();await page.locator('[data-scene-look="Sunshower"]').click();await page.getByRole('button',{name:'Rainbow',exact:true}).click();
  await page.evaluate(()=>SkyForgeCore.store.batch('Rainbow isolation',s=>{s.clouds.coverage=0;s.viewport.overlays=false;s.viewport.grid=false;s.rainbow.rainAmount=.8;}));const bow=await frame('spectral-rainbow');
  await page.evaluate(()=>SkyForgeCore.store.set('rainbow.enabled',false));const clear=await frame();assert.ok(delta(bow.pixels,clear.pixels).changed>100);
  const bands=await page.evaluate(({a,b,w,h})=>{const c=SkyForgeCore,v=c.viewport,cam=v.getCamera(),fov=c.store.get('camera.fov'),el=c.store.get('sun.elevation')*Math.PI/180;let band=0,inner=0,nb=0,ni=0;for(let y=0;y<h;y++)for(let x=Math.floor(w/2)-2;x<=Math.floor(w/2)+2;x++){const angle=Math.abs(Math.atan((2*(y+.5)/h-1)*Math.tan(fov*Math.PI/360))-cam.pitch+el)*180/Math.PI;const j=(y*w+x)*4,d=Math.abs(a[j]-b[j])+Math.abs(a[j+1]-b[j+1])+Math.abs(a[j+2]-b[j+2]);if(angle>46&&angle<48){band+=d;nb++;}if(angle>35&&angle<38){inner+=d;ni++;}}return{band:band/Math.max(1,nb),inside:inner/Math.max(1,ni),nb,ni};},{a:bow.pixels,b:clear.pixels,w:bow.w,h:bow.h});
  assert.ok(bands.nb>10&&bands.ni>10);assert.ok(bands.band<2);assert.ok(bands.inside>2);results.metrics.rainbow=bands;
  await page.evaluate(()=>SkyForgeCore.store.batch('Dry rainbow',s=>{s.rainbow.enabled=true;s.rainbow.rainAmount=0;}));assert.deepEqual((await frame()).pixels,clear.pixels);
  stage('idle rendering, diagnostics and disposal preserve the existing core');
  const idle=await page.evaluate(()=>SkyForgeCore.viewport.renderer.frames);await page.waitForTimeout(1800);assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.renderer.frames),idle);assert.deepEqual(errors,[]);
  const disposed=await page.evaluate(()=>{const c=SkyForgeCore,r=c.viewport.renderer,g=r.gl,t=r.starTexture;c.dispose();return{star:g.isTexture(t),panels:document.querySelectorAll('#sec-sf-effects,#sf-studio-menus').length,error:g.getError()};});assert.equal(disposed.star,false);assert.equal(disposed.panels,0);assert.equal(disposed.error,0);
  fs.writeFileSync(path.join(output,'celestial-realism-results.json'),JSON.stringify(results,null,2));console.log('PASS: celestial realism, angular Moon size and consolidated UI');
 }catch(error){results.failure=error.stack||String(error);results.errors=errors;fs.writeFileSync(path.join(output,'celestial-realism-results.json'),JSON.stringify(results,null,2));await page.screenshot({path:path.join(output,'r16-failure.png')}).catch(()=>{});throw error;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
