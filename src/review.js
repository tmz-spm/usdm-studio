import {walk,TYPES,titleOf,clone,selectedRoots} from './model.js';
import {cloneCycle} from './cycles.js';

export function reviewDocument(doc) {
  const rs=walk(doc),issues=[];
  const add=(r,code,severity,message)=>issues.push({key:r.node._key,path:r.path,type:r.type,id:r.node.id||'',title:titleOf(r.node),code,severity,message});
  const bodies=new Map();
  for(const r of rs){
    const n=r.node,isReq=['requirement','subRequirement'].includes(r.type);
    const forced=r.type==='subRequirement'&&r.parent.subRequirements.length===1;
    if(isReq&&!forced&&!n.reason?.trim())add(r,'reason','attention','理由が未記入です。');
    if(isReq&&!rs.some(x=>x.type==='specification'&&x.path.startsWith(r.path+'/')))add(r,'coverage','attention','具体化する仕様がまだありません。');
    if((isReq||r.type==='specification')&&!titleOf(n).trim())add(r,'empty','attention','本文が空白です。');
    if((isReq||r.type==='specification')&&/^新しい(?:要求|下位要求|仕様)$/.test(titleOf(n).trim()))add(r,'placeholder','attention','追加時の初期文言が残っています。');
    if(/\b(?:TBD|TODO)\b|未定|要確認/i.test([titleOf(n),n.reason,n.explanation].join(' ')))add(r,'pending','attention','未定・要確認・TODO/TBD の記述があります。');
    if(r.type==='specification'){
      const v=n.verified||[false,false,false];
      if(!v[0])add(r,'unreviewed','review','レビューのチェックが付いていません。');
      if(v[1]&&!v[0]||v[2]&&(!v[0]||!v[1]))add(r,'status','attention','レビュー・実装・テストのチェック順を確認してください。');
    }
    if(isReq||r.type==='specification'){
      const text=titleOf(n).trim().replace(/\s+/g,' ');if(text){const k=r.type+':'+text;(bodies.get(k)||bodies.set(k,[]).get(k)).push(r);}
    }
  }
  for(const group of bodies.values())if(group.length>1)for(const r of group)add(r,'duplicate','attention','同じ種類に同一の本文があります：'+group.filter(x=>x!==r).map(x=>x.node.id).join(', '));
  const reqs=new Map(rs.filter(x=>['requirement','subRequirement'].includes(x.type)).map(x=>[x.node.id,x]));
  const groups=new Map();for(const r of rs.filter(x=>x.type==='specificationGroup'))(groups.get(r.node.name)||groups.set(r.node.name,[]).get(r.node.name)).push(r);
  for(const rel of doc.requirementRelations||[])if(!reqs.has(rel.sourceId)||!reqs.has(rel.targetId))add(reqs.get(rel.sourceId)||reqs.get(rel.targetId)||rs[0],'reference','attention',`要求関連の参照先を確認：${rel.sourceId} → ${rel.targetId}`);
  for(const rel of doc.specificationGroupRelations||[])for(const f of ['sourceName','targetName'])if(groups.get(rel[f])?.length!==1)add(groups.get(rel[f])?.[0]||rs[0],'reference','attention',`仕様グループ関連の参照先が未定義または同名です：${rel[f]}`);
  return issues;
}

export function duplicateNodes(doc,labels,keys,{resetVerified=true,cycles={}}={}) {
  const roots=selectedRoots(doc,keys);if(!roots.length)throw Error('複製する要素を選んでください。文書全体は複製できません。');
  const ids=new Set(walk(doc).map(r=>r.node.id).filter(Boolean));
  const groupNames=new Map();for(const r of walk(doc).filter(r=>r.type.endsWith('Group')||r.type==='category'))(groupNames.get(r.type)||groupNames.set(r.type,new Set()).get(r.type)).add(r.node.name);
  const added=[];
  function copy(n,type){
    const oldKey=n._key;n._key=crypto.randomUUID();if(labels[oldKey]?.length)labels[n._key]=clone(labels[oldKey]);
    if(cycles[oldKey]?.length)cycles[n._key]=cycles[oldKey].map(cloneCycle);
    if(n.id){const base=n.id+'_copy';let id=base,i=2;while(ids.has(id))id=base+i++;n.id=id;ids.add(id);}
    if(n.name){const names=groupNames.get(type)||new Set();const base=n.name.replace(/^＜|＞$/g,'');let name=`＜${base}（コピー）＞`,i=2;while(names.has(name))name=`＜${base}（コピー${i++}）＞`;n.name=name;names.add(name);groupNames.set(type,names);}
    if(type==='specification'&&resetVerified)n.verified=[false,false,false];
    for(const [field,t]of Object.entries(TYPES[type].child))for(const child of n[field]||[])copy(child,t);
  }
  for(const r of roots){const n=clone(r.node);copy(n,r.type);r.parent[r.field].splice(r.parent[r.field].indexOf(r.node)+1,0,n);added.push(n._key);}
  return added;
}

const stable=v=>v===undefined?'∅':JSON.stringify(sortValue(v));
function sortValue(v){if(Array.isArray(v))return v.map(sortValue);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortValue(v[k])]));return v;}
function records(doc,labels,cycles={}){
  const result=new Map(),byNode=new Map(),counts=new Map();
  for(const r of walk(doc)){
    const parent=byNode.get(r.parent)?.identity||'',n=r.node;
    let identity;
    if(r.type==='document')identity='document';
    else if(n.id)identity=JSON.stringify([r.type,'id',n.id]);
    else {const base=JSON.stringify([parent,r.type,n.name]);const count=counts.get(base)||0;counts.set(base,count+1);identity=base+'#'+count;}
    const own=Object.fromEntries(Object.entries(n).filter(([k])=>k!=='_key'&&!(k in TYPES[r.type].child)));
    if(r.type==='document'&&own.metadata){own.metadata={...own.metadata};delete own.metadata.modified;if(!Object.keys(own.metadata).length)delete own.metadata;}
    own['自由ラベル']=labels[n._key]||[];
    if(cycles[n._key]?.length)own['サイクル図']=cycles[n._key];
    const rec={...r,identity,parentIdentity:parent,own,display:n.id||titleOf(n),parentTitle:r.parent?titleOf(r.parent):''};
    result.set(identity,rec);byNode.set(n,rec);
  }
  return result;
}
export function compareDocuments(before,after) {
  const old=records(before.doc,before.labels||{},before.cycles||{}),now=records(after.doc,after.labels||{},after.cycles||{}),diff=[];
  const shared=new Set([...old.keys()].filter(k=>now.has(k)));
  const ranks=map=>{
    const parents=new Map(),result=new Map();
    for(const [k,r]of map)if(shared.has(k)&&old.get(k).parentIdentity===now.get(k).parentIdentity){const group=r.parentIdentity+'|'+r.field;const list=parents.get(group)||[];result.set(k,list.length);list.push(k);parents.set(group,list);}
    return result;
  };
  const oldRank=ranks(old),newRank=ranks(now);
  for(const [k,r]of now){
    const b=old.get(k);
    const base={key:r.node._key,type:r.type,id:r.node.id||'',title:titleOf(r.node),path:r.path,beforePath:b?.path};
    if(!b){diff.push({...base,kind:'added',fields:[]});continue;}
    const fields=[...new Set([...Object.keys(b.own),...Object.keys(r.own)])].filter(f=>stable(b.own[f])!==stable(r.own[f])).map(field=>({field,before:b.own[field],after:r.own[field]}));
    if(fields.length)diff.push({...base,kind:'changed',fields});
    if(b.parentIdentity!==r.parentIdentity||b.field!==r.field)diff.push({...base,kind:'moved',fields:[{field:'所属先',before:b.parentTitle,after:r.parentTitle}]});
    else if(oldRank.get(k)!==newRank.get(k))diff.push({...base,kind:'reordered',fields:[{field:'並び順',before:b.index+1,after:r.index+1}]});
  }
  for(const [k,b]of old)if(!now.has(k))diff.push({kind:'removed',key:null,type:b.type,id:b.node.id||'',title:titleOf(b.node),path:b.path,fields:[]});
  return diff;
}
