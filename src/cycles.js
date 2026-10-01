export const CYCLE_OWNERS=new Set(['category','requirementGroup','specificationGroup']);
export const CYCLE_KINDS={phase:'フェーズ・場面',action:'行動・処理',state:'状態',screen:'画面',decision:'分岐',start:'開始',end:'終了'};
export const DETAIL_KINDS={specification:'詳細仕様',behavior:'挙動'};
export const CYCLE_ROW_TYPES={cycle:{label:'サイクル図',symbol:'↻'},cycleNode:{label:'フロー仕様',symbol:'F'},cycleSpecification:{label:'詳細仕様',symbol:'S'},cycleBehavior:{label:'挙動',symbol:'B'}};
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
export function validateCycleMap(rows,cycles){
  if(!object(cycles))throw Error('サイクル図の保存形式が不正です。');
  const owners=new Set(rows.filter(r=>CYCLE_OWNERS.has(r.type)).map(r=>r.node._key)),diagramIds=new Set();
  for(const [owner,diagrams] of Object.entries(cycles)){
    if(!owners.has(owner)||!Array.isArray(diagrams))throw Error('サイクル図の所属先はカテゴリ・要求グループ・仕様グループにしてください。');
    for(const d of diagrams){
      fields(d,['id','title','description','nodes','edges']);id(d.id,diagramIds,'サイクル図');string(d.title,'図の名前',true);string(d.description,'図の説明');
      if(!Array.isArray(d.nodes)||!Array.isArray(d.edges))throw Error('ノードと矢印は配列にしてください。');
      const nodes=new Set(),edges=new Set(),details=new Set();
      for(const n of d.nodes){
        fields(n,['id','kind','text','description','x','y','details'],[],'フローノード');id(n.id,nodes,'ノード');
        if(!Object.hasOwn(CYCLE_KINDS,n.kind))throw Error('ノードの種類が不正です。');
        string(n.text,'大まかな仕様・場面',true);string(n.description,'ノードの説明');
        if(![n.x,n.y].every(v=>Number.isFinite(v)&&v>=0&&v<=20000))throw Error('ノードの座標は0〜20000の数値にしてください。');
        if(!Array.isArray(n.details))throw Error('詳細仕様・挙動は配列にしてください。');
        const queue=[...n.details];
        while(queue.length){const item=queue.pop();fields(item,['id','kind','text','children'],[],'詳細仕様・挙動');id(item.id,details,'詳細');if(!Object.hasOwn(DETAIL_KINDS,item.kind))throw Error('詳細の種類が不正です。');string(item.text,'詳細の内容',true);if(!Array.isArray(item.children))throw Error('詳細の子要素は配列にしてください。');queue.push(...item.children);}
      }
      for(const e of d.edges){fields(e,['id','source','target','label'],[],'矢印');id(e.id,edges,'矢印');if(!nodes.has(e.source)||!nodes.has(e.target))throw Error('矢印の接続先ノードがありません。');string(e.label,'矢印の条件');}
    }
  }
  return true;
}
export function createCycle(title='新しいサイクル図'){return {id:uid('cycle'),title,description:'',nodes:[],edges:[]};}
export function createCycleNode(kind='phase',x=80,y=100){if(!Object.hasOwn(CYCLE_KINDS,kind))throw Error('ノードの種類が不正です。');return {id:uid('node'),kind,text:'新しい'+CYCLE_KINDS[kind],description:'',x,y,details:[]};}
export function createDetail(kind='specification'){if(!Object.hasOwn(DETAIL_KINDS,kind))throw Error('詳細の種類が不正です。');return {id:uid('detail'),kind,text:'新しい'+DETAIL_KINDS[kind],children:[]};}
export function connectCycle(d,source,target,label=''){if(!d.nodes.some(n=>n.id===source)||!d.nodes.some(n=>n.id===target))throw Error('接続するノードを選択してください。');const edge={id:uid('edge'),source,target,label};d.edges.push(edge);return edge;}
export function removeCycleNode(d,id){d.nodes=d.nodes.filter(n=>n.id!==id);d.edges=d.edges.filter(e=>e.source!==id&&e.target!==id);}
export function cloneCycle(source){const d=copy(source),map=new Map();d.id=uid('cycle');for(const n of d.nodes){const old=n.id;n.id=uid('node');map.set(old,n.id);for(const {item}of detailRows(n.details))item.id=uid('detail');}for(const e of d.edges){e.id=uid('edge');e.source=map.get(e.source);e.target=map.get(e.target);}return d;}
export function findCycle(cycles,id){for(const [owner,list]of Object.entries(cycles))for(const diagram of list)if(diagram.id===id)return {owner,diagram};return null;}
export function cycleRows(rows,cycles){
  const result=[];
  for(const owner of rows)for(const [index,d]of (cycles[owner.node._key]||[]).entries()){
    const add=(parent,field,index,type,key,text,description,selection,label)=>{
      const row={node:{_key:key,title:text,explanation:description||''},type,parent:parent.node,field,index,path:parent.path+'/'+field+'/'+index,depth:parent.depth+1,diagram:d,ownerKey:owner.node._key,selection,label:label||CYCLE_ROW_TYPES[type].label};
      result.push(row);return row;
    };
    const diagram=add(owner,'cycleDiagrams',index,'cycle','cycle:'+d.id,d.title,d.description,{kind:'diagram'});diagram.childCount=d.nodes.length;
    for(const [i,n]of d.nodes.entries()){
      const node=add(diagram,'nodes',i,'cycleNode',`cycle:${d.id}:node:${n.id}`,n.text,n.description,{kind:'node',id:n.id},CYCLE_KINDS[n.kind]);node.childCount=n.details.length;
      const visit=(items,parent,field)=>items.forEach((item,j)=>{const row=add(parent,field,j,item.kind==='behavior'?'cycleBehavior':'cycleSpecification',`cycle:${d.id}:detail:${item.id}`,item.text,'',{kind:'detail',nodeId:n.id,id:item.id});row.childCount=item.children.length;visit(item.children,row,'children');});
      visit(n.details,node,'details');
    }
  }
  return result;
}
export function pruneCycleOwners(rows,cycles){const owners=new Set(rows.filter(r=>CYCLE_OWNERS.has(r.type)).map(r=>r.node._key)),removed=[];for(const [key,list]of Object.entries(cycles||{}))if(!owners.has(key)){removed.push(...list);delete cycles[key];}return removed;}
export function cycleGeometry(d){
  const {width:w,height:h}=CYCLE_NODE,nodes=new Map(d.nodes.map(n=>[n.id,n])),counts=new Map();
  const edges=d.edges.map(e=>{
    const a=nodes.get(e.source),b=nodes.get(e.target),pair=e.source+'>'+e.target,index=counts.get(pair)||0;counts.set(pair,index+1);
    if(!a||!b)return null;
    let p0,p1,p2,p3;
    if(a===b){const top=Math.max(16,a.y-85-index*30);p0=[a.x+w*.35,a.y];p1=[p0[0],top];p2=[Math.max(16,a.x-85),top];p3=[a.x,a.y+h/2];}
    else if(Math.abs(b.y-a.y)>h+30&&Math.abs(b.x-a.x)>w/2){const right=b.x>a.x;p0=[a.x+w/2,a.y+(b.y>a.y?h:0)];p3=[b.x+(right?0:w),b.y+h/2];p1=[p0[0],p3[1]];p2=[p3[0]+(right?-70:70),p3[1]];}
    else if(b.x<a.x-30){const top=Math.max(16,Math.min(a.y,b.y)-85-index*30);p0=[a.x+w/2,a.y];p1=[a.x+w/2,top];p2=[b.x+w/2,top];p3=[b.x+w/2,b.y];}
    else if(Math.abs(b.x-a.x)<30){const down=b.y>a.y;p0=[a.x+w/2,a.y+(down?h:0)];p3=[b.x+w/2,b.y+(down?0:h)];p1=[p0[0]+index*55,(p0[1]+p3[1])/2];p2=[p3[0]+index*55,p1[1]];}
    else {p0=[a.x+w,a.y+h/2];p3=[b.x,b.y+h/2];const bend=Math.max(12,Math.abs(p3[0]-p0[0])*.45);p1=[p0[0]+bend,p0[1]-index*70];p2=[p3[0]-bend,p3[1]-index*70];}
    const mid=[0,1].map(k=>p0[k]/8+3*p1[k]/8+3*p2[k]/8+p3[k]/8);
    const shortForward=a!==b&&b.x>=a.x+w&&b.x-(a.x+w)<140&&Math.abs(a.y-b.y)<=h+30;
    return {...e,path:`M${p0} C${p1} ${p2} ${p3}`,labelX:mid[0],labelY:shortForward?Math.max(12,Math.min(a.y,b.y)-18):mid[1]-9};
  }).filter(Boolean);
  return {edges,width:Math.max(1000,...d.nodes.map(n=>n.x+w+220)),height:Math.max(620,...d.nodes.map(n=>n.y+h+180))};
}
