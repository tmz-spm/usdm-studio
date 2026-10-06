import {isActivity,isActivityBar,activityKind,cycleKind} from './activity.js';
import {CYCLE_NODE,validateCycleMap,cloneCycle} from './cycles.js';

const FORMAT='usdm-studio-cycle-selection';
const MAX_TEXT=20*1024*1024;
const copy=value=>JSON.parse(JSON.stringify(value));
const bounds=nodes=>nodes.reduce((b,n)=>({left:Math.min(b.left,n.x),top:Math.min(b.top,n.y),right:Math.max(b.right,n.x),bottom:Math.max(b.bottom,n.y)}),{left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity});
const tooLarge=text=>text.length>MAX_TEXT||new TextEncoder().encode(text).length>MAX_TEXT;

function validatePacket(packet){
  if(packet?.clipboardVersion<3&&packet.nodes?.some(n=>Object.hasOwn(n,'barOrientation')))throw Error('棒の向きを含むコピーはクリップボード形式3にしてください。');
  if(packet?.clipboardVersion>=2&&(!['cycle','activity'].includes(packet.diagramType)||!Array.isArray(packet.lanes)))throw Error('コピーした図の種類と役割の設定が不正です。');
  const fields=['format','clipboardVersion','nodes','edges',...(packet?.clipboardVersion>=2?['diagramType','lanes']:[])];
  if(!packet||typeof packet!=='object'||Array.isArray(packet)||Object.keys(packet).some(k=>!fields.includes(k))||packet.format!==FORMAT||![1,2,3].includes(packet.clipboardVersion)||!Array.isArray(packet.nodes)||!packet.nodes.length||!Array.isArray(packet.edges))throw Error('サイクル図でコピーしたフローを貼り付けてください。');
  // Reuse the project validator; clipboard contents are data and cannot add arbitrary fields.
  validateCycleMap([{type:'category',node:{_key:'clipboard'}}],{clipboard:[{id:'clipboard',title:'コピーしたフロー',description:'',nodes:packet.nodes,edges:packet.edges,...(packet.clipboardVersion>=2?{diagramType:packet.diagramType,lanes:packet.lanes}: {})}]});
  return packet;
}
export function copyCycleSelection(diagram,ids){
  const selected=new Set(ids),nodes=diagram.nodes.filter(n=>selected.has(n.id));
  if(!nodes.length)throw Error('コピーするフローノードを選択してください。');
  if(nodes.length!==selected.size)throw Error('コピー対象のノードが見つかりません。');
  const packet={format:FORMAT,clipboardVersion:1,nodes:copy(nodes),edges:copy(diagram.edges.filter(e=>selected.has(e.source)&&selected.has(e.target)))};
  if(diagram.diagramType||diagram.lanes||packet.edges.some(e=>e.route)){packet.clipboardVersion=2;packet.diagramType=diagram.diagramType||'cycle';packet.lanes=copy(diagram.lanes||[]);}
  if(packet.nodes.some(n=>Object.hasOwn(n,'barOrientation')))packet.clipboardVersion=3;
  validatePacket(packet);const text=JSON.stringify(packet,null,2);if(tooLarge(text))throw Error('コピーするフローを20MB以下に分けてください。');return text;
}
export function parseCycleClipboard(text){
  if(typeof text!=='string'||tooLarge(text))throw Error('貼り付けるフローは20MB以下にしてください。');
  let packet;try{packet=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw Error('サイクル図でコピーしたフローを貼り付けてください。');}
  return validatePacket(packet);
}
function pastePosition(diagram,nodes,preferred,fixedX=false){
  const b=bounds(nodes),spanX=b.right-b.left,spanY=b.bottom-b.top,maxX=20000-spanX,maxY=20000-spanY,width=spanX+CYCLE_NODE.width,height=spanY+CYCLE_NODE.height;
  const clamp=(v,max)=>Math.max(0,Math.min(max,Math.round(v))),x=clamp(preferred?.x??b.left+40,maxX),y=clamp(preferred?.y??b.top+40,maxY),seen=new Set();
  const free=(px,py)=>!diagram.nodes.some(n=>px<n.x+CYCLE_NODE.width+24&&px+width+24>n.x&&py<n.y+CYCLE_NODE.height+24&&py+height+24>n.y);
  for(let step=0;step<=160;step++)for(const [dx,dy]of [[0,step*(height+50)],[step*(width+50),0],[0,-step*(height+50)],[-step*(width+50),0]]){
    if(fixedX&&dx)continue;const px=clamp(x+dx,maxX),py=clamp(y+dy,maxY),key=px+':'+py;if(seen.has(key))continue;seen.add(key);if(free(px,py))return {x:px,y:py};
  }
  throw Error('配置関係を保ったまま貼り付ける空きがありません。別のサイクル図へ貼り付けてください。');
}
export function clipboardConversions(diagram,packet){return packet.nodes.filter(n=>(isActivity(diagram)?activityKind(n.kind):cycleKind(n.kind))!==n.kind);}
export function pasteCycleSelection(diagram,text,preferred,allowConversion=false){
  const packet=parseCycleClipboard(text),source={id:'clipboard',title:'コピーしたフロー',description:'',nodes:packet.nodes,edges:packet.edges,...(packet.clipboardVersion>=2?{diagramType:packet.diagramType,lanes:packet.lanes}: {})};
  const converted=clipboardConversions(diagram,packet);if(converted.length&&!allowConversion)throw Error('貼り付け先に合わせてノードの種類を変更する確認が必要です。');
  // The temporary diagram must not remap a real diagram reference during cloning.
  source.id='clipboard_'+crypto.randomUUID();const cloned=cloneCycle(source),b=bounds(cloned.nodes),offset=(diagram.lanes||[]).reduce((sum,l)=>sum+l.width,0),hasLanes=!!cloned.lanes?.length;
  if(hasLanes&&b.right+offset>20000)throw Error('役割区画を貼り付ける横幅がありません。');
  const position=pastePosition(diagram,cloned.nodes,hasLanes?{x:b.left+offset,y:Math.max(110,preferred?.y??b.top+40)}:preferred,hasLanes);
  for(const n of cloned.nodes){n.kind=isActivity(diagram)?activityKind(n.kind):cycleKind(n.kind);if(!isActivityBar(n.kind))delete n.barOrientation;n.x=n.x-b.left+position.x;n.y=n.y-b.top+position.y;}
  if(hasLanes)(diagram.lanes??=[]).push(...cloned.lanes);
  diagram.nodes.push(...cloned.nodes);diagram.edges.push(...cloned.edges);
  return {ids:cloned.nodes.map(n=>n.id),nodeCount:cloned.nodes.length,edgeCount:cloned.edges.length};
}
