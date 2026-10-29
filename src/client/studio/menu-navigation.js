// Independent geometry and keyboard policy; no project state or renderer ownership.
export function menuPlacement(anchor,popup,viewport){
 const gap=8,width=Math.max(17,viewport.width),height=Math.max(17,viewport.height);
 const maxWidth=width-gap*2,popupWidth=Math.min(popup.width,maxWidth);
 const left=Math.max(gap,Math.min(anchor.left,width-popupWidth-gap));
 const top=Math.max(gap,Math.min(anchor.bottom+4,height-gap-Math.min(80,popup.height)));
 return {left,top,maxWidth,maxHeight:Math.max(1,height-top-gap)};
}

export function menuIndex(current,key,length){
 if(length<=0)return -1;
 if(key==='Home')return 0;
 if(key==='End')return length-1;
 const delta={ArrowDown:1,ArrowRight:1,ArrowUp:-1,ArrowLeft:-1}[key];
 if(!delta)return -1;
 return current<0?(delta>0?0:length-1):(current+delta+length)%length;
}
