// Real WebGL regression gate: pixels, visible controls and actual Core services.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=process.env.SKYFORGE_TEST_OUTPUT||'/tmp/skyforge-celestial';fs.mkdirSync(out,{recursive:true});
const base=process.env.SKYFORGE_TEST_URL||'http://127.0.0.1:3000';
(async()=>{
  const launch={headless:true};if(process.env.PLAYWRIGHT_EXECUTABLE_PATH)launch.executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if(process.env.PLAYWRIGHT_CHANNEL)launch.channel=process.env.PLAYWRIGHT_CHANNEL;
  if(process.env.SKYFORGE_WEBGL_BACKEND!=='native')launch.args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'];
  const browser=await chromium.launch(launch),context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();
  page.setDefaultTimeout(30000);
  const errors=[],requests=[],results={backend:process.env.SKYFORGE_WEBGL_BACKEND||'swiftshader',checks:[],metrics:{}};
  page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('console',m=>{if(m.type()==='error')errors.push(`${m.text()} ${m.location().url}`);});
  page.on('request',r=>{if(r.url().includes('/api/lighting/preview'))requests.push(r.url());});
  const stage=name=>{console.log(`Celestial: ${name}`);results.checks.push(name);};
  const read=key=>page.evaluate(key=>SkyForgeCore.store.get(key),key);
  const set=(key,value)=>page.evaluate(([key,value])=>SkyForgeCore.store.set(key,value),[key,value]);
  const frame=async(name)=>{
    const result=await page.evaluate(()=>new Promise((resolve,reject)=>{
      const vp=SkyForgeCore.viewport,timer=setTimeout(()=>reject(new Error('Celestial GPU readback timed out')),45000);
      vp.invalidate();requestAnimationFrame(()=>{
        try{
          const g=vp.renderer.gl,w=vp.canvas.width,h=vp.canvas.height,data=new Uint8Array(w*h*4);g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,data);
          const pixels=[];for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){const i=(y*w+x)*4;pixels.push(data[i],data[i+1],data[i+2]);}
          clearTimeout(timer);resolve({pixels,w,h,error:g.getError(),lighting:vp.renderer.lightingMetrics,clouds:vp.renderer.cloudMetrics});
        }catch(e){clearTimeout(timer);reject(e);}
      });
    }));
    assert.equal(result.error,0);assert.equal(result.clouds.mode,'volumetric');assert.ok(result.clouds.pixels<=({low:250000,medium:500000,high:900000}[result.clouds.quality]));assert.ok(result.w*result.h<=2000000);
    if(name)await page.screenshot({path:path.join(out,`celestial-${name}.png`)});return result;
  };
  const diff=(a,b)=>{assert.equal(a.length,b.length);let sum=0,changed=0,max=0;for(let i=0;i<a.length;i+=3){const delta=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);sum+=delta/3;max=Math.max(max,delta/3);if(delta>18)changed++;}return{mean:sum/(a.length/3),changed,max};};
  const peak=p=>{let max=0;for(let i=0;i<p.length;i+=3)max=Math.max(max,p[i]*.2126+p[i+1]*.7152+p[i+2]*.0722);return max;};
  const green=p=>{let n=0;for(let i=0;i<p.length;i+=3)if(p[i+1]>p[i]+20&&p[i+1]>p[i+2]+15)n++;return n;};
  const luminance=p=>{let s=0;for(let i=0;i<p.length;i+=3)s+=p[i]*.2126+p[i+1]*.7152+p[i+2]*.0722;return s/(p.length/3);};
  try{
    await page.goto(base,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForFunction(()=>globalThis.SkyForgeCore?.workspace?.effects&&SkyForgeCore.viewport?.renderer?.frames>0);
    stage('visible rail and startup atmosphere cache; Low volume remains bounded');
    assert.equal(await page.getByRole('toolbar',{name:'Viewport tools',exact:true}).isVisible(),true);
    for(const tool of ['select','move','rotate','scale','orbit','pan','dolly'])assert.equal(await page.getByRole('button',{name:`Viewport ${tool}`,exact:true}).isVisible(),true);
    const railHit=await page.getByRole('button',{name:'Viewport select',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});assert.equal(railHit,true,'toolbar cannot cover Select');
    const initial=await frame('startup');assert.equal(initial.lighting.skySource,'integrated atmosphere');assert.equal(initial.clouds.samples,16);
    await page.evaluate(()=>SkyForgeCore.store.batch('Celestial pixel fixture',draft=>{draft.viewport.grid=false;draft.viewport.referenceSphere=false;draft.clouds.coverage=0;draft.sun.elevation=60;draft.sun.temperature=5778;draft.viewport.camera.yaw=0;draft.viewport.camera.pitch=-.55;}));
    const noon=await frame('noon'),builds=noon.lighting.atmosphereBuilds;
    await set('viewport.camera',{...await read('viewport.camera'),yaw:.4});const cameraOnly=await frame();assert.equal(cameraOnly.lighting.atmosphereBuilds,builds,'camera does not recalculate atmosphere');
    await page.evaluate(()=>SkyForgeCore.store.batch('Sunset fixture',draft=>{draft.sun.elevation=2;draft.viewport.camera.yaw=-draft.sun.azimuth*Math.PI/180;draft.viewport.camera.pitch=-.12;}));
    const sunset=await frame('sunset');assert.ok(luminance(noon.pixels)>luminance(sunset.pixels));
    stage('Perlin/Worley cloud shapes compile at each real GPU budget and seed changes the volume');
    await page.evaluate(()=>SkyForgeCore.store.batch('Cloud beauty fixture',draft=>{draft.sun.elevation=45;draft.sun.temperature=5778;draft.viewport.camera.yaw=-2.6;draft.viewport.camera.pitch=-.25;Object.assign(draft.clouds,{coverage:.62,density:.7,thickness:1600,type:'Cumulus',erosion:.35,detail:.8});}));
    const clouds=await frame('cumulus');await set('clouds.seed',3302);const reseed=await frame();assert.ok(diff(clouds.pixels,reseed.pixels).changed>100,'seed alters actual 3D clouds');
    for(const quality of ['medium','high','low']){await set('viewport.cloudQuality',quality);const f=await frame(quality==='high'?'clouds-high':null);assert.equal(f.clouds.samples,{low:16,medium:28,high:44}[quality]);assert.equal(f.lighting.reflectionProbe,true);}
    stage('Stars appear in the actual night framebuffer, rotate in world space and remain hidden by daylight');
    await page.getByRole('button',{name:'Stars',exact:true}).click();assert.equal(await read('stars.enabled'),true);assert.equal(await page.locator('#sec-sf-effects').isVisible(),true);
    await page.evaluate(()=>SkyForgeCore.store.batch('Night stars fixture',draft=>{draft.sun.elevation=-18;draft.clouds.coverage=0;draft.camera.exposure=4;draft.viewport.camera.yaw=0;draft.viewport.camera.pitch=-.65;draft.stars.brightness=3;}));
    const stars=await frame('stars');await set('stars.enabled',false);const dark=await frame();results.metrics.stars=diff(stars.pixels,dark.pixels);assert.ok(results.metrics.stars.changed>50);
    await set('stars.enabled',true);await set('stars.rotation',35);const rotated=await frame();assert.ok(diff(stars.pixels,rotated.pixels).changed>50);assert.equal(rotated.lighting.opticalBuilds,stars.lighting.opticalBuilds);
    await set('sun.elevation',50);const starDay=await frame();await set('stars.enabled',false);const noStarsDay=await frame();assert.deepEqual(starDay.pixels,noStarsDay.pixels,'daylight fades procedural stars entirely');
    stage('Moon disc, illuminated phase and cloud occlusion affect real pixels');
    await page.getByRole('button',{name:'Moon',exact:true}).click();
    await page.evaluate(()=>SkyForgeCore.store.batch('Moon phase fixture',draft=>{draft.sun.elevation=-18;draft.camera.exposure=2;draft.camera.fov=20;draft.moon.phase=.5;draft.moon.azimuth=0;draft.moon.elevation=35;draft.clouds.coverage=0;}));
    await page.getByRole('button',{name:'Frame Moon',exact:true}).click();const fullMoon=await frame('moon-full');
    await set('moon.phase',0);const newMoon=await frame('moon-new');results.metrics.phase=diff(fullMoon.pixels,newMoon.pixels);assert.ok(results.metrics.phase.changed>3);assert.ok(results.metrics.phase.max>30);
    await set('moon.phase',.25);const halfMoon=await frame('moon-quarter');assert.ok(luminance(fullMoon.pixels)>luminance(halfMoon.pixels));
    await set('moon.phase',.5);await page.evaluate(()=>SkyForgeCore.store.batch('Occluding cloud fixture',draft=>Object.assign(draft.clouds,{type:'Stratus',coverage:1,density:1,erosion:0,thickness:2000})));
    const occluded=await frame('moon-clouds');results.metrics.moonOcclusion={full:peak(fullMoon.pixels),covered:peak(occluded.pixels)};assert.ok(peak(occluded.pixels)<peak(fullMoon.pixels)*.65,'foreground volume attenuates Moon instead of drawing it over clouds');
    stage('Aurora emission is visible, animated by the timeline and gated by daylight');
    await page.getByRole('button',{name:'Aurora',exact:true}).click();await page.getByRole('button',{name:'Aurora night',exact:true}).click();
    await page.evaluate(()=>SkyForgeCore.store.batch('Aurora fixture',draft=>{draft.camera.fov=70;draft.clouds.coverage=0;draft.moon.enabled=false;draft.stars.enabled=false;draft.camera.exposure=2;}));
    const aurora=await frame('aurora');results.metrics.auroraGreen=green(aurora.pixels);assert.ok(results.metrics.auroraGreen>100,'green emission must form visible curtains');
    await set('aurora.enabled',false);const noAurora=await frame();results.metrics.aurora=diff(aurora.pixels,noAurora.pixels);assert.ok(results.metrics.aurora.changed>100);
    await set('aurora.enabled',true);await page.evaluate(()=>SkyForgeCore.timeline.seek(150));const animatedAurora=await frame('aurora-animated');assert.ok(diff(aurora.pixels,animatedAurora.pixels).changed>50);
    await set('sun.elevation',50);const auroraDay=await frame();await set('aurora.enabled',false);const noAuroraDay=await frame();assert.deepEqual(auroraDay.pixels,noAuroraDay.pixels);
    stage('Primary and secondary rainbow follow the antisolar direction and rain amount');
    await page.getByRole('button',{name:'Rainbow',exact:true}).click();await page.getByRole('button',{name:'Sunshower',exact:true}).click();await set('clouds.coverage',0);await set('camera.fov',75);
    const rainbow=await frame('rainbow');await set('rainbow.enabled',false);const noRainbow=await frame();results.metrics.rainbow=diff(rainbow.pixels,noRainbow.pixels);assert.ok(results.metrics.rainbow.changed>50);assert.ok(results.metrics.rainbow.max>5);
    await set('rainbow.enabled',true);await set('rainbow.rainAmount',0);const dry=await frame();assert.deepEqual(dry.pixels,noRainbow.pixels,'no rain gives no rainbow');
    await set('rainbow.rainAmount',.8);await set('rainbow.secondary',false);const primary=await frame();await set('rainbow.secondary',true);const doubleBow=await frame('double-rainbow');assert.ok(diff(primary.pixels,doubleBow.pixels).changed>10,'secondary bow is rendered');
    await page.evaluate(()=>SkyForgeCore.viewport.commit({...SkyForgeCore.viewport.getCamera(),yaw:-SkyForgeCore.store.get('sun.azimuth')*Math.PI/180,pitch:-.3},'Face Sun'));
    const towardSun=await frame();await set('rainbow.enabled',false);const towardSunNoBow=await frame();assert.deepEqual(towardSun.pixels,towardSunNoBow.pixels,'rainbow never appears in the Sun-facing cone');
    stage('Celestial numeric gestures cancel and commit once; no forced physical requests');
    await page.waitForTimeout(1500);const requestStart=requests.length,phaseControl=page.getByLabel('Moon Phase cycle',{exact:true});const history=await page.evaluate(()=>SkyForgeCore.store.history.length);
    const oldPhase=await read('moon.phase');await phaseControl.focus();await phaseControl.fill('.3');await phaseControl.press('Escape');assert.equal(await read('moon.phase'),oldPhase);assert.equal(await page.evaluate(()=>SkyForgeCore.store.history.length),history);
    await phaseControl.focus();await phaseControl.fill('.2');await phaseControl.press('Tab');assert.equal(await read('moon.phase'),.2);assert.equal(await page.evaluate(()=>SkyForgeCore.store.history.length),history+1);
    await page.evaluate(()=>SkyForgeCore.store.undo());assert.equal(await read('moon.phase'),oldPhase);
    stage('Rail tools own left-drag navigation, keep selection and support one Undo');
    await page.getByRole('button',{name:'Viewport pan',exact:true}).click();const before=await read('viewport.camera'),sunBefore=await read('sun');
    const h=await page.evaluate(()=>SkyForgeCore.store.history.length),box=await page.locator('.sf-3d-canvas').boundingBox();
    await page.mouse.move(box.x+box.width*.55,box.y+box.height*.65);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.7,{steps:5});await page.mouse.up();
    assert.notDeepEqual((await read('viewport.camera')).target,before.target);assert.deepEqual(await read('sun'),sunBefore);assert.equal(await page.evaluate(()=>SkyForgeCore.store.history.length),h+1);
    await page.getByRole('button',{name:'Viewport undo',exact:true}).click();assert.deepEqual(await read('viewport.camera'),before);
    await page.getByRole('button',{name:'Viewport select',exact:true}).click();assert.equal(await read('viewport.navigationTool'),'select');
    await page.waitForTimeout(700);assert.equal(requests.length,requestStart,'celestial edits and navigation never request physical LUTs');
    stage('Project and autosave retain celestial layers; disposal releases all added textures');
    const saved=await page.evaluate(()=>{
      const s=SkyForgeCore.store;s.set('moon.enabled',true);s.set('stars.enabled',true);s.set('aurora.enabled',true);s.set('rainbow.enabled',true);
      const doc=SkyForgeCore.projects.createDocument();s.set('moon.phase',.8);SkyForgeCore.projects.loadDocument(doc);s.persist();
      return{payload:doc.payload,restored:s.snapshot(),hasSavedEffects:localStorage.getItem('skyforge.core.v11.autosave')};
    });
    for(const root of ['moon','stars','aurora','rainbow']){assert.deepEqual(saved.restored[root],saved.payload[root]);assert.deepEqual(JSON.parse(saved.hasSavedEffects)[root],saved.payload[root]);}
    await frame();
    const idle=await page.evaluate(()=>SkyForgeCore.viewport.renderer.frames);await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>SkyForgeCore.viewport.renderer.frames),idle,'preview does not loop at idle');
    results.metrics.frames=idle;results.metrics.physicalRequests=requests.length;results.errors=errors;
    const realErrors=errors.filter(e=>!e.includes('https://fonts.googleapis.com/')&&!/http:\/\/127\.0\.0\.1:3000\/assets\/(startup-skyforge-splash\.png|earth-blue-marble\.jpg|world-map-reference\.png|world-map-reference-significados\.jpg|world-map-reference\.jpg)/.test(e));assert.deepEqual(realErrors,[]);
    const disposed=await page.evaluate(()=>{const r=SkyForgeCore.viewport.renderer,gl=r.gl,t=[r.integratedTexture,r.noiseTexture,r.starTexture];SkyForgeCore.dispose();return{alive:t.map(x=>gl.isTexture(x)),host:document.querySelector('.sf-3d-host'),effects:document.querySelector('#sec-sf-effects'),error:gl.getError()};});assert.deepEqual(disposed.alive,[false,false,false]);assert.equal(disposed.host,null);assert.equal(disposed.effects,null);assert.equal(disposed.error,0);
    fs.writeFileSync(path.join(out,'celestial-results.json'),JSON.stringify(results,null,2));console.log('PASS: atmosphere, clouds, celestial layers and viewport tools');
  }catch(error){
    results.failure=error.stack||String(error);results.errors=errors;
    fs.writeFileSync(path.join(out,'celestial-results.json'),JSON.stringify(results,null,2));await page.screenshot({path:path.join(out,'celestial-failure.png')}).catch(()=>{});throw error;
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
