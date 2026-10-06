export const ACTIVITY_KINDS={start:'開始点',action:'アクション',decision:'分岐',merge:'合流',fork:'並行分岐',join:'同期',end:'アクティビティ終了',reference:'別フロー参照'};
export const isActivity=d=>d.diagramType==='activity';
export const isActivityBar=kind=>['fork','join'].includes(kind);
export const activityBarBounds=orientation=>orientation==='vertical'?{x:94,y:6,width:12,height:96}:{x:20,y:48,width:160,height:12};
export const diagramLabel=d=>isActivity(d)?'UMLアクティビティ図':'サイクル図';
export const activityKind=kind=>Object.hasOwn(ACTIVITY_KINDS,kind)?kind:'action';
export const cycleKind=kind=>kind==='merge'?'decision':['fork','join'].includes(kind)?'action':kind;
export function activityEdgeLabel(d,e){return isActivity(d)&&d.nodes.find(n=>n.id===e.source)?.kind==='decision'&&e.label.trim()&&!/^\s*\[[\s\S]*\]\s*$/.test(e.label)?'['+e.label+']':e.label;}
export function convertDiagram(d,type){
  if(!['cycle','activity'].includes(type))throw Error('図の種類が不正です。');
  if((d.diagramType||'cycle')===type)return;
  d.diagramType=type;
  for(const n of d.nodes){n.kind=type==='activity'?activityKind(n.kind):cycleKind(n.kind);if(!isActivityBar(n.kind))delete n.barOrientation;}
  if(type==='cycle')delete d.plantUml;
}
export function activityIssues(d){
  if(!isActivity(d))return [];
  const result=[],starts=d.nodes.filter(n=>n.kind==='start');
  if(d.nodes.length&&!starts.length)result.push('開始点がありません。');
  for(const n of d.nodes){
    const incoming=d.edges.filter(e=>e.target===n.id),out=d.edges.filter(e=>e.source===n.id),name='「'+n.text+'」';
    if(n.kind==='start'&&incoming.length)result.push(name+'：開始点に入る矢印があります。');
    if(n.kind==='end'&&out.length)result.push(name+'：終了点から出る矢印があります。');
    if(['decision','fork'].includes(n.kind)&&out.length<2)result.push(name+'：分岐先を2つ以上つないでください。');
    if(['merge','join'].includes(n.kind)&&incoming.length<2)result.push(name+'：合流元を2つ以上つないでください。');
    if(n.kind==='decision'&&out.some(e=>!e.label.trim()))result.push(name+'：各矢印にガード条件（成立／不成立など）を書いてください。');
    if(!['decision','fork','end'].includes(n.kind)&&out.length>1)result.push(name+'：分岐・並行分岐ノードで行き先を明示してください。');
  }
  return result;
}
// Encode syntax characters, including preprocessor and Creole markup, as literal Unicode.
// Imported descriptions are data; they must never become PlantUML directives or URLs.
export function umlText(value){return String(value).replace(/\r\n?/g,'\n').replace(/[^\p{L}\p{N} ,。、・ー？：！\-\n]/gu,c=>'<U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')+'>').replace(/\n/g,'\\n');}
const detailText=(items,depth=0)=>items.flatMap(item=>['  '.repeat(depth)+item.text,...detailText(item.children,depth+1)]);
function linearPlantUml(d){
  if(!d.nodes.length||d.nodes.some(n=>!['start','end','action','reference'].includes(n.kind)))return null;
  const next=new Map(),incoming=new Set();
  for(const e of d.edges){if(next.has(e.source)||incoming.has(e.target))return null;next.set(e.source,e);incoming.add(e.target);}
  if(d.nodes.some(n=>n.kind==='start'&&incoming.has(n.id)||n.kind==='end'&&next.has(n.id)))return null;
  const visited=new Set(),chains=[];
  for(const root of d.nodes.filter(n=>!incoming.has(n.id))){const chain=[];let n=root;while(n&&!visited.has(n.id)){visited.add(n.id);chain.push(n);const target=next.get(n.id)?.target;n=d.nodes.find(x=>x.id===target);}chains.push(chain);}
  if(visited.size!==d.nodes.length||chains.some(c=>c.at(-1).kind==='start'))return null;
  const out=['@startuml',"' Generated from the editable graph by USDM Studio.",'skinparam shadowing false','title '+umlText(d.title)],lanes=new Map((d.lanes||[]).map((l,i)=>[l.id,'role'+i]));
  for(const l of d.lanes||[])out.push('|'+lanes.get(l.id)+'|'+umlText(l.name));
  if(lanes.size&&d.nodes.some(n=>!n.laneId))out.push('|unassigned|未割り当て');
  for(const chain of chains){for(const n of chain){
    if(lanes.size)out.push('|'+(lanes.get(n.laneId)||'unassigned')+'|');
    out.push(n.kind==='start'?'start':n.kind==='end'?'stop':':'+umlText(n.text)+';');
    const note=[n.description,...detailText(n.details)].filter(Boolean);if(note.length)out.push('note right: '+umlText(note.join('\n')));
    if(next.get(n.id)?.label)out.push('-> '+umlText(next.get(n.id).label)+';');
  }if(chain.at(-1).kind!=='end')out.push('detach');}
  const legend=[d.description,...detailText(d.details||[])].filter(Boolean);if(legend.length)out.push('legend bottom',...legend.map(umlText),'endlegend');
  out.push('@enduml');return out.join('\n');
}
export function plantUml(d){
  const linear=linearPlantUml(d);if(linear)return linear;
  const out=['@startuml',"' Generated from the editable graph by USDM Studio.","' Activity diagram (legacy syntax): explicit edges preserve loops and cross-links.",'skinparam shadowing false','skinparam activityBackgroundColor #FFFFFF','skinparam activityBorderColor #44758D','skinparam activityBarColor #263746','title '+umlText(d.title),'" " as USDM_seed -[hidden]-> USDM_seed'];
  const multipleStarts=d.nodes.filter(n=>n.kind==='start').length>1;
  if(multipleStarts)out.push("' Named initial nodes retain separate identities in the legacy activity syntax.",'skinparam activityBorderColor<<initial>> transparent','skinparam activityBackgroundColor<<initial>> transparent','skinparam activityFontColor<<initial>> black','skinparam activityFontSize<<initial>> 30','hide stereotype');
  const names=new Map(d.nodes.map((n,i)=>[n.id,n.kind==='start'&&!multipleStarts?'(*)':n.kind==='end'?`(*${i+1})`:['fork','join'].includes(n.kind)?`===N${i}===`:`N${i}`]));
  const declare=n=>{
    const name=names.get(n.id);
    if(n.kind==='start')out.push(...(multipleStarts?[`"<U+25CF>" as ${name} <<initial>> -[hidden]-> ${name}`]:['(*) -[hidden]-> USDM_seed','USDM_seed -[hidden]-> start']));
    else if(n.kind==='end'||['fork','join'].includes(n.kind))out.push('USDM_seed -[hidden]-> '+name);
    else if(['decision','merge'].includes(n.kind))out.push(`USDM_seed -[hidden]-> if "" as ${name} then`,'endif');
    else out.push(`"${umlText(n.text)}" as ${name} -[hidden]-> ${name}`);
    const note=[...(['decision','merge','fork','join','start','end'].includes(n.kind)?[n.text]:[]),n.description,...detailText(n.details)].filter(Boolean);
    if(note.length)out.push('note right: '+umlText(note.join('\n')));
  };
  for(const [index,lane]of (d.lanes||[]).entries()){
    // Legacy partitions share identifiers with nodes; prefixing also keeps equal role names distinct.
    out.push(`partition "${umlText('役割'+(index+1)+'：'+lane.name)}" {`);d.nodes.filter(n=>n.laneId===lane.id).forEach(declare);out.push('}');
  }
  d.nodes.filter(n=>!n.laneId).forEach(declare);
  out.push('hide USDM_seed');
  for(const e of d.edges){
    const a=d.nodes.find(n=>n.id===e.source),b=d.nodes.find(n=>n.id===e.target);
    const from=a.kind==='end'?`"end$${d.nodes.indexOf(a)+1}"`:names.get(a.id),to=b.kind==='start'&&!multipleStarts?'start':names.get(b.id);
    out.push(`${from} -->${e.label?'['+umlText(activityEdgeLabel(d,e))+']':''} ${to}`);
  }
  const legend=[d.description,...detailText(d.details||[]),...activityIssues(d).map(x=>'確認：'+x)].filter(Boolean);
  if(legend.length)out.push('legend bottom',...legend.map(x=>umlText(x)),'endlegend');
  out.push('@enduml');return out.join('\n');
}
export function syncPlantUml(cycles){for(const d of Object.values(cycles).flat())if(isActivity(d))d.plantUml=plantUml(d);}

export {horizontalLanes,laneSize,laneSpan,laneLength,laneLengthLimits,laneSizeLimits,laneGeometry,laneAt,createLane,containLaneNode,growLaneLength,assignLane,resizeLane,resizeLaneLength,setLaneOrientation,moveLane,removeLane,laneResizePreview} from './lanes.js';

export function activityShape(kind,barOrientation){
  if(kind==='start')return '<circle class="uml-solid" cx="100" cy="54" r="15"/>';
  if(kind==='end')return '<circle cx="100" cy="54" r="21"/><circle class="uml-solid" cx="100" cy="54" r="14"/>';
  if(isActivityBar(kind)){const b=activityBarBounds(barOrientation);return `<rect class="uml-solid" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="1"/>`;}
  if(['decision','merge'].includes(kind))return '<polygon points="100,3 197,54 100,105 3,54"/>';
  return '<rect x="3" y="3" width="194" height="102" rx="18"/>'+(kind==='reference'?'<path class="reference-bars" d="M15 10V98 M185 10V98"/>':'');
}
