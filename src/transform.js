import schema from '../schema/document.schema.json';
import {TYPES,clone,walk,titleOf,createNode,uniqueId,pruneOptional,validate} from './model.js';

const def=t=>schema.definitions[t[0].toUpperCase()+t.slice(1)];
const idPattern=/^[A-Za-z][A-Za-z0-9_-]*$/;
function rowOf(doc,key){const r=walk(doc).find(x=>x.node._key===key);if(!r||r.type==='document')throw Error('文書以外の要素を選択してください。');return r;}
function chainTo(from,to){
  const queue=[[from,[]]];
  while(queue.length){const [type,path]=queue.shift();for(const next of Object.values(TYPES[type].child)){if(next===to)return path;queue.push([next,[...path,next]]);}}
  return null;
}
function location(rs,r){return rs.filter(a=>a===r||r.path.startsWith(a.path+'/')).map(a=>a.node.id||titleOf(a.node)).join(' › ');}
export function conversionOptions(doc,key,targetType){
  if(!TYPES[targetType]||targetType==='document')return [];
  const source=rowOf(doc,key),rs=walk(doc);
  return rs.filter(r=>r.path!==source.path&&!r.path.startsWith(source.path+'/')).map(r=>{
    const chain=chainTo(r.type,targetType);if(chain===null)return null;
    return {parentKey:r.node._key,chain,label:location(rs,r)+(chain.length?' ／ '+chain.map(t=>TYPES[t].label).join(' → ')+'を新規作成':''),rank:r.node===source.parent?-100:source.path.startsWith(r.path+'/')?-r.depth:100+chain.length};
  }).filter(Boolean).sort((a,b)=>a.rank-b.rank);
}
function cleanupEmpty(doc){
  const cleaned=[];let again=true;
  while(again){again=false;for(const r of walk(doc).reverse())if(r.type==='specificationGroup'&&!r.node.specifications.length||r.type==='requirementGroup'&&!r.node.subRequirements.length){cleaned.push({key:r.node._key,title:titleOf(r.node),type:r.type});r.parent[r.field].splice(r.parent[r.field].indexOf(r.node),1);again=true;}}
  pruneOptional(doc);return cleaned;
}
function complete(before,after,details={}){
  const old=walk(before.doc),now=walk(after.doc),keys=new Set(now.map(r=>r.node._key));
  const removed=old.filter(r=>!keys.has(r.node._key)).map(r=>({key:r.node._key,type:r.type,id:r.node.id||'',title:titleOf(r.node)}));
  for(const r of removed)delete after.labels[r.key];
  const reqIds=new Set(now.filter(r=>['requirement','subRequirement'].includes(r.type)).map(r=>r.node.id));
  const groupNames=new Set(now.filter(r=>r.type==='specificationGroup').map(r=>r.node.name));
  const goneReq=new Set(old.filter(r=>['requirement','subRequirement'].includes(r.type)&&!reqIds.has(r.node.id)).map(r=>r.node.id));
  const goneGroups=new Set(old.filter(r=>r.type==='specificationGroup'&&!groupNames.has(r.node.name)).map(r=>r.node.name));
  let relationsRemoved=0;
  for(const [field,source,target,gone]of [['requirementRelations','sourceId','targetId',goneReq],['specificationGroupRelations','sourceName','targetName',goneGroups]])if(after.doc[field]){const original=after.doc[field];after.doc[field]=original.filter(r=>!gone.has(r[source])&&!gone.has(r[target]));relationsRemoved+=original.length-after.doc[field].length;}
  pruneOptional(after.doc);const check=validate(after.doc);if(check.errors.length)throw Error('この変更では必須の階層または子要素が不足します。所属先・削除範囲を変更してください。\n'+check.errors.join('\n'));
  return {...details,state:after,removed,relationsRemoved,labelsRemoved:removed.filter(r=>before.labels[r.key]?.length).map(r=>({...r,labels:before.labels[r.key]}))};
}
export function planConversion(state,key,targetType,parentKey){
  const before=clone(state),after=clone(state),source=rowOf(after.doc,key),old=clone(source.node);
  if(source.type===targetType)throw Error('変更先の種類を選んでください。');
  const option=conversionOptions(after.doc,key,targetType).find(o=>o.parentKey===parentKey);if(!option)throw Error('変更先の種類を置ける所属先を選んでください。');
  const targetSchema=def(targetType),allowed=targetSchema.properties;
  const n={_key:key},retained=[],dropped=[],changes=[],created=[];
  const reserved=new Set(walk(before.doc).map(r=>r.node.id).filter(Boolean));
  const fresh=type=>{const value=createNode(type,after.doc);const visit=(node,t)=>{if(node.id){if(reserved.has(node.id)){const prefix=t==='specification'?'S':t==='subRequirement'?'R_SUB':'R';let i=1;while(reserved.has(prefix+String(i).padStart(2,'0')))i++;node.id=prefix+String(i).padStart(2,'0');}reserved.add(node.id);}for(const [f,childType]of Object.entries(TYPES[t].child))for(const c of node[f]||[])visit(c,childType);};visit(value,type);return value;};
  for(const [field,value]of Object.entries(old)){
    if(field==='_key')continue;
    if(field in allowed){n[field]=value;retained.push(field);}else dropped.push(field);
  }
  const main=targetType==='requirement'||targetType==='subRequirement'?'requirement':targetType==='specification'?'specification':'name';
  const oldMain=source.type==='requirement'||source.type==='subRequirement'?'requirement':source.type==='specification'?'specification':'name';
  if(!(main in n)){
    let text=titleOf(old);if(main==='name'){text=text.replace(/^＜|＞$/g,'').replace(/[\r\n]+/g,' ');text=`＜${text||'新しい'+TYPES[targetType].label}＞`;}
    else if(oldMain==='name')text=text.replace(/^＜|＞$/g,'');
    if(main==='requirement'&&!text)text='新しい要求';n[main]=text;const names={requirement:'要求本文',specification:'仕様本文',name:'名前'};changes.push(`${names[oldMain]}を${names[main]}へ引き継ぎ`);
    const i=dropped.indexOf(oldMain);if(i>=0)dropped.splice(i,1);
  }
  if(allowed.id&&('id'in n||targetSchema.required?.includes('id'))){
    if(!n.id||(targetType!=='specification'&&!idPattern.test(n.id))){const previous=n.id;n.id=uniqueId(after.doc,targetType==='specification'?'S':targetType==='category'?'C':'R');reserved.add(n.id);changes.push(previous?`ID「${previous}」は新しい種類の形式に合わないため「${n.id}」へ変更`:`ID「${n.id}」を新規作成`);}
  }
  if(targetType==='requirement'&&!('reason'in n)){n.reason='';changes.push('必須の理由欄を空欄で作成');}
  // Required child arrays get a valid initial child, never an empty placeholder array.
  for(const f of targetSchema.required||[])if(!(f in n)&&TYPES[targetType].child[f]){const childType=TYPES[targetType].child[f];if(allowed[f].minItems){const child=fresh(childType);n[f]=[child];created.push(TYPES[childType].label+'（初期要素）');}else n[f]=[];}
  source.parent[source.field].splice(source.index,1);
  let parent=walk(after.doc).find(r=>r.node._key===parentKey)?.node;
  const parentRow=walk(after.doc).find(r=>r.node===parent);if(!parentRow)throw Error('所属先が見つかりません。');
  let parentType=parentRow.type;
  for(const t of option.chain){
    const field=Object.entries(TYPES[parentType].child).find(([,type])=>type===t)[0];
    const wrapper=fresh(t);for(const f of Object.keys(TYPES[t].child))delete wrapper[f];
    const list=parent[field]??=[];const index=parent===source.parent&&field===source.field?source.index:list.length;list.splice(index,0,wrapper);
    created.push(TYPES[t].label+'「'+titleOf(wrapper)+'」');parent=wrapper;parentType=t;
  }
  const field=Object.entries(TYPES[parentType].child).find(([,t])=>t===targetType)[0],list=parent[field]??=[];
  const index=parent===source.parent&&field===source.field?source.index:list.length;list.splice(index,0,n);
  const cleaned=cleanupEmpty(after.doc);
  return complete(before,after,{kind:'conversion',sourceType:source.type,targetType,key,retained,dropped,changes,created,cleaned,old,target:n,destination:option.label});
}

function preserveInfo(doc,keys){
  const rs=walk(doc),set=new Set(keys);if(set.has(doc._key))throw Error('文書全体は削除できません。');
  const selected=rs.filter(r=>set.has(r.node._key));if(!selected.length)throw Error('削除するノードを選択してください。');
  const children=new Map(rs.map(r=>[r.node._key,[]]));for(const r of rs)if(r.parent)children.get(r.parent._key).push(r);
  const flatten=r=>set.has(r.node._key)?children.get(r.node._key).flatMap(flatten):[r];
  const promotions=[];for(const parent of rs.filter(r=>!set.has(r.node._key)))for(const child of children.get(parent.node._key))if(set.has(child.node._key))promotions.push({parent,source:child,nodes:flatten(child)});
  return {rs,set,selected,children,flatten,promotions};
}
export function preserveDestinations(doc,keys){
  const info=preserveInfo(doc,keys),front=info.promotions.flatMap(p=>p.nodes),types=[...new Set(front.map(r=>r.type))];
  const direct=info.promotions.every(p=>p.nodes.every(n=>Object.values(TYPES[p.parent.type].child).includes(n.type)));
  return {direct,childCount:front.length,types,selectedCount:info.selected.length};
}
export function planPreserveDelete(state,keys){
  const before=clone(state),after=clone(state),info=preserveInfo(after.doc,keys);
  const options=preserveDestinations(after.doc,keys);
  if(!options.direct)throw Error('削除禁止：選択ノードの親は、残す子の種類を直接持てません。USDMスキーマに適合する階層になる場合だけ実行できます。');
  const targets=new Map(info.rs.filter(r=>!info.set.has(r.node._key)).map(r=>[r.node._key,{}]));
  const append=(parent,n)=>{const field=Object.entries(TYPES[parent.type].child).find(([,t])=>t===n.type)?.[0];if(!field)throw Error('この階層には子を接続できません。');(targets.get(parent.node._key)[field]??=[]).push(n.node);};
  for(const parent of info.rs.filter(r=>!info.set.has(r.node._key)))for(const child of info.children.get(parent.node._key)){
    if(!info.set.has(child.node._key))append(parent,child);
    else for(const n of info.flatten(child))append(parent,n);
  }
  for(const r of info.rs.filter(r=>!info.set.has(r.node._key)))for(const field of Object.keys(TYPES[r.type].child)){const arr=targets.get(r.node._key)[field];if(arr)r.node[field]=arr;else if(field in r.node)r.node[field]=[];}
  return complete(before,after,{kind:'preserve-delete',childCount:options.childCount,cleaned:[],destination:'選択ノードの親へ直接接続',kept:info.promotions.flatMap(p=>p.nodes.map(r=>r.node._key))});
}
