import { DEFAULT_CELESTIAL } from './state-store.js';
export { DEFAULT_CELESTIAL } from './state-store.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,d)=>Number.isFinite(Number(v))?Number(v):d;
export function normalizeCelestial(state={}) {
  const number=(root,key,min,max)=>clamp(finite(state[root]?.[key],DEFAULT_CELESTIAL[root][key]),min,max);
  return {
    stars:{enabled:state.stars?.enabled===true,count:Math.round(number('stars','count',0,12000)),brightness:number('stars','brightness',0,8),rotation:number('stars','rotation',-360,360),seed:Math.round(number('stars','seed',0,2147483647))},
    moon:{enabled:state.moon?.enabled===true,azimuth:number('moon','azimuth',0,360),elevation:number('moon','elevation',-90,90),angularDiameter:number('moon','angularDiameter',.1,5),phase:number('moon','phase',0,1),brightness:number('moon','brightness',0,8),earthshine:number('moon','earthshine',0,.1)},
    aurora:{enabled:state.aurora?.enabled===true,intensity:number('aurora','intensity',0,8),azimuth:number('aurora','azimuth',0,360),altitude:number('aurora','altitude',80,200),height:number('aurora','height',20,400),width:number('aurora','width',1,50),curtains:Math.round(number('aurora','curtains',1,3)),speed:number('aurora','speed',0,2)},
    rainbow:{enabled:state.rainbow?.enabled===true,intensity:number('rainbow','intensity',0,8),rainAmount:number('rainbow','rainAmount',0,1),width:number('rainbow','width',.1,2),secondary:state.rainbow?.secondary!==false}
  };
}
