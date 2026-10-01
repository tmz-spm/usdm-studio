import Ajv from 'ajv';
import schema from '../schema/document.schema.json';
import {CYCLE_OWNERS,validateCycleMap} from './cycles.js';

export const TYPES = {
  document: {label:'文書', child:{categories:'category'}},
  category: {label:'カテゴリ', child:{requirements:'requirement'}},
  requirement: {label:'要求', child:{specificationGroups:'specificationGroup',requirementGroups:'requirementGroup'}},
  requirementGroup: {label:'要求グループ', child:{subRequirements:'subRequirement'}},
  subRequirement: {label:'下位要求', child:{specificationGroups:'specificationGroup'}},
  specificationGroup: {label:'仕様グループ', child:{specifications:'specification'}},
  specification: {label:'仕様', child:{}}
};
export const AXES = ['時系列分割','構成分割','状態分割','共通分割'];
const check = new Ajv({allErrors:true,strict:false}).compile(schema);
export const clone = value => JSON.parse(JSON.stringify(value));
export const titleOf = n => n.title ?? n.name ?? n.requirement ?? n.specification ?? '';
export const tags = s => [...new Set(s.split(/[,、\n]/).map(x=>x.trim()).filter(Boolean))];
export function walk(doc) {
  const out=[];
  function visit(node,type,parent=null,field=null,index=0,path='',depth=0) {
    out.push({node,type,parent,field,index,path,depth});
    for(const [f,t] of Object.entries(TYPES[type].child))
      (node[f]||[]).forEach((n,i)=>visit(n,t,node,f,i,`${path}/${f}/${i}`,depth+1));
  }
  visit(doc,'document'); return out;
}
export function hydrate(doc) {const d=clone(doc); walk(d).forEach(x=>x.node._key=crypto.randomUUID()); return d;}
export function canonical(doc) {return JSON.parse(JSON.stringify(doc,(k,v)=>k==='_key'?undefined:v));}
export function validate(doc) {
  const value=canonical(doc);
  check(value);
  const errors=(check.errors||[]).map(e=>`${e.instancePath||'/'}: ${e.message}${e.params.additionalProperty?' ('+e.params.additionalProperty+')':''}${e.params.missingProperty?' ('+e.params.missingProperty+')':''}`);
  if(errors.length) return {errors,warnings:[]};
  const rows=walk(value), ids=new Set(), reqs=new Set(), groups=new Map(), warnings=[];
  for(const {node:n,type:t,path} of rows) {
    if(n.id){if(ids.has(n.id)) errors.push(`${path}/id: ID「${n.id}」が重複しています。`); ids.add(n.id);}
    if(t==='requirement'||t==='subRequirement') reqs.add(n.id);
    if(t==='specificationGroup') groups.set(n.name,(groups.get(n.name)||0)+1);
    if(t==='requirementGroup'&&n.subRequirements.length===1) {
      const c=n.subRequirements[0];
      if(c.reason||c.explanation) warnings.push(`${path}: 下位要求が1つの「強制2層」では、理由と説明を空白にする記法が推奨されています。`);
    }
  }
  for(const r of value.requirementRelations||[]) for(const f of ['sourceId','targetId'])
    if(!reqs.has(r[f])) warnings.push(`要求関連: ${r[f]} は文書内にありません。`);
  for(const r of value.specificationGroupRelations||[]) for(const f of ['sourceName','targetName']) {
    if(!groups.has(r[f])) warnings.push(`仕様グループ関連: ${r[f]} は文書内にありません。`);
    else if(groups.get(r[f])>1) warnings.push(`仕様グループ関連: ${r[f]} は複数あり、参照が曖昧です。`);
  }
  return {errors,warnings};
}
export function parseInput(text) {
  const raw=JSON.parse(text.replace(/^\uFEFF/,''));
  const project=raw?.format==='usdm-studio-project';
  if(project && ![1,2].includes(raw.projectVersion)) throw Error('未対応のプロジェクト形式です。');
  const d=project?raw.document:raw;
  // Validate the original, before removing any internal keys.
  if(!check(d)) throw Error((check.errors||[]).map(e=>`${e.instancePath||'/'} ${e.message}`).join('\n'));
  const result=validate(d); if(result.errors.length) throw Error(result.errors.join('\n'));
  const doc=hydrate(d), labels={},cycles={};
  if(project) {
    if(!raw.labels||typeof raw.labels!=='object'||Array.isArray(raw.labels)) throw Error('labels はパスとラベル配列のオブジェクトにしてください。');
    const byPath=new Map(walk(doc).map(x=>[x.path,x]));
    for(const [p,ls] of Object.entries(raw.labels)) {
      if(!byPath.has(p)||!Array.isArray(ls)||ls.some(x=>typeof x!=='string'||!x.trim())) throw Error(`自由ラベルの参照が不正です: ${p}`);
      labels[byPath.get(p).node._key]=[...new Set(ls)];
    }
    if(raw.projectVersion===2){
      if(!raw.cycleDiagrams||typeof raw.cycleDiagrams!=='object'||Array.isArray(raw.cycleDiagrams))throw Error('cycleDiagrams は所属先とサイクル図配列のオブジェクトにしてください。');
      for(const [path,diagrams]of Object.entries(raw.cycleDiagrams)){const owner=byPath.get(path);if(!owner||!CYCLE_OWNERS.has(owner.type))throw Error('サイクル図の所属先が不正です: '+path);cycles[owner.node._key]=diagrams;}
      validateCycleMap(walk(doc),cycles);
    }else if(Object.hasOwn(raw,'cycleDiagrams'))throw Error('サイクル図を含むプロジェクトは projectVersion を2にしてください。');
  }
  return {doc,labels,cycles};
}
export function projectData(doc,labels,cycles={}) {
  const rows=walk(doc),paths={},diagrams={};validateCycleMap(rows,cycles);
  for(const x of rows){if(labels[x.node._key]?.length)paths[x.path]=labels[x.node._key];if(cycles[x.node._key]?.length)diagrams[x.path]=clone(cycles[x.node._key]);}
  const hasCycles=Object.keys(diagrams).length>0;
  return {format:'usdm-studio-project',projectVersion:hasCycles?2:1,document:canonical(doc),labels:paths,...(hasCycles?{cycleDiagrams:diagrams}:{})};
}
export function uniqueId(doc,prefix) {
  const ids=new Set(walk(doc).map(x=>x.node.id)); let i=1;
  while(ids.has(prefix+String(i).padStart(2,'0'))) i++;
  return prefix+String(i).padStart(2,'0');
}
export function createNode(type,doc) {
  const id=prefix=>uniqueId(doc,prefix);
  const n= type==='category'?{name:'＜新しいカテゴリ＞',requirements:[]}:
    type==='requirement'?{id:id('R'),requirement:'新しい要求',reason:'',keywords:[]}:
    type==='subRequirement'?{id:id('R_SUB'),requirement:'新しい下位要求',reason:''}:
    type==='specification'?{id:id('S'),specification:'新しい仕様',verified:[false,false,false]}:
    type==='specificationGroup'?{name:'＜新しい仕様グループ＞',specifications:[createNode('specification',doc)]}:
    {name:'＜新しい要求グループ＞',subRequirements:[createNode('subRequirement',doc)]};
  n._key=crypto.randomUUID(); return n;
}
export function selectedRoots(doc,keys) {
  const rows=walk(doc), set=new Set(keys);
  return rows.filter(r=>set.has(r.node._key)&&r.type!=='document'&&!rows.some(a=>a!==r&&set.has(a.node._key)&&r.path.startsWith(a.path+'/')));
}
export function pruneOptional(doc) {
  for(const {node} of walk(doc)) if(node.specificationGroups?.length===0) delete node.specificationGroups;
}
export function moveNodes(doc,keys,targetKey,position='inside') {
  const rows=walk(doc), target=rows.find(r=>r.node._key===targetKey), roots=selectedRoots(doc,keys);
  if(!target||!roots.length) throw Error('移動する要素と移動先を選んでください。');
  if(roots.some(r=>target.path===r.path||target.path.startsWith(r.path+'/'))) throw Error('自分自身や子孫には移動できません。');
  const parent=position==='inside'?target.node:target.parent;
  const parentType=position==='inside'?target.type:rows.find(r=>r.node===parent)?.type;
  if(!parent) throw Error('文書の外には移動できません。');
  if(new Set(roots.map(r=>r.type)).size!==1) throw Error('一括移動は同じ種類の要素を選んでください。');
  const type=roots[0].type;
  const field=Object.entries(TYPES[parentType].child).find(([,t])=>t===type)?.[0];
  if(!field||(position!=='inside'&&target.type!==type)) throw Error('この階層には配置できません。対応する親または同じ種類の要素を指定してください。');
  for(const r of roots) r.parent[r.field].splice(r.parent[r.field].indexOf(r.node),1);
  const arr=parent[field]??(parent[field]=[]);
  let idx=position==='inside'?arr.length:arr.indexOf(target.node)+(position==='after'?1:0);
  arr.splice(idx,0,...roots.map(r=>r.node)); pruneOptional(doc);
}
export function removeNodes(doc,keys) {
  const roots=selectedRoots(doc,keys), rows=walk(doc);
  const removed=rows.filter(x=>roots.some(r=>x.path===r.path||x.path.startsWith(r.path+'/')));
  const ids=new Set(removed.filter(x=>['requirement','subRequirement'].includes(x.type)).map(x=>x.node.id));
  for(const r of roots) r.parent[r.field].splice(r.parent[r.field].indexOf(r.node),1);
  pruneOptional(doc);
  const remainingGroups=new Set(walk(doc).filter(x=>x.type==='specificationGroup').map(x=>x.node.name));
  const names=new Set(removed.filter(x=>x.type==='specificationGroup'&&!remainingGroups.has(x.node.name)).map(x=>x.node.name));
  if(doc.requirementRelations) doc.requirementRelations=doc.requirementRelations.filter(r=>!ids.has(r.sourceId)&&!ids.has(r.targetId));
  if(doc.specificationGroupRelations) doc.specificationGroupRelations=doc.specificationGroupRelations.filter(r=>!names.has(r.sourceName)&&!names.has(r.targetName));
  return removed.map(x=>x.node._key);
}
export function insertSubRequirementOnEdge(doc,targetKey) {
  const r=walk(doc).find(x=>x.node._key===targetKey);
  const parentRow=r&&walk(doc).find(x=>x.node===r.parent);
  if(r?.type!=='specificationGroup'||parentRow?.type!=='requirement')throw Error('下位要求の挿入は、要求から仕様グループへの枝で行えます。');
  const group=createNode('requirementGroup',doc),sub=group.subRequirements[0];
  group.name='＜要求の分割＞';sub.specificationGroups=[r.node];
  r.parent.specificationGroups.splice(r.index,1);
  (r.parent.requirementGroups??=[]).push(group);pruneOptional(doc);
  return sub._key;
}
export class Store {
  constructor(doc,labels={},cycles={}) {this.doc=doc;this.labels=labels;this.cycles=cycles;this.past=[];this.future=[];}
  snapshot(){return clone({doc:this.doc,labels:this.labels,cycles:this.cycles});}
  transaction(fn) {
    const before=this.snapshot();
    try {
      fn(this); pruneOptional(this.doc);
      const result=validate(this.doc);
      if(result.errors.length) throw Error('変更できません。必須の子要素が空になる場合はグループごと操作してください。\n'+result.errors.join('\n'));
      const owners=new Set(walk(this.doc).filter(r=>CYCLE_OWNERS.has(r.type)).map(r=>r.node._key));
      for(const key of Object.keys(before.cycles))if(!owners.has(key))delete this.cycles[key];
      validateCycleMap(walk(this.doc),this.cycles);
      this.doc.metadata??={};this.doc.metadata.modified=new Date().toISOString();
      this.past.push(before);if(this.past.length>100)this.past.shift();this.future=[];
    } catch(e){Object.assign(this,before);throw e;}
  }
  undo(){if(!this.past.length)return false;this.future.push(this.snapshot());Object.assign(this,this.past.pop());return true;}
  redo(){if(!this.future.length)return false;this.past.push(this.snapshot());Object.assign(this,this.future.pop());return true;}
}
export function emptyDocument(title='新しい要求仕様書') {
  return {version:'1.1.0',title,metadata:{created:new Date().toISOString()},categories:[{name:'＜機能要求＞',requirements:[]}]};
}
