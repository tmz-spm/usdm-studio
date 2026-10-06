export const horizontalLanes=d=>d.laneOrientation==='horizontal';
const copy=x=>JSON.parse(JSON.stringify(x));
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export const laneSize=(d,l)=>horizontalLanes(d)?l.height??240:l.width;
export const laneSpan=d=>(d.lanes||[]).reduce((sum,l)=>sum+laneSize(d,l),0);
const axes=d=>horizontalLanes(d)?{cross:'y',flow:'x',crossSize:108,flowSize:200,start:220}:{cross:'x',flow:'y',crossSize:200,flowSize:108,start:110};
export function laneLengthLimits(d){const a=axes(d),ids=new Set((d.lanes||[]).map(l=>l.id));return {min:Math.ceil(Math.max(400,...d.nodes.filter(n=>ids.has(n.laneId)).map(n=>n[a.flow]+a.flowSize+20-40))),max:20000};}
export function laneLength(d){const a=axes(d);return d.laneLength??Math.max(horizontalLanes(d)?960:540,...d.nodes.map(n=>n[a.flow]+a.flowSize+(horizontalLanes(d)?140:100)-40));}
export function laneGeometry(d){let offset=40;const horizontal=horizontalLanes(d),length=laneLength(d);return (d.lanes||[]).map(l=>{const size=laneSize(d,l),result={...l,x:horizontal?40:offset,y:horizontal?offset:40,width:horizontal?length:size,height:horizontal?size:length};offset+=size;return result;});}
export function laneAt(d,x,y=0){return laneGeometry(d).find(l=>horizontalLanes(d)?y>=l.y&&y<l.y+l.height:x>=l.x&&x<l.x+l.width);}
export function growLaneLength(d){if(d.laneLength!==undefined){const {min,max}=laneLengthLimits(d);if(min>max)throw Error('役割区画内に配置する空きがありません。');d.laneLength=Math.max(d.laneLength,min);}}
export function createLane(d,name='新しい役割'){const lane={id:'lane_'+crypto.randomUUID(),name,width:300,...(horizontalLanes(d)?{height:240}:{})};if(laneSpan(d)+laneSize(d,lane)+40>20000)throw Error('役割区画の合計サイズは20000以下にしてください。');(d.lanes??=[]).push(lane);return lane;}
export function containLaneNode(d,n,lane,avoidOverlap=false){
  const a=axes(d),start=lane[a.cross],size=horizontalLanes(d)?lane.height:lane.width;
  n.laneId=lane.id;n[a.cross]=clamp(n[a.cross],start+20,start+size-a.crossSize-20);n[a.flow]=Math.max(a.start,n[a.flow]);
  if(avoidOverlap)while(d.nodes.some(other=>other!==n&&Math.abs(other.x-n.x)<224&&Math.abs(other.y-n.y)<132))n[a.flow]+=a.flowSize+50;
  if(n.x>20000||n.y>20000)throw Error('役割区画内に配置する空きがありません。');
}
export function assignLane(d,ids,laneId){
  const lane=laneGeometry(d).find(l=>l.id===laneId);if(laneId&&!lane)throw Error('役割の区画がありません。');const a=axes(d);
  for(const n of d.nodes.filter(n=>ids.includes(n.id))){
    if(!lane){delete n.laneId;continue;}
    n.laneId=lane.id;n[a.cross]=Math.round(lane[a.cross]+((horizontalLanes(d)?lane.height:lane.width)-a.crossSize)/2);n[a.flow]=Math.max(a.start,n[a.flow]);
    while(d.nodes.some(other=>other!==n&&other.laneId===lane.id&&Math.abs(other[a.flow]-n[a.flow])<a.flowSize+30)){n[a.flow]+=a.flowSize+50;if(n[a.flow]>20000)throw Error('役割区画内に配置する空きがありません。');}
  }growLaneLength(d);
}
export function laneSizeLimits(d,id){const lane=d.lanes?.find(l=>l.id===id);if(!lane)throw Error('役割の区画がありません。');const a=axes(d),positions=d.nodes.filter(n=>n.laneId===id).map(n=>n[a.cross]),spread=positions.length?Math.max(...positions)-Math.min(...positions):0;return {min:Math.ceil(Math.max(horizontalLanes(d)?180:260,spread+a.crossSize+40)),max:Math.floor(Math.min(2000,20000-40-laneSpan(d)+laneSize(d,lane)))};}
export function resizeLane(d,id,size){
  const lane=d.lanes?.find(l=>l.id===id),limits=laneSizeLimits(d,id);if(!Number.isFinite(size)||size<limits.min||size>limits.max)throw Error(`区画の${horizontalLanes(d)?'高さ':'幅'}は${limits.min}〜${limits.max}にしてください。`);
  const a=axes(d),before=new Map(laneGeometry(d).map(l=>[l.id,l[a.cross]]));lane[horizontalLanes(d)?'height':'width']=Math.round(size);
  for(const l of laneGeometry(d)){const members=d.nodes.filter(n=>n.laneId===l.id);if(!members.length)continue;const delta=l[a.cross]-before.get(l.id),min=Math.min(...members.map(n=>n[a.cross]+delta)),max=Math.max(...members.map(n=>n[a.cross]+delta)),end=l[a.cross]+(horizontalLanes(d)?l.height:l.width)-a.crossSize-20,shift=min<l[a.cross]+20?l[a.cross]+20-min:max>end?end-max:0;for(const n of members)n[a.cross]+=delta+shift;}
}
export function resizeLaneLength(d,length){const {min,max}=laneLengthLimits(d);if(!Number.isFinite(length)||length<min||length>max)throw Error(`区画の長さは${min}〜${max}にしてください。`);d.laneLength=Math.round(length);}
export function setLaneOrientation(d,orientation){
  if(!['vertical','horizontal'].includes(orientation))throw Error('役割区画の向きが不正です。');if((d.laneOrientation||'vertical')===orientation)return;
  const before=new Map(laneGeometry(d).map(l=>[l.id,l])),old=axes(d),oldLength=d.laneLength;d.laneOrientation=orientation;const next=axes(d),after=new Map(laneGeometry(d).map(l=>[l.id,l]));
  for(const n of d.nodes){if(!n.laneId)continue;const a=before.get(n.laneId),b=after.get(n.laneId),oldSpan=(old.cross==='x'?a.width:a.height)-old.crossSize-40,newSpan=(next.cross==='x'?b.width:b.height)-next.crossSize-40,ratio=clamp((n[old.cross]-a[old.cross]-20)/Math.max(1,oldSpan),0,1),progress=Math.max(0,n[old.flow]-old.start)/(old.flowSize+50);n[next.cross]=Math.round(b[next.cross]+20+ratio*newSpan);n[next.flow]=Math.round(next.start+progress*(next.flowSize+50));if(n.x>20000||n.y>20000)throw Error('向きを変更すると配置範囲を超えます。ノードを手前へ移動してください。');}
  if(oldLength!==undefined){const converted=next.start-40+Math.max(0,oldLength-(old.start-40))*(next.flowSize+50)/(old.flowSize+50);d.laneLength=Math.min(20000,Math.max(400,Math.round(converted)));growLaneLength(d);}
}
export function moveLane(d,id,delta){const i=(d.lanes||[]).findIndex(l=>l.id===id),j=i+delta;if(i<0||j<0||j>=d.lanes.length)return;const a=axes(d),before=new Map(laneGeometry(d).map(l=>[l.id,l[a.cross]]));d.lanes.splice(j,0,d.lanes.splice(i,1)[0]);const after=laneGeometry(d);for(const n of d.nodes)if(n.laneId)n[a.cross]+=after.find(l=>l.id===n.laneId)[a.cross]-before.get(n.laneId);}
export function removeLane(d,id){const a=axes(d),before=laneGeometry(d);d.lanes=(d.lanes||[]).filter(l=>l.id!==id);const after=laneGeometry(d),outside=after.length?Math.min(20000,40+laneSpan(d)+60):null;for(const n of d.nodes){if(n.laneId===id){delete n.laneId;if(outside!==null)n[a.cross]=outside;}else if(n.laneId)n[a.cross]+=after.find(l=>l.id===n.laneId)[a.cross]-before.find(l=>l.id===n.laneId)[a.cross];}}

export function laneResizePreview(d,id,dimension,value){const preview=copy(d);if(dimension==='length')resizeLaneLength(preview,value);else resizeLane(preview,id,value);return preview;}
