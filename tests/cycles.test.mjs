import test from 'node:test';
import assert from 'node:assert/strict';
import {hydrate,walk,Store,projectData,parseInput,validate,moveNodes,removeNodes} from './model.bundle.mjs';
import {createCycle,createCycleNode,createDetail,connectCycle,removeCycleNode,detailRows,validateCycleMap,cycleRows,cycleGeometry} from './cycles.bundle.mjs';
import {duplicateNodes,compareDocuments} from './review.bundle.mjs';
import {planConversion,planPreserveDelete} from './transform.bundle.mjs';
import {layoutGraph} from './graph.bundle.mjs';
import {sample} from './fixture.mjs';

function fixture(){
  const doc=hydrate(sample()),owner=doc.categories[0].requirements[0].specificationGroups[0]._key,d=createCycle('対戦の流れ');
  const a=createCycleNode('phase',70,110),b=createCycleNode('decision',380,110);a.text='準備';b.text='勝敗が決まったか';
  const spec=createDetail(),behavior=createDetail('behavior');spec.text='プレイヤーが参加を確定する';behavior.text='全員の参加後に対戦を開始する';spec.children.push(behavior);a.details.push(spec);
  d.nodes.push(a,b);connectCycle(d,a.id,b.id,'準備完了');connectCycle(d,b.id,a.id,'再戦');connectCycle(d,a.id,a.id,'待機');
  return {doc,labels:{[owner]:['ゲーム仕様']},cycles:{[owner]:[d]},owner,d,a,b};
}
const saved=f=>projectData(f.doc,f.labels,f.cycles);
test('project v2 round-trip retains diagram geometry, cycles, conditions and nested node specifications',()=>{
  const f=fixture(),project=saved(f),parsed=parseInput(JSON.stringify(project));
  assert.equal(project.projectVersion,2);assert.equal(project.cycleDiagrams['/categories/0/requirements/0/specificationGroups/0'][0].nodes[0].details[0].children[0].kind,'behavior');
  assert.deepEqual(projectData(parsed.doc,parsed.labels,parsed.cycles),project);assert.equal(validate(project.document).errors.length,0);assert.ok(!JSON.stringify(project.document).includes('cycle_'));
});
test('projects without diagrams remain compatible with version 1',()=>{
  const doc=hydrate(sample()),project=projectData(doc,{});assert.equal(project.projectVersion,1);assert.ok(!('cycleDiagrams'in project));assert.deepEqual(parseInput(JSON.stringify(project)).cycles,{});
});
test('invalid owners, duplicate identities, broken edges and corrupt details are rejected on import',()=>{
  const f=fixture(),path='/categories/0/requirements/0/specificationGroups/0';
  for(const mutate of [p=>p.cycleDiagrams['/missing']=p.cycleDiagrams[path],p=>p.cycleDiagrams['/categories/0/requirements/0']=p.cycleDiagrams[path],p=>p.cycleDiagrams[path].push(p.cycleDiagrams[path][0]),p=>p.cycleDiagrams[path][0].edges[0].target='missing',p=>p.cycleDiagrams[path][0].nodes[0].x=null,p=>p.cycleDiagrams[path][0].nodes[0].details[0].children[0].id=p.cycleDiagrams[path][0].nodes[0].details[0].id,p=>p.cycleDiagrams[path][0].nodes[0].details[0].children='bad',p=>p.cycleDiagrams[path][0].extra=true,p=>p.projectVersion=1]){
    const p=saved(f);mutate(p);assert.throws(()=>parseInput(JSON.stringify(p)));
  }
});
test('moving a group carries its diagrams and regenerates the owner JSON Pointer',()=>{
  const f=fixture(),s=new Store(f.doc,f.labels,f.cycles),destination=f.doc.categories[1].requirements[0];
  s.transaction(s=>moveNodes(s.doc,[f.owner],destination._key));const p=projectData(s.doc,s.labels,s.cycles);
  assert.equal(p.cycleDiagrams['/categories/1/requirements/0/specificationGroups/1'][0].id,f.d.id);assert.equal(Object.keys(p.cycleDiagrams).length,1);
  s.undo();assert.equal(Object.keys(projectData(s.doc,s.labels,s.cycles).cycleDiagrams)[0],'/categories/0/requirements/0/specificationGroups/0');
});
test('diagram-only edits and node removal undo and redo all details and incident edges atomically',()=>{
  const f=fixture(),s=new Store(f.doc,f.labels,f.cycles),before=s.snapshot();
  s.transaction(s=>removeCycleNode(s.cycles[f.owner][0],f.a.id));assert.equal(s.cycles[f.owner][0].edges.length,0);const after=s.snapshot();s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.deepEqual(s.snapshot(),after);
  const stable=s.snapshot();assert.throws(()=>s.transaction(s=>s.cycles[f.owner][0].nodes[0].x=-5));assert.deepEqual(s.snapshot(),stable);
});
test('cascading deletion removes group-owned diagrams and undo restores them',()=>{
  const f=fixture(),s=new Store(f.doc,f.labels,f.cycles),before=s.snapshot();s.transaction(s=>removeNodes(s.doc,[f.doc.categories[0].requirements[0]._key]));assert.equal(Object.keys(s.cycles).length,0);s.undo();assert.deepEqual(s.snapshot(),before);
});
test('duplicating a hierarchy copies diagrams and details with independent IDs and valid arrow targets',()=>{
  const f=fixture(),s=new Store(f.doc,f.labels,f.cycles);let keys;
  s.transaction(s=>{keys=duplicateNodes(s.doc,s.labels,[f.doc.categories[0].requirements[0]._key],{cycles:s.cycles});});
  const owner=walk(s.doc).find(r=>r.parent?._key===keys[0]&&r.type==='specificationGroup').node._key,copy=s.cycles[owner][0];
  assert.notEqual(copy.id,f.d.id);assert.notEqual(copy.nodes[0].id,f.a.id);assert.notEqual(copy.nodes[0].details[0].id,f.a.details[0].id);assert.equal(copy.edges[0].source,copy.nodes[0].id);assert.equal(copy.edges[2].source,copy.edges[2].target);assert.equal(validateCycleMap(walk(s.doc),s.cycles),true);
});
test('type conversion reports lost diagrams when the new type cannot own them',()=>{
  const f=fixture(),s=new Store(f.doc,f.labels,f.cycles),target=f.doc.categories[0].requirements[0].specificationGroups[1];
  const plan=planConversion(s.snapshot(),f.owner,'specification',target._key);assert.equal(plan.cyclesRemoved[0].id,f.d.id);assert.ok(!plan.state.cycles[f.owner]);
  assert.equal(s.cycles[f.owner][0].id,f.d.id);
});
test('parent-only deletion cannot silently lose a diagram that cannot reconnect to the parent',()=>{
  const f=fixture(),group=f.doc.categories[0].requirements[1].requirementGroups[0],sub=group.subRequirements[0];group.subRequirements.splice(1);f.cycles={[group._key]:[f.d]};
  assert.throws(()=>planPreserveDelete(f,[group._key,sub._key]),/サイクル図/);
});
test('cycle changes appear in document comparison while internal remapping remains invisible',()=>{
  const f=fixture(),before={doc:f.doc,labels:f.labels,cycles:f.cycles},after=parseInput(JSON.stringify(saved(f)));
  assert.deepEqual(compareDocuments(before,after),[]);Object.values(after.cycles)[0][0].nodes[0].details[0].text='変更後の詳細';
  const diff=compareDocuments(before,after);assert.equal(diff.length,1);assert.equal(diff[0].fields[0].field,'サイクル図');
});
test('cycle nodes are virtual children in the hierarchy and return edges and self loops remain drawable',()=>{
  const f=fixture(),extra=cycleRows(walk(f.doc),f.cycles),layout=layoutGraph(f.doc,{extraRows:extra});
  assert.equal(layout.nodes.length,walk(f.doc).length+1);assert.equal(layout.nodes.find(n=>n.type==='cycle').parent._key,f.owner);
  const geometry=cycleGeometry(f.d);assert.equal(geometry.edges.length,3);assert.ok(geometry.edges.every(e=>!e.path.includes('NaN')&&Number.isFinite(e.labelX)));assert.notEqual(geometry.edges[0].path,geometry.edges[1].path);assert.equal(detailRows(f.a.details).length,2);
});
