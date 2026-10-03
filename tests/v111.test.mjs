import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,emptyDocument,hydrate,walk,projectData,parseInput} from './model.bundle.mjs';
import {createCycle,createCycleNode,createDetail,cycleRows,cycleRules,cycleReferenceIssues,validateCycleMap,insertCycleHierarchy,appendCycleNode,appendCycleHierarchy} from './cycles.bundle.mjs';
import {duplicateNodes,compareDocuments} from './review.bundle.mjs';

function fixture(){const doc=hydrate(emptyDocument()),a=createCycle('試合'),b=createCycle('復活'),n=createCycleNode('input'),ref=createCycleNode('reference'),global=createDetail('rule'),local=createDetail('rule');n.text='出撃方法を選ぶ';ref.reference=b.id;global.text='同点のまま終了した場合は引き分け';local.text='準備中は選択を変更できる';n.details=[local];a.details=[global];a.nodes=[n,ref];return {doc,labels:{},cycles:{[doc.categories[0]._key]:[a,b]},a,b,n,ref,global,local};}

test('new game-flow concepts round-trip in project v3 while ordinary cycles keep v2',()=>{
  const f=fixture(),p=projectData(f.doc,f.labels,f.cycles);assert.equal(p.projectVersion,3);assert.deepEqual(projectData(...Object.values(parseInput(JSON.stringify(p)))),p);
  f.a.nodes=[createCycleNode('phase')];delete f.a.details;assert.equal(projectData(f.doc,f.labels,f.cycles).projectVersion,2);
  f.a.nodes.push(createCycleNode('event'));assert.equal(projectData(f.doc,f.labels,f.cycles).projectVersion,3);
  p.projectVersion=2;assert.throws(()=>parseInput(JSON.stringify(p)),/projectVersion.*3/);
});
test('diagram and node rules appear once at their applicable hierarchy without becoming transition nodes',()=>{
  const f=fixture(),rows=cycleRows(walk(f.doc),f.cycles),global=rows.find(r=>r.selection.id===f.global.id),local=rows.find(r=>r.selection.id===f.local.id);
  assert.equal(global.type,'cycleRule');assert.equal(global.parent._key,'cycle:'+f.a.id);assert.equal(global.selection.nodeId,'');assert.equal(local.parent._key,`cycle:${f.a.id}:node:${f.n.id}`);assert.equal(local.selection.nodeId,f.n.id);
  assert.deepEqual(cycleRules(f.a).map(r=>[r.item.text,r.scope]),[[f.global.text,'図全体'],[f.local.text,f.n.text]]);assert.equal(f.a.nodes.length,2);assert.equal(f.a.edges.length,0);
  const result=insertCycleHierarchy(walk(f.doc),f.cycles,global.node._key,{position:'wrap',kind:'specification',text:'勝敗について'});assert.equal(result.selection.nodeId,'');assert.equal(f.a.details[0].children[0].id,f.global.id);assert.equal(validateCycleMap(walk(f.doc),f.cycles),true);
});
test('invalid global rules and misplaced reference settings roll back without partial data',()=>{
  const changes=[f=>{f.a.details=null;},f=>{f.global.text='';},f=>{f.global.id=f.local.id;},f=>{f.ref.reference={id:f.b.id};},f=>{f.n.reference=f.b.id;},f=>{f.global.children=[{...f.local,kind:'unknown'}];}];
  for(const change of changes){const f=fixture(),s=new Store(f.doc,f.labels,f.cycles),before=s.snapshot();assert.throws(()=>s.transaction(()=>change(f)));assert.deepEqual(s.snapshot(),before);assert.equal(s.past.length,0);}
});
test('duplicating a group remaps references between copied diagrams and retains external references',()=>{
  const f=fixture(),external=createCycle('別の共通図');f.doc.categories.push({...structuredClone(f.doc.categories[0]),_key:crypto.randomUUID(),name:'＜共通＞'});f.cycles[f.doc.categories[1]._key]=[external];const out=createCycleNode('reference');out.reference=external.id;f.a.nodes.push(out);const back=createCycleNode('reference');back.reference=f.a.id;f.b.nodes.push(back);
  const keys=duplicateNodes(f.doc,f.labels,[f.doc.categories[0]._key],{cycles:f.cycles}),[a,b]=f.cycles[keys[0]];
  assert.equal(a.nodes[1].reference,b.id);assert.equal(b.nodes[0].reference,a.id);assert.equal(a.nodes[2].reference,external.id);assert.notEqual(a.details[0].id,f.global.id);assert.notEqual(a.nodes[0].details[0].id,f.local.id);assert.deepEqual(cycleReferenceIssues(f.cycles),[]);assert.equal(validateCycleMap(walk(f.doc),f.cycles),true);
});
test('removing a referenced diagram preserves the referring specifications and undo restores its target',()=>{
  const f=fixture(),s=new Store(f.doc,f.labels,f.cycles),before=s.snapshot();s.transaction(s=>{s.cycles[f.doc.categories[0]._key]=[f.a];});assert.equal(cycleReferenceIssues(s.cycles).length,1);assert.equal(f.ref.reference,f.b.id);assert.equal(validateCycleMap(walk(s.doc),s.cycles),true);assert.equal(cycleReferenceIssues(parseInput(JSON.stringify(projectData(s.doc,s.labels,s.cycles))).cycles).length,1);
  s.undo();assert.deepEqual(s.snapshot(),before);assert.deepEqual(cycleReferenceIssues(s.cycles),[]);s.redo();assert.equal(cycleReferenceIssues(s.cycles).length,1);
});
test('global rule edits participate in comparisons and undo with their nested specifications',()=>{
  const f=fixture(),s=new Store(f.doc,f.labels,f.cycles),before=s.snapshot();s.transaction(s=>{s.cycles[f.doc.categories[0]._key][0].details[0].text='引き分けの場合は延長戦を行わない';});assert.equal(compareDocuments(before,s.snapshot()).length,1);s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.match(s.cycles[f.doc.categories[0]._key][0].details[0].text,/延長戦/);
});
test('terminal append adds a connected node atomically and creates appropriate children in hierarchy projections',()=>{
  const f=fixture(),s=new Store(f.doc,f.labels,f.cycles),before=s.snapshot();let result;
  s.transaction(()=>{result=appendCycleNode(f.a,f.n.id,{kind:'event',text:'入力完了',label:'決定を押す'});});const added=f.a.nodes.find(n=>n.id===result.selection.id);assert.equal(added.kind,'event');assert.equal(f.a.edges[0].source,f.n.id);assert.equal(f.a.edges[0].target,added.id);assert.equal(f.a.edges[0].label,'決定を押す');s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.equal(s.cycles[f.doc.categories[0]._key][0].edges.length,1);
  const a=s.cycles[f.doc.categories[0]._key][0];result=appendCycleHierarchy(walk(s.doc),s.cycles,`cycle:${a.id}:detail:${f.global.id}`,{kind:'specification',text:'引き分け時の報酬'});assert.equal(result.selection.nodeId,'');assert.equal(a.details[0].children[0].text,'引き分け時の報酬');result=appendCycleHierarchy(walk(s.doc),s.cycles,'cycle:'+f.b.id,{kind:'state',text:'復活待ち'});assert.equal(s.cycles[f.doc.categories[0]._key][1].nodes[0].id,result.selection.id);assert.equal(validateCycleMap(walk(s.doc),s.cycles),true);
  const stable=s.snapshot();assert.throws(()=>s.transaction(()=>appendCycleNode(a,'missing')));assert.deepEqual(s.snapshot(),stable);
});
