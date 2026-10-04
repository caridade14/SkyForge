// A small, seamless 3-D Perlin/Worley field stored as a WebGL 1 slice atlas.
// Generated once per seed; trilinear GPU sampling needs only two texture reads.
const SIZE=32, TILE=SIZE+2, COLS=8, ROWS=4;
const mod=(v,n)=>(v%n+n)%n;
const mix=(a,b,t)=>a+(b-a)*t;
const fade=t=>t*t*t*(t*(t*6-15)+10);
const fract=v=>v-Math.floor(v);
function hash(x,y,z,seed) {
  let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2147483647)^(seed|0);
  h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;
}
function perlin(x,y,z,period,seed) {
  const p=[x,y,z].map(v=>v*period), i=p.map(Math.floor), f=p.map(v=>fract(v)), u=f.map(fade);
  const corner=(a,b,c)=>{
    const h=Math.floor(hash(mod(i[0]+a,period),mod(i[1]+b,period),mod(i[2]+c,period),seed)*16);
    const dx=f[0]-a,dy=f[1]-b,dz=f[2]-c;
    const first=h<8?dx:dy,second=h<4?dy:(h===12||h===14?dx:dz);
    return ((h&1)?-first:first)+((h&2)?-second:second);
  };
  return .5+.5*mix(mix(mix(corner(0,0,0),corner(1,0,0),u[0]),mix(corner(0,1,0),corner(1,1,0),u[0]),u[1]),mix(mix(corner(0,0,1),corner(1,0,1),u[0]),mix(corner(0,1,1),corner(1,1,1),u[0]),u[1]),u[2]);
}
function features(period,seed) {
  const data=new Float32Array(period**3*3);
  for(let z=0;z<period;z++)for(let y=0;y<period;y++)for(let x=0;x<period;x++) {
    const i=((z*period+y)*period+x)*3;
    data.set([hash(x,y,z,seed),hash(x,y,z,seed+179),hash(x,y,z,seed+659)],i);
  }
  return data;
}
function worley(x,y,z,period,points) {
  const p=[x,y,z].map(v=>v*period),base=p.map(Math.floor);let distance=3;
  for(let c=-1;c<=1;c++)for(let b=-1;b<=1;b++)for(let a=-1;a<=1;a++) {
    const cell=[base[0]+a,base[1]+b,base[2]+c],i=((mod(cell[2],period)*period+mod(cell[1],period))*period+mod(cell[0],period))*3;
    const dx=cell[0]+points[i]-p[0],dy=cell[1]+points[i+1]-p[1],dz=cell[2]+points[i+2]-p[2];
    distance=Math.min(distance,dx*dx+dy*dy+dz*dz);
  }
  return 1-Math.min(1,Math.sqrt(distance));
}
export function makeCloudNoise(seed=3301) {
  seed=Number.isFinite(Number(seed))?Math.trunc(Number(seed))|0:3301;
  const shape=features(4,seed),detail=features(12,seed+193),volume=new Uint8Array(SIZE**3*4);
  for(let z=0;z<SIZE;z++)for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++) {
    const p=[x/SIZE,y/SIZE,z/SIZE],base=.57*perlin(...p,4,seed)+.28*perlin(...p,8,seed)+.15*perlin(...p,16,seed);
    const w=worley(...p,4,shape),fine=worley(...p,12,detail),i=((z*SIZE+y)*SIZE+x)*4;
    volume.set([Math.round(Math.max(0,Math.min(1,base*.75+w*.25))*255),Math.round(w*255),Math.round(fine*255),255],i);
  }
  const width=COLS*TILE,height=ROWS*TILE,data=new Uint8Array(width*height*4);
  for(let z=0;z<SIZE;z++)for(let y=-1;y<=SIZE;y++)for(let x=-1;x<=SIZE;x++) {
    const source=((z*SIZE+mod(y,SIZE))*SIZE+mod(x,SIZE))*4;
    const target=(((Math.floor(z/COLS)*TILE+y+1)*width)+(z%COLS)*TILE+x+1)*4;
    data.set(volume.subarray(source,source+4),target);
  }
  return {width,height,data,size:SIZE,seed};
}
export const CLOUD_NOISE_GLSL=`
uniform sampler2D uCloudNoise;uniform float uHasCloudNoise;
vec3 noiseSlice(vec2 xy,float z){
 vec2 tile=vec2(mod(z,8.0),floor(z/8.0));
 return texture2D(uCloudNoise,(tile*34.0+vec2(1.5)+xy)/vec2(272.0,136.0)).rgb;
}
vec3 cloudShape(vec3 point){
 vec3 p=fract(point/8.0)*32.0;float z=floor(p.z);
 return mix(noiseSlice(p.xy,z),noiseSlice(p.xy,mod(z+1.0,32.0)),fract(p.z));
}
`;
