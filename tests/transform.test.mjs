import test from 'node:test';
import assert from 'node:assert/strict';
import {hydrate,walk,Store,clone,validate,canonical} from './model.bundle.mjs';
import {sample} from './fixture.mjs';
import {planConversion,conversionOptions,planPreserveDelete} from './transform.bundle.mjs';
const state=()=>({doc:hydrate(sample()),labels:{}});
test('direct parent-only deletion that breaks schema is prohibited with no mutation',()=>{
  const s=state(),before=clone(s),req=s.doc.categories[0].requirements[0];
  assert.throws(()=>planPreserveDelete(s,[req._key]),/削除禁止/);
  assert.throws(()=>planPreserveDelete(s,[req.specificationGroups[0]._key]),/削除禁止/);
  assert.deepEqual(s,before);
});
test('removing consecutive intermediate nodes directly reconnects preserved groups',()=>{
  const s=state(),r=s.doc.categories[0].requirements[1],g=r.requirementGroups[0],subs=g.subRequirements;
  const spec=subs[0].specificationGroups[0].specifications[0];s.labels[spec._key]=['残す'];s.labels[g._key]=['消す'];
  const p=planPreserveDelete(s,[g._key,...subs.map(n=>n._key)]),nr=p.state.doc.categories[0].requirements[1];
  assert.equal(nr.specificationGroups.length,2);assert.equal(nr.specificationGroups[0].specifications[0].id,spec.id);assert.deepEqual(p.state.labels[spec._key],['残す']);assert.equal(p.removed.length,3);assert.equal(p.labelsRemoved.length,1);assert.equal(validate(p.state.doc).errors.length,0);
});
test('parent-only deletion cannot implicitly remove unselected empty mandatory containers',()=>{
  const s=state(),spec=s.doc.categories[1].requirements[0].specificationGroups[0].specifications[0];
  assert.throws(()=>planPreserveDelete(s,[spec._key]),/必須/);
});
test('preserved child relations remain while removed parent references are removed',()=>{
  const s=state(),g=s.doc.categories[0].requirements[1].requirementGroups[0];
  s.doc.requirementRelations=[{sourceId:'R02-01',targetId:'R04',divisionAxis:'構成分割'},{sourceId:'R02',targetId:'R03',divisionAxis:'共通分割'}];
  s.doc.specificationGroupRelations=[{sourceName:'＜日時変更＞',targetName:'＜表示性能＞',divisionAxis:'構成分割'}];
  const p=planPreserveDelete(s,[g._key,...g.subRequirements.map(n=>n._key)]);assert.equal(p.relationsRemoved,1);assert.equal(p.state.doc.specificationGroupRelations.length,1);assert.equal(p.state.doc.requirementRelations[0].sourceId,'R02');
});
test('requirement to specification preserves common text and labels, reports descendants and keywords',()=>{
  const s=state(),r=s.doc.categories[0].requirements[0];s.labels[r._key]=['保持'];
  s.doc.requirementRelations=[{sourceId:'R01',targetId:'R04',divisionAxis:'状態分割'}];
  const target=s.doc.categories[2].requirements[0].specificationGroups[0];
  const p=planConversion(s,r._key,'specification',target._key),n=walk(p.state.doc).find(x=>x.node._key===r._key).node;
  assert.equal(n.id,r.id);assert.equal(n.specification,r.requirement);assert.equal(n.reason,r.reason);assert.equal(n.explanation,r.explanation);assert.ok(!('keywords'in n));assert.ok(p.dropped.includes('keywords'));assert.ok(p.removed.length);assert.equal(p.relationsRemoved,1);assert.deepEqual(p.state.labels[r._key],['保持']);assert.equal(validate(p.state.doc).errors.length,0);assert.equal(s.doc.categories[0].requirements[0].id,'R01');
});
test('type conversion can create a required destination path without ID collisions',()=>{
  const s={doc:hydrate({version:'1.1.0',title:'x',categories:[{name:'＜機能＞',requirements:[{id:'R01',requirement:'元本文',reason:'理由'}]}]}),labels:{}};
  const r=s.doc.categories[0].requirements[0];const p=planConversion(s,r._key,'specification',s.doc.categories[0]._key);
  assert.equal(validate(p.state.doc).errors.length,0);const rows=walk(p.state.doc);assert.equal(rows.find(x=>x.type==='specification').node.id,'R01');assert.notEqual(rows.find(x=>x.type==='requirement').node.id,'R01');assert.equal(p.created.length,2);
});
test('specification to requirement discards verification and regenerates only incompatible ID',()=>{
  const s=state(),sp=s.doc.categories[0].requirements[0].specificationGroups[0].specifications[0];sp.id='仕様 1';
  const p=planConversion(s,sp._key,'requirement',s.doc.categories[0]._key),r=walk(p.state.doc).find(x=>x.node._key===sp._key);
  assert.equal(r.type,'requirement');assert.equal(r.node.requirement,sp.specification);assert.match(r.node.id,/^[A-Za-z][A-Za-z0-9_-]*$/);assert.ok(!('verified'in r.node));assert.ok(p.dropped.includes('verified'));assert.ok(p.changes.some(x=>x.includes('ID')));
});
test('all six node types can be converted to any other kind with valid outputs and explicit losses',()=>{
  for(const sourceType of ['category','requirement','requirementGroup','subRequirement','specificationGroup','specification'])for(const target of ['category','requirement','requirementGroup','subRequirement','specificationGroup','specification'])if(target!==sourceType){
    const s=state(),r=walk(s.doc).find(x=>x.type===sourceType),options=conversionOptions(s.doc,r.node._key,target);
    assert.ok(options.length,`${sourceType}->${target}: no destination`);
    const p=planConversion(s,r.node._key,target,options[0].parentKey);assert.equal(validate(p.state.doc).errors.length,0,`${sourceType}->${target}`);assert.equal(walk(p.state.doc).find(x=>x.node._key===r.node._key).type,target);
  }
});
test('transformation can be undone and redone with the exact document and label state',()=>{
  const s=state(),r=s.doc.categories[0].requirements[0],store=new Store(s.doc,s.labels),before=store.snapshot();
  const p=planConversion(before,r._key,'specification',s.doc.categories[2].requirements[0].specificationGroups[0]._key);
  store.transaction(s=>Object.assign(s,p.state));const after=store.snapshot();store.undo();assert.deepEqual(store.snapshot(),before);store.redo();assert.deepEqual(store.snapshot(),after);
});
