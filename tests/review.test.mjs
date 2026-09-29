import test from 'node:test';
import assert from 'node:assert/strict';
import {hydrate,clone,walk,Store,validate,moveNodes} from './model.bundle.mjs';
import {sample} from './fixture.mjs';
import {reviewDocument,duplicateNodes,compareDocuments} from './review.bundle.mjs';
const state=()=>({doc:hydrate(sample()),labels:{}});
test('review flags missing reasons, uncovered requirements, placeholders and pending text',()=>{
  const d=hydrate({version:'1.1.0',title:'test',categories:[{name:'＜機能＞',requirements:[{id:'R1',requirement:'新しい要求',reason:''},{id:'R2',requirement:'機能は要確認',reason:'必要'}]}]});
  const issues=reviewDocument(d);assert.ok(issues.some(i=>i.id==='R1'&&i.code==='reason'));assert.ok(issues.some(i=>i.id==='R1'&&i.code==='placeholder'));assert.equal(issues.filter(i=>i.code==='coverage').length,2);assert.ok(issues.some(i=>i.id==='R2'&&i.code==='pending'));
});
test('single lower requirement omits reason check, while review status is explicit',()=>{
  const d=hydrate(sample()),g=d.categories[0].requirements[1].requirementGroups[0];g.subRequirements.splice(1);g.subRequirements[0].reason='';
  d.categories[0].requirements[0].specificationGroups[0].specifications[0].verified=[false,true,true];
  const issues=reviewDocument(d);assert.ok(!issues.some(i=>i.id==='R02-01'&&i.code==='reason'));assert.ok(issues.some(i=>i.id==='S01-01'&&i.code==='status'));assert.ok(issues.some(i=>i.id==='S01-01'&&i.code==='unreviewed'));
});
test('review reference problems and exact duplicate text have clickable node keys',()=>{
  const d=hydrate(sample());d.categories[0].requirements[1].requirement=d.categories[0].requirements[0].requirement;d.requirementRelations=[{sourceId:'R01',targetId:'missing',divisionAxis:'構成分割'}];
  const issues=reviewDocument(d);assert.equal(issues.filter(i=>i.code==='duplicate').length,2);assert.ok(issues.find(i=>i.code==='reference').key);
});
test('subtree duplication regenerates all IDs, preserves labels and resets checks',()=>{
  const d=hydrate(sample()),r=d.categories[0].requirements[0],spec=r.specificationGroups[0].specifications[0],s=new Store(d,{[spec._key]:['label']});
  const before=s.snapshot();let keys;s.transaction(s=>{keys=duplicateNodes(s.doc,s.labels,[r._key,spec._key]);});
  const copied=d.categories[0].requirements[1];assert.equal(keys.length,1);assert.notEqual(copied.id,r.id);assert.notEqual(copied.specificationGroups[0].name,r.specificationGroups[0].name);const sp=copied.specificationGroups[0].specifications[0];assert.deepEqual(sp.verified,[false,false,false]);assert.deepEqual(s.labels[sp._key],['label']);assert.deepEqual(validate(d),{errors:[],warnings:[]});
  assert.deepEqual(spec.verified,[true,true,false]);s.undo();assert.deepEqual(s.snapshot(),before);
});
test('multiple copies cannot collide and preserving checked status is optional',()=>{
  const d=hydrate(sample()),r=d.categories[0].requirements[0],s=new Store(d);s.transaction(s=>duplicateNodes(s.doc,s.labels,[r._key],{resetVerified:false}));s.transaction(s=>duplicateNodes(s.doc,s.labels,[r._key]));
  assert.equal(validate(d).errors.length,0);assert.deepEqual(d.categories[0].requirements[2].specificationGroups[0].specifications[0].verified,[true,true,false]);
});
test('comparison ignores internal identities, key order and modification timestamps',()=>{
  const a=state(),b={doc:hydrate(sample()),labels:{}};b.doc.metadata.modified='later';assert.deepEqual(compareDocuments(a,b),[]);
});
test('comparison identifies text, flags and free-label changes',()=>{
  const a=state(),b=clone(a),r=b.doc.categories[0].requirements[0];r.reason='変更';b.labels[r._key]=['確認'];r.specificationGroups[0].specifications[0].verified[2]=true;
  const diff=compareDocuments(a,b);assert.equal(diff.length,2);assert.ok(diff.find(x=>x.id==='R01').fields.some(x=>x.field==='自由ラベル'));assert.ok(diff.find(x=>x.id==='S01-01').fields.some(x=>x.field==='verified'));
});
test('insertion does not falsely mark unchanged siblings as reordered',()=>{
  const a=state(),b=clone(a);b.doc.categories[0].requirements.unshift({_key:crypto.randomUUID(),id:'R_ADDED',requirement:'added',reason:''});
  assert.deepEqual(compareDocuments(a,b).map(x=>x.kind),['added']);
});
test('moving a requirement reports its parent change without descendant noise',()=>{
  const a=state(),b=clone(a),r=b.doc.categories[0].requirements[0];moveNodes(b.doc,[r._key],b.doc.categories[2]._key);
  const diff=compareDocuments(a,b);assert.equal(diff.length,1);assert.equal(diff[0].kind,'moved');assert.equal(diff[0].id,'R01');
});
test('ID rename is addition/removal and sibling swap is reordered',()=>{
  const a=state(),b=clone(a);b.doc.categories[0].requirements.reverse();assert.equal(compareDocuments(a,b).filter(x=>x.kind==='reordered').length,2);
  const c=clone(a);c.doc.categories[0].requirements[0].specificationGroups[0].specifications[0].id='S_RENAMED';assert.deepEqual(compareDocuments(a,c).map(x=>x.kind),['added','removed']);
});
