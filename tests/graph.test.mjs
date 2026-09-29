import test from 'node:test';
import assert from 'node:assert/strict';
import {hydrate,Store,insertSubRequirementOnEdge,walk,validate,canonical} from './model.bundle.mjs';
import {sample} from './fixture.mjs';
import {layoutGraph,GRAPH_NODE} from './graph.bundle.mjs';

test('tree layout has one edge per non-root node and no overlapping cards',()=>{
  const d=hydrate(sample()),layout=layoutGraph(d);
  assert.equal(layout.nodes.length,walk(d).length);assert.equal(layout.edges.length,layout.nodes.length-1);
  for(const a of layout.nodes)for(const b of layout.nodes)if(a!==b)
    assert.ok(a.x+GRAPH_NODE.width<=b.x||b.x+GRAPH_NODE.width<=a.x||a.y+GRAPH_NODE.height<=b.y||b.y+GRAPH_NODE.height<=a.y);
});
test('collapse and filter keep the path to matching nodes',()=>{
  const d=hydrate(sample()),r=d.categories[0].requirements[0];
  const collapsed=layoutGraph(d,{collapsed:new Set([r._key])});
  assert.ok(collapsed.nodes.some(x=>x.node===r));assert.ok(!collapsed.nodes.some(x=>x.node.id==='S01-01'));
  const filtered=layoutGraph(d,{include:x=>x.node.id==='S01-01'});
  assert.equal(filtered.nodes.length,5);assert.equal(filtered.edges.length,4);
});
test('inserting a lower requirement on a branch preserves existing subtree and labels',()=>{
  const d=hydrate(sample()),target=d.categories[0].requirements[0].specificationGroups[0],key=target._key;
  const s=new Store(d,{[key]:['保持']}),before=s.snapshot();let subKey;
  s.transaction(s=>{subKey=insertSubRequirementOnEdge(s.doc,key);});
  const sub=walk(s.doc).find(x=>x.node._key===subKey);
  assert.equal(sub.type,'subRequirement');assert.equal(sub.node.specificationGroups[0],target);
  assert.equal(s.doc.categories[0].requirements[0].specificationGroups.length,1);
  assert.deepEqual(s.labels[key],['保持']);assert.deepEqual(validate(s.doc),{errors:[],warnings:[]});
  s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.ok(walk(s.doc).some(x=>x.node._key===subKey));
});
test('wrapping the only specification group removes empty optional property',()=>{
  const d=hydrate(sample()),r=d.categories[1].requirements[0],key=r.specificationGroups[0]._key,s=new Store(d);
  s.transaction(s=>insertSubRequirementOnEdge(s.doc,key));
  assert.equal(r.specificationGroups,undefined);assert.equal(r.requirementGroups.length,1);assert.equal(validate(d).errors.length,0);
  const before=canonical(d);assert.throws(()=>s.transaction(s=>insertSubRequirementOnEdge(s.doc,r._key)));assert.deepEqual(canonical(s.doc),before);
});
