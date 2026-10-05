import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,emptyDocument,hydrate,walk,projectData,parseInput} from './model.bundle.mjs';
import {CYCLE_KINDS,createCycle,createCycleNode,createDetail,connectCycle,cycleAnchorAt,cycleAnchorPoint,cycleGeometry,cloneCycle,insertCycleOnEdge,validateCycleMap} from './cycles.bundle.mjs';

function fixture(){const doc=hydrate(emptyDocument()),d=createCycle('試合の流れ'),a=createCycleNode('phase',200,240),b=createCycleNode('decision',560,260),c=createCycleNode('input',560,510),detail=createDetail();detail.text='プレイヤーを待つ';c.details=[detail];d.nodes=[a,b,c];const edge=connectCycle(d,a.id,b.id,'準備完了');return {doc,labels:{},cycles:{[doc.categories[0]._key]:[d]},d,a,b,c,edge};}
const saved=f=>projectData(f.doc,f.labels,f.cycles);
const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('connection settings use project v4 only when present and round-trip without changing legacy projects',()=>{
  const f=fixture();assert.equal(saved(f).projectVersion,3);f.d.nodes.pop();assert.equal(saved(f).projectVersion,2);
  f.a.tailHidden=true;f.edge.sourceAnchor={angle:270};f.edge.targetAnchor={angle:45.5};const p=saved(f),parsed=parseInput(JSON.stringify(p));
  assert.equal(p.projectVersion,4);assert.deepEqual(saved(parsed),p);p.projectVersion=3;assert.throws(()=>parseInput(JSON.stringify(p)),/projectVersion.*4/);
  delete f.a.tailHidden;delete f.edge.sourceAnchor;delete f.edge.targetAnchor;assert.equal(saved(f).projectVersion,2);
});
test('malformed anchors and tail visibility settings fail import and atomically roll back',()=>{
  const changes=[f=>f.a.tailHidden='true',f=>f.edge.sourceAnchor=null,f=>f.edge.sourceAnchor=[],f=>f.edge.sourceAnchor={angle:-1},f=>f.edge.sourceAnchor={angle:360},f=>f.edge.targetAnchor={angle:'90'},f=>f.edge.targetAnchor={angle:Infinity},f=>f.edge.sourceAnchor={angle:90,x:50},f=>f.edge.sourceAnchor={}];
  for(const change of changes){const f=fixture(),s=new Store(f.doc,f.labels,f.cycles),before=s.snapshot();assert.throws(()=>s.transaction(()=>change(f)));assert.deepEqual(s.snapshot(),before);assert.equal(s.past.length,0);const bad=fixture();change(bad);assert.throws(()=>parseInput(JSON.stringify(saved(bad))));}
});
test('anchors follow the real outlines of diamonds, slanted inputs, hexagons and rounded nodes',()=>{
  const node=createCycleNode('decision',200,240);
  for(const kind of Object.keys(CYCLE_KINDS)){
    node.kind=kind;
    for(let angle=0;angle<360;angle+=5){
      const p=cycleAnchorPoint(node,{angle}),x=p.x-node.x-100,y=p.y-node.y-54;
      assert.ok([p.x,p.y,p.nx,p.ny].every(Number.isFinite));near(Math.hypot(p.nx,p.ny),1);assert.ok(Math.abs(x)<=97.000001&&Math.abs(y)<=51.000001);
      if(kind==='decision')near(Math.abs(x)/97+Math.abs(y)/51,1);
      assert.ok(x*p.nx+y*p.ny>0);near(cycleAnchorAt(node,p.x,p.y).angle,angle,.011);
    }
  }
  node.kind='input';near(cycleAnchorPoint(node,{angle:0}).x,node.x+186.5);node.kind='event';near(cycleAnchorPoint(node,{angle:0}).x,node.x+197);
  node.kind='start';const p=cycleAnchorPoint(node,{angle:45});near(Math.hypot(p.x-node.x-147,p.y-node.y-55),50);
  assert.deepEqual(cycleAnchorAt(node,node.x+100,node.y+54,120),{angle:120});
});
test('manual endpoints retain their relative position on moves and shape changes without mutating data',()=>{
  const f=fixture();f.edge.sourceAnchor={angle:270};f.edge.targetAnchor={angle:145};const before=saved(f),old=cycleGeometry(f.d).edges[0];assert.deepEqual(saved(f),before);
  f.a.x+=110;f.a.y+=60;const moved=cycleGeometry(f.d).edges[0];near(moved.sourcePoint.x-old.sourcePoint.x,110);near(moved.sourcePoint.y-old.sourcePoint.y,60);assert.deepEqual(moved.targetPoint,old.targetPoint);assert.notEqual(moved.path,old.path);
  f.b.kind='event';const changed=cycleGeometry(f.d).edges[0];assert.deepEqual(changed.targetPoint,cycleAnchorPoint(f.b,f.edge.targetAnchor));assert.deepEqual(f.edge.targetAnchor,{angle:145});
});
test('manual return paths, parallel arrows and coincident self-loop anchors stay finite, distinct and inside graph bounds',()=>{
  const f=fixture();connectCycle(f.d,f.a.id,f.b.id,'別の条件');connectCycle(f.d,f.b.id,f.a.id,'再戦');connectCycle(f.d,f.b.id,f.b.id,'継続');
  for(const e of f.d.edges){e.sourceAnchor={angle:90};e.targetAnchor={angle:90};}
  const g=cycleGeometry(f.d);assert.equal(new Set(g.edges.map(e=>e.path)).size,4);
  for(const e of g.edges){assert.ok(!/NaN|Infinity/.test(e.path));assert.ok(e.bounds.right<g.width&&e.bounds.bottom<g.height);assert.ok(e.insertY>e.sourcePoint.y);}
  const loop=g.edges.at(-1);assert.deepEqual(loop.sourcePoint,loop.targetPoint);assert.ok(loop.insertY>loop.sourcePoint.y+30);
});
test('insertion keeps endpoint adjustments attached to the original nodes and undoes as one edit',()=>{
  for(const self of [false,true]){
    const f=fixture();if(self)f.edge.target=f.edge.source;f.edge.sourceAnchor={angle:270};f.edge.targetAnchor={angle:180};const s=new Store(f.doc,f.labels,f.cycles),before=s.snapshot();let result;
    s.transaction(()=>{result=insertCycleOnEdge(f.d,f.edge.id);});assert.deepEqual(f.edge.sourceAnchor,{angle:270});assert.equal(f.edge.targetAnchor,undefined);assert.equal(result.edge.sourceAnchor,undefined);assert.deepEqual(result.edge.targetAnchor,{angle:180});assert.equal(result.edge.target,self?f.a.id:f.b.id);assert.equal(f.edge.label,'準備完了');
    const after=s.snapshot();s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.deepEqual(s.snapshot(),after);
  }
});
test('deleting the terminal affordance preserves the node and details across save, undo, redo and cloning',()=>{
  const f=fixture(),s=new Store(f.doc,f.labels,f.cycles),before=s.snapshot();s.transaction(()=>{f.c.tailHidden=true;});const p=saved(s);assert.equal(p.projectVersion,4);assert.deepEqual(f.c.details,before.cycles[f.doc.categories[0]._key][0].nodes[2].details);assert.equal(f.d.nodes.length,3);assert.equal(f.d.edges.length,1);
  const after=s.snapshot();s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.deepEqual(s.snapshot(),after);
  const parsed=parseInput(JSON.stringify(p)),d=Object.values(parsed.cycles)[0][0],clone=cloneCycle(d);assert.equal(clone.nodes[2].tailHidden,true);assert.notEqual(clone.nodes[2].id,f.c.id);assert.deepEqual(clone.nodes[2].details.map(n=>n.text),f.c.details.map(n=>n.text));
});
test('copied cycles retain independent anchor settings and valid IDs',()=>{
  const f=fixture();f.edge.sourceAnchor={angle:20};f.edge.targetAnchor={angle:210};const d=cloneCycle(f.d);f.cycles[f.doc.categories[0]._key].push(d);assert.equal(validateCycleMap(walk(f.doc),f.cycles),true);assert.deepEqual(d.edges[0].sourceAnchor,f.edge.sourceAnchor);assert.equal(d.edges[0].source,d.nodes[0].id);d.edges[0].sourceAnchor.angle=30;assert.equal(f.edge.sourceAnchor.angle,20);
});
