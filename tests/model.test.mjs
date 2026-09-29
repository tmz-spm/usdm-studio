import test from 'node:test';
import assert from 'node:assert/strict';
import {hydrate,validate,canonical,walk,Store,moveNodes,removeNodes,parseInput,projectData,createNode} from './model.bundle.mjs';
import {sample} from './fixture.mjs';

test('sample is schema-valid, including mixed hierarchy',()=>{
  const d=hydrate(sample());assert.deepEqual(validate(d),{errors:[],warnings:[]});
  assert.equal(JSON.stringify(canonical(d)).includes('_key'),false);
});
test('official schema rejects foreign fields, malformed names, IDs, versions and flags',()=>{
  for(const change of [d=>d.version='1.0',d=>d.categories[0].name='機能',d=>d.categories[0].requirements[0].id='1R',d=>d.categories[0].requirements[0].extra=1,d=>d.categories[0].requirements[0].specificationGroups[0].specifications[0].verified=[true]]){
    const d=sample();change(d);assert.throws(()=>parseInput(JSON.stringify(d)));
  }
});
test('duplicate IDs are rejected, external relations are preserved with warning',()=>{
  const d=sample();d.categories[0].requirements[1].id='R01';assert.ok(validate(d).errors.length);
  const x=sample();x.requirementRelations=[{sourceId:'R01',targetId:'EXTERNAL',divisionAxis:'構成分割'}];
  const parsed=parseInput(JSON.stringify(x));assert.equal(validate(parsed.doc).warnings.length,1);
  assert.deepEqual(canonical(parsed.doc),x);
});
test('project round-trip preserves labels for category, requirement and specification',()=>{
  const d=hydrate(sample()),rs=walk(d),labels={};
  for(const r of rs.filter(r=>['category','requirement','specification'].includes(r.type)))labels[r.node._key]=['優先度高','リリース1'];
  const project=projectData(d,labels),restored=parseInput(JSON.stringify(project));
  assert.deepEqual(projectData(restored.doc,restored.labels),project);
  assert.deepEqual(canonical(restored.doc),sample());
});
test('move between parents keeps labels and order, undo and redo restore the complete state',()=>{
  const d=hydrate(sample()),n=d.categories[0].requirements[0],k=n._key,s=new Store(d,{[k]:['label']});
  const before=s.snapshot();s.transaction(s=>moveNodes(s.doc,[k],s.doc.categories[1]._key));
  assert.equal(s.doc.categories[1].requirements.at(-1)._key,k);assert.deepEqual(s.labels[k],['label']);
  const after=s.snapshot();s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.deepEqual(s.snapshot(),after);
});
test('multi-move handles same-array offsets and parent-child co-selection once',()=>{
  const d=hydrate(sample()),cat=d.categories[0],a=cat.requirements[0],b=cat.requirements[1],s=new Store(d);
  s.transaction(s=>moveNodes(s.doc,[a._key],b._key,'after'));assert.equal(cat.requirements[1]._key,a._key);
  s.transaction(s=>moveNodes(s.doc,[a._key,a.specificationGroups[0]._key],d.categories[2]._key));
  assert.equal(d.categories[2].requirements.at(-1)._key,a._key);assert.equal(a.specificationGroups.length,2);
});
test('illegal moves and deletion of last required children roll back without losing data',()=>{
  const s=new Store(hydrate(sample())),before=s.snapshot(),n=s.doc.categories[0].requirements[0];
  assert.throws(()=>s.transaction(s=>moveNodes(s.doc,[n._key],n.specificationGroups[0]._key)));
  assert.deepEqual(s.snapshot(),before);
  const g=s.doc.categories[0].requirements[0].specificationGroups[1];
  assert.throws(()=>s.transaction(s=>removeNodes(s.doc,[g.specifications[0]._key])));
  assert.deepEqual(s.snapshot(),before);assert.equal(s.past.length,0);
});
test('deletion updates relations and optional empty arrays without leaking internal keys',()=>{
  const d=hydrate(sample()),n=d.categories[1].requirements[0];
  d.requirementRelations=[{sourceId:n.id,targetId:'R01',divisionAxis:'構成分割'}];
  d.specificationGroupRelations=[{sourceName:n.specificationGroups[0].name,targetName:'＜空き状況の表示＞',divisionAxis:'状態分割'}];
  const s=new Store(d);s.transaction(s=>removeNodes(s.doc,[n._key]));
  assert.equal(d.requirementRelations.length,0);assert.equal(d.specificationGroupRelations.length,0);
  assert.equal(validate(d).errors.length,0);
});
test('last optional specification group can be removed; required category cannot',()=>{
  const d=hydrate({version:'1.1.0',title:'Test',categories:[{name:'＜機能＞',requirements:[]}]}),s=new Store(d);
  const n=createNode('requirement',d);d.categories[0].requirements.push(n);n.specificationGroups=[createNode('specificationGroup',d)];
  s.transaction(s=>removeNodes(s.doc,[n.specificationGroups[0]._key]));assert.equal(n.specificationGroups,undefined);
  assert.throws(()=>s.transaction(s=>removeNodes(s.doc,[d.categories[0]._key])));assert.equal(s.doc.categories.length,1);
});
test('strict import rejects internal keys and invalid project labels',()=>{
  const d=sample();d._key='foreign';assert.throws(()=>parseInput(JSON.stringify(d)));
  assert.throws(()=>parseInput(JSON.stringify({format:'usdm-studio-project',projectVersion:1,document:sample(),labels:{'/missing':['x']}})));
});
