import {ACTIVITY_KINDS,isActivity,isActivityBar,activityBarBounds,diagramLabel,plantUml,laneGeometry,laneAt,containLaneNode,growLaneLength} from './activity.js';
export const diagramKinds=d=>isActivity(d)?ACTIVITY_KINDS:CYCLE_KINDS;
export const defaultCycleKind=d=>isActivity(d)?'action':'phase';
export const CYCLE_OWNERS=new Set(['category','requirementGroup','specificationGroup']);
export const CYCLE_KINDS={phase:'フェーズ・場面',input:'プレイヤー入力',event:'イベント',action:'行動・処理',state:'状態',screen:'画面',decision:'分岐',reference:'別フロー参照',start:'開始',end:'終了'};
export const CYCLE_HINTS={input:'プレイヤーが行う操作や選択を書きます。受付できる場面、長押し、入力がない場合の進行などは下の詳細仕様に記述できます。',event:'時間切れ・拠点陥落など、ゲーム内で起きる出来事を書きます。発生条件や周期は下の詳細仕様に記述できます。',reference:'別の図で説明する仕組みを参照します。参照先の内容は複製せず、その図のタブで編集します。',decision:'勝利／敗北、続行／撤退など、行き先ごとの意味を矢印に書きます。T／Fに限定する必要はありません。'};
export const DETAIL_KINDS={specification:'詳細仕様',behavior:'挙動',rule:'ルール'};
export const CYCLE_ROW_TYPES={cycle:{label:'サイクル図',symbol:'↻'},cycleNode:{label:'フロー仕様',symbol:'F'},cycleSpecification:{label:'詳細仕様',symbol:'S'},cycleBehavior:{label:'挙動',symbol:'B'},cycleRule:{label:'ルール',symbol:'R'}};
export const CYCLE_NODE={width:200,height:108};
const copy=x=>JSON.parse(JSON.stringify(x));
const uid=prefix=>prefix+'_'+crypto.randomUUID();
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function fields(value,required,optional=[],where='サイクル図'){
  if(!object(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>![...required,...optional].includes(k)))throw Error(`${where}の項目が不正です。`);
}
function string(value,where,required=false){if(typeof value!=='string'||required&&!value.trim())throw Error(`${where}を入力してください。`);}
function id(value,set,where){if(typeof value!=='string'||!/^[-A-Za-z0-9_]+$/.test(value)||set.has(value))throw Error(`${where}のIDが不正または重複しています。`);set.add(value);}
export function detailRows(details){
  const rows=[];const visit=(list,parent=null,depth=0)=>list.forEach((item,index)=>{rows.push({item,list,index,parent,depth});visit(item.children,item,depth+1);});
  visit(details);return rows;
}
export function detailHolder(d,nodeId=''){const holder=nodeId?d.nodes.find(n=>n.id===nodeId):d;if(!holder)throw Error('詳細の所属先がありません。');return holder;}
export function cycleRules(d){return [{nodeId:'',scope:'図全体',details:d.details||[]},...d.nodes.map(n=>({nodeId:n.id,scope:n.text,details:n.details}))].flatMap(h=>detailRows(h.details).filter(r=>r.item.kind==='rule').map(r=>({...r,nodeId:h.nodeId,scope:h.scope})));}
export function cycleFormatVersion(cycles){const diagrams=Object.values(cycles).flat();if(diagrams.some(d=>d.laneOrientation!==undefined||d.laneLength!==undefined||d.lanes?.some(l=>l.height!==undefined)))return 7;if(diagrams.some(d=>d.nodes.some(n=>Object.hasOwn(n,'barOrientation'))))return 6;if(diagrams.some(d=>d.diagramType||d.lanes||d.plantUml!==undefined||d.nodes.some(n=>n.laneId)||d.edges.some(e=>e.route)))return 5;if(diagrams.some(d=>d.nodes.some(n=>Object.hasOwn(n,'tailHidden'))||d.edges.some(e=>Object.hasOwn(e,'sourceAnchor')||Object.hasOwn(e,'targetAnchor'))))return 4;return diagrams.some(d=>Object.hasOwn(d,'details')||d.nodes.some(n=>['input','event','reference'].includes(n.kind)||detailRows(n.details).some(r=>r.item.kind==='rule')))?3:2;}
export function cycleReferenceIssues(cycles){const diagrams=Object.values(cycles).flat(),ids=new Set(diagrams.map(d=>d.id));return diagrams.flatMap(d=>d.nodes.filter(n=>n.kind==='reference'&&(!n.reference||!ids.has(n.reference))).map(n=>`「${d.title}」の「${n.text}」：${n.reference?'参照先の図が見つかりません':'参照先の図が未設定です'}。`));}
export function validateCycleMap(rows,cycles){
  if(!object(cycles))throw Error('サイクル図の保存形式が不正です。');
  const owners=new Set(rows.filter(r=>CYCLE_OWNERS.has(r.type)).map(r=>r.node._key)),diagramIds=new Set();
  for(const [owner,diagrams] of Object.entries(cycles)){
    if(!owners.has(owner)||!Array.isArray(diagrams))throw Error('サイクル図の所属先はカテゴリ・要求グループ・仕様グループにしてください。');
    for(const d of diagrams){
      fields(d,['id','title','description','nodes','edges'],['details','diagramType','lanes','plantUml','laneOrientation','laneLength']);id(d.id,diagramIds,'サイクル図');string(d.title,'図の名前',true);string(d.description,'図の説明');
      if(!Array.isArray(d.nodes)||!Array.isArray(d.edges))throw Error('ノードと矢印は配列にしてください。');
      if(d.diagramType!==undefined&&!['cycle','activity'].includes(d.diagramType))throw Error('図の種類が不正です。');
      if(d.plantUml!==undefined&&(!isActivity(d)||typeof d.plantUml!=='string'))throw Error('PlantUMLはUML図の文字列にしてください。');
      if(d.laneOrientation!==undefined&&!['vertical','horizontal'].includes(d.laneOrientation))throw Error('役割区画の向きが不正です。');
      if(d.laneLength!==undefined&&(!Number.isFinite(d.laneLength)||d.laneLength<400||d.laneLength>20000))throw Error('役割区画の長さは400〜20000にしてください。');
      const lanes=new Set();if(d.lanes!==undefined){if(!Array.isArray(d.lanes))throw Error('役割は配列にしてください。');let total=40;for(const lane of d.lanes){fields(lane,['id','name','width'],['height'],'役割');id(lane.id,lanes,'役割');string(lane.name,'役割名',true);if(!Number.isFinite(lane.width)||lane.width<260||lane.width>2000)throw Error('役割の幅は260〜2000にしてください。');if(lane.height!==undefined&&(!Number.isFinite(lane.height)||lane.height<180||lane.height>2000))throw Error('役割の高さは180〜2000にしてください。');total+=d.laneOrientation==='horizontal'?(lane.height??240):lane.width;}if(total>20000)throw Error('役割の全幅は20000以下にしてください。');}
      const nodes=new Set(),edges=new Set(),details=new Set();
      const checkDetails=items=>{if(!Array.isArray(items))throw Error('詳細仕様・挙動・ルールは配列にしてください。');const queue=[...items];while(queue.length){const item=queue.pop();fields(item,['id','kind','text','children'],[],'詳細仕様・挙動・ルール');id(item.id,details,'詳細');if(!Object.hasOwn(DETAIL_KINDS,item.kind))throw Error('詳細の種類が不正です。');string(item.text,'詳細の内容',true);if(!Array.isArray(item.children))throw Error('詳細の子要素は配列にしてください。');queue.push(...item.children);}};
      if(Object.hasOwn(d,'details'))checkDetails(d.details);
      for(const n of d.nodes){
        fields(n,['id','kind','text','description','x','y','details'],['reference','tailHidden','laneId','barOrientation'],'フローノード');id(n.id,nodes,'ノード');
        if(Object.hasOwn(n,'barOrientation')&&(!isActivity(d)||!isActivityBar(n.kind)||!['horizontal','vertical'].includes(n.barOrientation)))throw Error('棒の向きはUMLの並行分岐・同期ノードで横または縦を指定してください。');
        if(Object.hasOwn(n,'tailHidden')&&typeof n.tailHidden!=='boolean')throw Error('末端の追加用の線の非表示設定は真偽値にしてください。');
        if(n.laneId!==undefined&&!lanes.has(n.laneId))throw Error('ノードの役割がありません。');
        if(!Object.hasOwn(diagramKinds(d),n.kind))throw Error('ノードの種類が不正です。');
        if(Object.hasOwn(n,'reference')&&(n.kind!=='reference'||typeof n.reference!=='string'||n.reference&&!/^[-A-Za-z0-9_]+$/.test(n.reference)))throw Error('参照先は別フロー参照ノードの図IDにしてください。');
        string(n.text,'大まかな仕様・場面',true);string(n.description,'ノードの説明');
        if(![n.x,n.y].every(v=>Number.isFinite(v)&&v>=0&&v<=20000))throw Error('ノードの座標は0〜20000の数値にしてください。');
        checkDetails(n.details);
      }
      for(const e of d.edges){fields(e,['id','source','target','label'],['sourceAnchor','targetAnchor','route'],'矢印');id(e.id,edges,'矢印');if(!nodes.has(e.source)||!nodes.has(e.target))throw Error('矢印の接続先ノードがありません。');string(e.label,'矢印の条件');if(e.route!==undefined){fields(e.route,['x','y'],[],'線の経路');if(![e.route.x,e.route.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=40000))throw Error('線の経路は-40000〜40000の数値にしてください。');}for(const key of ['sourceAnchor','targetAnchor'])if(Object.hasOwn(e,key)){fields(e[key],['angle'],[],'接続位置');if(!Number.isFinite(e[key].angle)||e[key].angle<0||e[key].angle>=360)throw Error('接続位置の角度は0以上360未満の数値にしてください。');}}
    }
  }
  return true;
}
export function createCycle(title='新しいサイクル図',diagramType='cycle'){return {id:uid('cycle'),title,description:'',nodes:[],edges:[],...(diagramType==='activity'?{diagramType,lanes:[]}: {})};}
export function createCycleNode(kind='phase',x=80,y=100){if(!Object.hasOwn({...CYCLE_KINDS,...ACTIVITY_KINDS},kind))throw Error('ノードの種類が不正です。');return {id:uid('node'),kind,text:'新しい'+(CYCLE_KINDS[kind]||ACTIVITY_KINDS[kind]),description:'',x,y,details:[],...(kind==='reference'?{reference:''}:{}),...(isActivityBar(kind)?{barOrientation:'vertical'}:{})};}
export function createDetail(kind='specification'){if(!Object.hasOwn(DETAIL_KINDS,kind))throw Error('詳細の種類が不正です。');return {id:uid('detail'),kind,text:'新しい'+DETAIL_KINDS[kind],children:[]};}
export function connectCycle(d,source,target,label=''){if(!d.nodes.some(n=>n.id===source)||!d.nodes.some(n=>n.id===target))throw Error('接続するノードを選択してください。');const edge={id:uid('edge'),source,target,label};d.edges.push(edge);return edge;}
export function removeCycleNode(d,id){d.nodes=d.nodes.filter(n=>n.id!==id);d.edges=d.edges.filter(e=>e.source!==id&&e.target!==id);}
export function freeCyclePosition(d,x,y){
  const {width:w,height:h}=CYCLE_NODE,clamp=v=>Math.max(20,Math.min(20000,Math.round(v)));
  const free=(x,y)=>!d.nodes.some(n=>x<n.x+w+24&&x+w+24>n.x&&y<n.y+h+24&&y+h+24>n.y);
  for(let step=0;step<=150;step++)for(const [dx,dy]of [[0,step*(h+50)],[0,-step*(h+50)],[step*(w+60),0],[-step*(w+60),0]]){const px=clamp(x+dx),py=clamp(y+dy);if(free(px,py))return {x:px,y:py};}
  for(let py=20;py<=20000;py+=h+50)for(let px=20;px<=20000;px+=w+60)if(free(px,py))return {x:px,y:py};
  throw Error('ノードを置く空きがありません。図を分けてください。');
}
export function insertCycleOnEdge(d,edgeId,{kind=defaultCycleKind(d),text}={}){
  const e=d.edges.find(e=>e.id===edgeId);if(!e)throw Error('挿入先の矢印がありません。');
  const geometry=cycleGeometry(d).edges.find(x=>x.id===edgeId),position=freeCyclePosition(d,geometry.insertX-CYCLE_NODE.width/2,geometry.insertY-CYCLE_NODE.height/2),n=createCycleNode(kind,position.x,position.y);
  if(text!==undefined)n.text=text;
  const lane=laneAt(d,n.x+100,n.y+54);if(lane)containLaneNode(d,n,lane,true);delete e.route;
  const target=e.target;d.nodes.splice(d.nodes.findIndex(n=>n.id===e.source)+1,0,n);e.target=n.id;
  const next=connectCycle(d,n.id,target);if(e.targetAnchor){next.targetAnchor=e.targetAnchor;delete e.targetAnchor;}growLaneLength(d);return {node:n,edge:next};
}
export function appendCycleNode(d,sourceId,{kind=defaultCycleKind(d),text,label=''}={}){
  const source=d.nodes.find(n=>n.id===sourceId);if(!source)throw Error('接続元のノードがありません。');
  const point=freeCyclePosition(d,source.x+CYCLE_NODE.width+90,source.y),n=createCycleNode(kind,point.x,point.y);if(text!==undefined)n.text=text;
  const lane=laneAt(d,n.x+100,n.y+54);if(lane)containLaneNode(d,n,lane,true);d.nodes.splice(d.nodes.indexOf(source)+1,0,n);connectCycle(d,source.id,n.id,label);growLaneLength(d);return {diagramId:d.id,selection:{kind:'node',id:n.id}};
}
export function appendCycleHierarchy(rows,cycles,key,{kind,text}={}){
  const r=cycleRows(rows,cycles).find(r=>r.node._key===key);if(!r)throw Error('追加先の項目がありません。');const d=r.diagram;
  if(r.type==='cycle'){const count=d.nodes.length,p=freeCyclePosition(d,80+(count%3)*290,110+Math.floor(count/3)*200),n=createCycleNode(kind||defaultCycleKind(d),p.x,p.y);if(text!==undefined)n.text=text;const lane=laneAt(d,n.x+100,n.y+54);if(lane)containLaneNode(d,n,lane,true);d.nodes.push(n);growLaneLength(d);return {diagramId:d.id,selection:{kind:'node',id:n.id}};}
  const nodeId=r.selection.kind==='node'?r.selection.id:r.selection.nodeId||'',holder=detailHolder(d,nodeId),list=r.selection.kind==='detail'?detailRows(holder.details||[]).find(x=>x.item.id===r.selection.id).item.children:(holder.details??=[]),item=createDetail(kind||'specification');if(text!==undefined)item.text=text;list.push(item);return {diagramId:d.id,selection:{kind:'detail',nodeId,id:item.id}};
}
export function insertCycleHierarchy(rows,cycles,key,{position='after',kind,text}={}){
  const r=cycleRows(rows,cycles).find(r=>r.node._key===key);if(!r)throw Error('挿入先の項目がありません。');
  if(!['before','after','wrap'].includes(position)||position==='wrap'&&r.selection.kind!=='detail')throw Error('この階層にはその方法で挿入できません。');
  if(r.type==='cycle'){
    const d=createCycle(text,r.diagram.diagramType),list=cycles[r.ownerKey];list.splice(list.findIndex(x=>x.id===r.diagram.id)+(position==='after'?1:0),0,d);return {diagramId:d.id,selection:{kind:'diagram'}};
  }
  const d=r.diagram;
  if(r.selection.kind==='node'){
    const index=d.nodes.findIndex(n=>n.id===r.selection.id),reference=d.nodes[index],point=freeCyclePosition(d,reference.x+(position==='after'?260:-260),reference.y),n=createCycleNode(kind||reference.kind,point.x,point.y);
    if(text!==undefined)n.text=text;const lane=laneAt(d,n.x+100,n.y+54);if(lane)containLaneNode(d,n,lane,true);d.nodes.splice(index+(position==='after'?1:0),0,n);growLaneLength(d);return {diagramId:d.id,selection:{kind:'node',id:n.id}};
  }
  const n=detailHolder(d,r.selection.nodeId),row=detailRows(n.details).find(x=>x.item.id===r.selection.id),item=createDetail(kind||row.item.kind);
  if(text!==undefined)item.text=text;
  if(position==='wrap'){item.children=[row.item];row.list.splice(row.index,1,item);}else row.list.splice(row.index+(position==='after'?1:0),0,item);
  return {diagramId:d.id,selection:{kind:'detail',nodeId:r.selection.nodeId||'',id:item.id}};
}
export function cloneCycle(source){const d=copy(source),map=new Map();d.id=uid('cycle');const lanes=new Map();for(const l of d.lanes||[]){const old=l.id;l.id=uid('lane');lanes.set(old,l.id);}for(const {item}of detailRows(d.details||[]))item.id=uid('detail');for(const n of d.nodes){const old=n.id;n.id=uid('node');map.set(old,n.id);if(n.laneId)n.laneId=lanes.get(n.laneId);if(n.reference===source.id)n.reference=d.id;for(const {item}of detailRows(n.details))item.id=uid('detail');}for(const e of d.edges){e.id=uid('edge');e.source=map.get(e.source);e.target=map.get(e.target);}if(isActivity(d))d.plantUml=plantUml(d);return d;}
export function findCycle(cycles,id){for(const [owner,list]of Object.entries(cycles))for(const diagram of list)if(diagram.id===id)return {owner,diagram};return null;}
export function cycleRows(rows,cycles){
  const result=[];
  for(const owner of rows)for(const [index,d]of (cycles[owner.node._key]||[]).entries()){
    const add=(parent,field,index,type,key,text,description,selection,label)=>{
      const row={node:{_key:key,title:text,explanation:description||''},type,parent:parent.node,field,index,path:parent.path+'/'+field+'/'+index,depth:parent.depth+1,diagram:d,ownerKey:owner.node._key,selection,label:label||CYCLE_ROW_TYPES[type].label};
      result.push(row);return row;
    };
    const diagram=add(owner,'cycleDiagrams',index,'cycle','cycle:'+d.id,d.title,d.description,{kind:'diagram'},diagramLabel(d));diagram.childCount=d.nodes.length+(d.details||[]).length;
    const visit=(items,parent,field,nodeId)=>items.forEach((item,j)=>{const row=add(parent,field,j,item.kind==='behavior'?'cycleBehavior':item.kind==='rule'?'cycleRule':'cycleSpecification',`cycle:${d.id}:detail:${item.id}`,item.text,'',{kind:'detail',nodeId,id:item.id});row.childCount=item.children.length;visit(item.children,row,'children',nodeId);});
    visit(d.details||[],diagram,'details','');
    for(const [i,n]of d.nodes.entries()){
      const node=add(diagram,'nodes',i,'cycleNode',`cycle:${d.id}:node:${n.id}`,n.text,n.description,{kind:'node',id:n.id},diagramKinds(d)[n.kind]);node.childCount=n.details.length;
      visit(n.details,node,'details',n.id);
    }
  }
  return result;
}
export function pruneCycleOwners(rows,cycles){const owners=new Set(rows.filter(r=>CYCLE_OWNERS.has(r.type)).map(r=>r.node._key)),removed=[];for(const [key,list]of Object.entries(cycles||{}))if(!owners.has(key)){removed.push(...list);delete cycles[key];}return removed;}
// Store a direction relative to the node, so changing its position or shape keeps the anchor on its outline.
export function cycleAnchorAt(node,x,y,fallback=0){const dx=x-node.x-100,dy=y-node.y-54;return {angle:Math.hypot(dx,dy)<1?fallback:(Math.round((Math.atan2(dy,dx)*180/Math.PI+360)*100)/100)%360};}
export function cycleAnchorPoint(node,anchor,activity=false){
  const angle=anchor.angle*Math.PI/180,dx=Math.cos(angle),dy=Math.sin(angle),cx=node.x+100,cy=node.y+54;
  const polygons={input:[[24,3],[197,3],[176,105],[3,105]],event:[[24,3],[176,3],[197,54],[176,105],[24,105],[3,54]],decision:[[100,3],[197,54],[100,105],[3,54]]};
  if(activity&&['start','end'].includes(node.kind)){const radius=node.kind==='start'?15:21;return {x:cx+dx*radius,y:cy+dy*radius,nx:dx,ny:dy};}
  if(activity&&isActivityBar(node.kind)){const b=activityBarBounds(node.barOrientation),hw=b.width/2,hh=b.height/2,t=Math.min(hw/Math.abs(dx),hh/Math.abs(dy));return {x:cx+dx*t,y:cy+dy*t,nx:Math.abs(dx*t)>hw-.001?Math.sign(dx):0,ny:Math.abs(dy*t)>hh-.001?Math.sign(dy):0};}
  const polygon=polygons[node.kind]||(activity&&node.kind==='merge'?polygons.decision:null);let t,nx=0,ny=0;
  if(polygon){
    const hits=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],ex=b[0]-a[0],ey=b[1]-a[1],ax=a[0]-100,ay=a[1]-54,cross=dx*ey-dy*ex;
      if(Math.abs(cross)<1e-9)continue;
      const distance=(ax*ey-ay*ex)/cross,u=(ax*dy-ay*dx)/cross;
      if(distance>=0&&u>=-1e-8&&u<=1+1e-8)hits.push({distance,nx:ey/Math.hypot(ex,ey),ny:-ex/Math.hypot(ex,ey)});
    }
    t=Math.min(...hits.map(p=>p.distance));for(const p of hits)if(Math.abs(p.distance-t)<1e-7){nx+=p.nx;ny+=p.ny;}const length=Math.hypot(nx,ny);nx/=length;ny/=length;
  }else{
    const radius=activity?18:['start','end'].includes(node.kind)?50:node.kind==='state'?32:node.kind==='phase'?18:5;
    t=Math.min(97/Math.abs(dx),51/Math.abs(dy));const x=dx*t,y=dy*t;
    if(Math.abs(x)>97-radius&&Math.abs(y)>51-radius){
      const ox=Math.sign(dx)*(97-radius),oy=Math.sign(dy)*(51-radius),dot=dx*ox+dy*oy;
      t=dot+Math.sqrt(Math.max(0,dot*dot-ox*ox-oy*oy+radius*radius));nx=(dx*t-ox)/radius;ny=(dy*t-oy)/radius;
    }else if(Math.abs(x)>=97-1e-7)nx=Math.sign(dx);else ny=Math.sign(dy);
  }
  return {x:cx+dx*t,y:cy+dy*t,nx,ny};
}
export function cycleGeometry(d){
  const {width:w,height:h}=CYCLE_NODE,nodes=new Map(d.nodes.map(n=>[n.id,n])),counts=new Map();
  const edges=d.edges.map(e=>{
    const a=nodes.get(e.source),b=nodes.get(e.target),pair=e.source+'>'+e.target,index=counts.get(pair)||0;counts.set(pair,index+1);
    if(!a||!b)return null;
    let p0,p1,p2,p3;
    if(a===b){const top=Math.max(16,a.y-85-index*30);p0=[a.x+w*.35,a.y];p1=[p0[0],top];p2=[Math.max(16,a.x-85),top];p3=[a.x,a.y+h/2];}
    else if(Math.abs(b.y-a.y)>h+30&&Math.abs(b.x-a.x)>w/2){const right=b.x>a.x;p0=[a.x+w/2,a.y+(b.y>a.y?h:0)];p3=[b.x+(right?0:w),b.y+h/2];p1=[p0[0],p3[1]];p2=[p3[0]+(right?-70:70),p3[1]];}
    else if(isActivity(d)&&b.x<a.x-w&&Math.abs(b.y-a.y)<h/2){p0=[a.x,a.y+h/2];p3=[b.x+w,b.y+h/2];const bend=Math.max(20,Math.abs(p0[0]-p3[0])*.45);p1=[p0[0]-bend,p0[1]-index*70];p2=[p3[0]+bend,p3[1]-index*70];}
    else if(b.x<a.x-30){const top=Math.max(16,Math.min(a.y,b.y)-85-index*30);p0=[a.x+w/2,a.y];p1=[a.x+w/2,top];p2=[b.x+w/2,top];p3=[b.x+w/2,b.y];}
    else if(Math.abs(b.x-a.x)<30){const down=b.y>a.y;p0=[a.x+w/2,a.y+(down?h:0)];p3=[b.x+w/2,b.y+(down?0:h)];p1=[p0[0]+index*55,(p0[1]+p3[1])/2];p2=[p3[0]+index*55,p1[1]];}
    else {p0=[a.x+w,a.y+h/2];p3=[b.x,b.y+h/2];const bend=Math.max(12,Math.abs(p3[0]-p0[0])*.45);p1=[p0[0]+bend,p0[1]-index*70];p2=[p3[0]-bend,p3[1]-index*70];}
    const sourceAngle=e.sourceAnchor||cycleAnchorAt(a,...p0),targetAngle=e.targetAnchor||cycleAnchorAt(b,...p3),sourcePoint=cycleAnchorPoint(a,sourceAngle,isActivity(d)),targetPoint=cycleAnchorPoint(b,targetAngle,isActivity(d));
    p0=[sourcePoint.x,sourcePoint.y];p3=[targetPoint.x,targetPoint.y];
    if(e.sourceAnchor||e.targetAnchor){
      const distance=Math.hypot(p3[0]-p0[0],p3[1]-p0[1]),bend=(a===b?Math.max(95,distance*.8):Math.max(48,Math.min(280,distance*.42)))+index*24;
      p1=[p0[0]+sourcePoint.nx*bend,p0[1]+sourcePoint.ny*bend];p2=[p3[0]+targetPoint.nx*bend,p3[1]+targetPoint.ny*bend];
      if(a===b&&distance<24){p1[0]-=sourcePoint.ny*bend*.8;p1[1]+=sourcePoint.nx*bend*.8;p2[0]+=targetPoint.ny*bend*.8;p2[1]-=targetPoint.nx*bend*.8;}
      p1=p1.map(v=>Math.max(12,v));p2=p2.map(v=>Math.max(12,v));
    }
    if(e.route){p1=[Math.max(12,p1[0]+e.route.x),Math.max(12,p1[1]+e.route.y)];p2=[Math.max(12,p2[0]+e.route.x),Math.max(12,p2[1]+e.route.y)];}
    const mid=[0,1].map(k=>p0[k]/8+3*p1[k]/8+3*p2[k]/8+p3[k]/8);
    const shortForward=a!==b&&b.x>=a.x+w&&b.x-(a.x+w)<140&&Math.abs(a.y-b.y)<=h+30;
    return {...e,sourcePoint,targetPoint,sourceAngle,targetAngle,bounds:{right:Math.max(p0[0],p1[0],p2[0],p3[0]),bottom:Math.max(p0[1],p1[1],p2[1],p3[1])},path:`M${p0} C${p1} ${p2} ${p3}`,insertX:mid[0],insertY:mid[1],labelX:mid[0],labelY:shortForward&&!e.sourceAnchor&&!e.targetAnchor&&!e.route?Math.max(12,Math.min(a.y,b.y)-18):mid[1]-20};
  }).filter(Boolean);
  return {edges,width:Math.max(1000,...laneGeometry(d).map(l=>l.x+l.width+80),...d.nodes.map(n=>n.x+w+220),...edges.map(e=>e.bounds.right+50)),height:Math.max(620,...laneGeometry(d).map(l=>l.y+l.height+80),...d.nodes.map(n=>n.y+h+180),...edges.map(e=>e.bounds.bottom+50))};
}
