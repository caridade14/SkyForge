import { cloneValue, DEFAULT_CELESTIAL } from '../core/state-store.js';
import { frameSky } from '../viewport/camera.js';

export const STUDIO_VERSION='Studio R16';
export const SCENE_LOOKS=Object.freeze({
 'Cumulus daylight':{sun:{elevation:35,azimuth:215,intensity:1.6,temperature:5778},clouds:{type:'Cumulus',coverage:.66,density:.68,altitude:1800,thickness:1400,erosion:.28,detail:.8,seed:3301},azimuth:180,elevation:12},
 'Warm sunset':{sun:{elevation:3.5,azimuth:255,intensity:1.8,temperature:5778},clouds:{type:'Cumulus',coverage:.6,density:.65,altitude:1600,thickness:1600,erosion:.34,detail:.85,seed:731},azimuth:245,elevation:10},
 'Storm front':{sun:{elevation:25,azimuth:215,intensity:1.3,temperature:5778},clouds:{type:'Cumulonimbus',coverage:.87,density:.88,altitude:900,thickness:4000,erosion:.3,detail:.75,seed:481},azimuth:145,elevation:15},
 'Moonlit night':{sun:{elevation:-18,azimuth:215,intensity:1.8,temperature:5778},clouds:{type:'Cumulus',coverage:.2,density:.5,altitude:2000,thickness:1200,erosion:.45,detail:.75},stars:{enabled:true},moon:{enabled:true,azimuth:315,elevation:32,phase:.5},azimuth:315,elevation:32,exposure:3},
 'Aurora night':{sun:{elevation:-18,azimuth:215,intensity:1.8,temperature:5778},clouds:{type:'Cumulus',coverage:.12,density:.4,altitude:2000,thickness:1200,erosion:.5,detail:.7},stars:{enabled:true},aurora:{enabled:true,intensity:.85,azimuth:0,width:6,height:210,curtains:2},azimuth:0,elevation:28,exposure:3},
 'Sunshower':{sun:{elevation:12,azimuth:210,intensity:1.8,temperature:5778},clouds:{type:'Cumulus',coverage:.3,density:.6,altitude:1800,thickness:1200,erosion:.5,detail:.8},rainbow:{enabled:true,rainAmount:.6},azimuth:30,elevation:20,fov:70}
});

// Apply a deliberately selected look in one transaction. Keep reference objects,
// graph documents, timeline tracks and all unrelated fields intact.
export function applySceneLook(draft,name){
 const look=SCENE_LOOKS[name];if(!look)throw new Error('Unknown sky look: '+name);
 Object.assign(draft.sun,look.sun);Object.assign(draft.clouds,{scale:1200},look.clouds);
 Object.assign(draft.atmosphere,{rayleigh:2.8,turbidity:2.8,haze:.14,ozone:1,mieCoefficient:.006,mieDirectionalG:.8});
 for(const root of Object.keys(DEFAULT_CELESTIAL))draft[root]={...draft[root],...cloneValue(DEFAULT_CELESTIAL[root]),...look[root]};
 draft.camera.exposure=look.exposure||1;draft.camera.fov=look.fov||60;
 Object.assign(draft.color,{exposure:0,contrast:1,saturation:1});
 Object.assign(draft.viewport,{mode:'webgl',skySource:'integrated',cloudMode:'volumetric'});
 draft.viewport.camera=frameSky({target:[0,0,1.2],distance:14},look.azimuth,look.elevation);
 draft.scene.authority='direct';
}

export function graphicsReport(api){
 const vp=api.viewport,g=vp?.renderer?.gl;
 let gpu=null;
 if(g&&!g.isContextLost()){
  const info=g.getExtension('WEBGL_debug_renderer_info');
  gpu={version:g.getParameter(g.VERSION),renderer:g.getParameter(info?.UNMASKED_RENDERER_WEBGL||g.RENDERER),vendor:g.getParameter(info?.UNMASKED_VENDOR_WEBGL||g.VENDOR),textureUnits:g.getParameter(g.MAX_TEXTURE_IMAGE_UNITS),maxTextureSize:g.getParameter(g.MAX_TEXTURE_SIZE)};
 }
 return {version:STUDIO_VERSION,time:new Date().toISOString(),renderer:vp?.active?'WebGL':'Legacy',requestedRenderer:api.store.get('viewport.mode'),contextLost:Boolean(vp?.lost),error:vp?.error||null,gpu,clouds:vp?.renderer?.cloudMetrics||null,lighting:vp?.renderer?.lightingMetrics||null,camera:cloneValue(api.store.get('viewport.camera')),viewport:cloneValue(api.store.get('viewport')),projectSchema:api.store.get('schemaVersion')};
}
