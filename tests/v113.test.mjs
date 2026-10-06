import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,emptyDocument,hydrate,walk,projectData,parseInput} from './model.bundle.mjs';
import {createCycle,createCycleNode,createDetail,connectCycle,validateCycleMap,detailRows} from './cycles.bundle.mjs';
import {copyCycleSelection,parseCycleClipboard,pasteCycleSelection} from './cycle-clipboard.bundle.mjs';

function fixture(){const doc=hydrate(emptyDocument()),d=createCycle('試合'),a=createCycleNode('input',80,120),b=createCycleNode('decision',390,150),c=createCycleNode('reference',700,150),other=createCycle('別の図');c.reference=other.id;a.tailHidden=true;const spec=createDetail(),rule=createDetail('rule');spec.children=[rule];a.details=[spec];d.nodes=[a,b,c];d.details=[createDetail('rule')];const edge=connectCycle(d,a.id,b.id,'準備完了');edge.sourceAnchor={angle:270};edge.targetAnchor={angle:135};connectCycle(d,b.id,a.id,'再戦');connectCycle(d,b.id,b.id,'待機');connectCycle(d,b.id,c.id,'次の場面');return {doc,labels:{},cycles:{[doc.categories[0]._key]:[d,other]},d,a,b,c,other,edge};}
const saved=s=>projectData(s.doc,s.labels,s.cycles);
test('copying a selection includes nested details and only internal arrows, without document metadata or mutations',()=>{
  const f=fixture(),before=saved(f),p=parseCycleClipboard(copyCycleSelection(f.d,[f.a.id,f.b.id]));assert.deepEqual(p.nodes,[f.a,f.b]);assert.equal(p.edges.length,3);assert.ok(p.edges.some(e=>e.source===e.target));assert.deepEqual(p.edges[0].sourceAnchor,{angle:270});assert.deepEqual(Object.keys(p).sort(),['clipboardVersion','edges','format','nodes']);assert.deepEqual(saved(f),before);
});
test('copying all flow nodes keeps references as IDs and does not silently copy diagram-wide rules',()=>{
  const f=fixture(),p=parseCycleClipboard(copyCycleSelection(f.d,f.d.nodes.map(n=>n.id)));assert.equal(p.nodes.length,3);assert.equal(p.edges.length,4);assert.equal(p.nodes[2].reference,f.other.id);assert.equal(p.details,undefined);assert.throws(()=>copyCycleSelection(f.d,[]),/選択/);assert.throws(()=>copyCycleSelection(f.d,['missing']),/選択|見つかりません/);
});
test('plain text, full project files, unknown fields, malformed anchors and broken edges cannot be pasted',()=>{
  const f=fixture(),good=JSON.parse(copyCycleSelection(f.d,[f.a.id,f.b.id]));const bad=['hello',JSON.stringify(saved(f)),JSON.stringify({...good,clipboardVersion:2}),JSON.stringify({...good,script:'run'})];
  for(const change of [p=>p.nodes[0].x=-1,p=>p.nodes[0].kind='unknown',p=>p.nodes[0].details[0].children[0].id=p.nodes[0].details[0].id,p=>p.edges[0].target='missing',p=>p.edges[0].sourceAnchor={angle:361},p=>p.nodes.push(p.nodes[0])]){const p=structuredClone(good);change(p);bad.push(JSON.stringify(p));}
  for(const text of bad){const before=structuredClone(f.d);assert.throws(()=>pasteCycleSelection(f.d,text));assert.deepEqual(f.d,before);}
});
test('pasting regenerates all identities, remaps connections and preserves source content and relative layout',()=>{
  const f=fixture(),text=copyCycleSelection(f.d,f.d.nodes.map(n=>n.id)),target=createCycle(),result=pasteCycleSelection(target,text,{x:200,y:400});assert.equal(result.nodeCount,3);assert.equal(result.edgeCount,4);
  for(let i=0;i<3;i++){const source=f.d.nodes[i],n=target.nodes[i];assert.notEqual(n.id,source.id);assert.equal(n.x-target.nodes[0].x,source.x-f.a.x);assert.equal(n.y-target.nodes[0].y,source.y-f.a.y);assert.equal(n.text,source.text);}
  assert.deepEqual(target.edges[0].sourceAnchor,{angle:270});assert.equal(target.edges[0].source,target.nodes[0].id);assert.equal(target.edges[0].target,target.nodes[1].id);assert.equal(target.edges[2].source,target.edges[2].target);assert.equal(target.nodes[2].reference,f.other.id);assert.equal(target.nodes[0].tailHidden,true);
  const sourceIds=detailRows(f.a.details).map(r=>r.item.id);assert.ok(detailRows(target.nodes[0].details).every(r=>!sourceIds.includes(r.item.id)));assert.deepEqual(detailRows(target.nodes[0].details).map(r=>r.item.text),detailRows(f.a.details).map(r=>r.item.text));
});
test('repeated pastes avoid existing nodes and keep independent IDs and details',()=>{
  const f=fixture(),text=copyCycleSelection(f.d,[f.a.id,f.b.id]),first=pasteCycleSelection(f.d,text,{x:80,y:120}),second=pasteCycleSelection(f.d,text,{x:80,y:120});assert.equal(new Set(f.d.nodes.map(n=>n.id)).size,7);assert.equal(validateCycleMap(walk(f.doc),f.cycles),true);
  const added=f.d.nodes.filter(n=>first.ids.includes(n.id)||second.ids.includes(n.id));for(const n of added)for(const other of f.d.nodes)if(n.id!==other.id)assert.ok(n.x>=other.x+200||other.x>=n.x+200||n.y>=other.y+108||other.y>=n.y+108);
  added[0].details[0].text='貼り付け側の変更';assert.notEqual(f.a.details[0].text,'貼り付け側の変更');assert.notEqual(added[2].details[0].text,'貼り付け側の変更');
});
test('a paste is one undoable edit and round-trips in the existing project format',()=>{
  const f=fixture(),s=new Store(f.doc,f.labels,f.cycles),before=s.snapshot(),text=copyCycleSelection(f.d,[f.a.id,f.b.id]);s.transaction(()=>pasteCycleSelection(f.other,text));const after=s.snapshot(),p=saved(s);assert.equal(p.projectVersion,4);assert.deepEqual(saved(parseInput(JSON.stringify(p))),p);s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.deepEqual(s.snapshot(),after);
});
test('out-of-range preferred placement is clamped without distorting the selected layout',()=>{
  const f=fixture(),text=copyCycleSelection(f.d,[f.a.id,f.b.id]),target=createCycle();pasteCycleSelection(target,text,{x:50000,y:-100});assert.equal(target.nodes[1].x,20000);assert.equal(target.nodes[0].y,0);assert.equal(target.nodes[1].y-target.nodes[0].y,30);assert.equal(validateCycleMap(walk(f.doc),{[f.doc.categories[0]._key]:[target]}),true);
});
test('references to a diagram outside the destination remain repairable rather than copying an unrelated diagram',()=>{
  const f=fixture(),text=copyCycleSelection(f.d,[f.c.id]),target=createCycle();pasteCycleSelection(target,text);assert.equal(target.nodes[0].reference,f.other.id);assert.equal(target.nodes.length,1);assert.equal(target.edges.length,0);assert.equal(validateCycleMap(walk(f.doc),{[f.doc.categories[0]._key]:[target]}),true);
});
