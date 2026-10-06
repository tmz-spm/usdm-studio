import test from 'node:test';
import assert from 'node:assert/strict';
import {hydrate,emptyDocument,walk,Store,projectData,parseInput} from './model.bundle.mjs';
import {createCycle,createCycleNode,createDetail,connectCycle,cloneCycle,cycleAnchorPoint,cycleGeometry,validateCycleMap} from './cycles.bundle.mjs';
import {copyCycleSelection,pasteCycleSelection,parseCycleClipboard} from './cycle-clipboard.bundle.mjs';
import {activityShape,activityBarBounds,convertDiagram,plantUml} from '../src/activity.js';

function fixture(){const doc=hydrate(emptyDocument()),owner=doc.categories[0]._key,d=createCycle('同期','activity');d.nodes=[createCycleNode('action',80,180),createCycleNode('join',380,180),createCycleNode('fork',680,180)];d.nodes[2].barOrientation='horizontal';d.nodes[1].details=[createDetail()];const e=connectCycle(d,d.nodes[0].id,d.nodes[1].id,'完了');e.sourceAnchor={angle:0};e.targetAnchor={angle:180};e.route={x:20,y:60};return {doc,owner,d,store:new Store(doc,{}, {[owner]:[d]})};}
const save=f=>projectData(f.store.doc,f.store.labels,f.store.cycles);

test('new synchronization and fork bars are vertical while orientation-free legacy bars keep their horizontal shape',()=>{
  for(const kind of ['join','fork']){const n=createCycleNode(kind);assert.equal(n.barOrientation,'vertical');assert.match(activityShape(kind,n.barOrientation),/width="12" height="96"/);delete n.barOrientation;assert.match(activityShape(kind,n.barOrientation),/width="160" height="12"/);}
  assert.equal(createCycleNode('action').barOrientation,undefined);
});
test('anchors follow the real bar outline in both orientations including cardinal directions and diagonal handles',()=>{
  for(const kind of ['join','fork'])for(const orientation of ['vertical','horizontal']){const n=createCycleNode(kind,80,160);n.barOrientation=orientation;const b=activityBarBounds(orientation),cx=n.x+100,cy=n.y+54;
    for(let angle=0;angle<360;angle+=15){const p=cycleAnchorPoint(n,{angle},true),dx=Math.abs(p.x-cx),dy=Math.abs(p.y-cy);assert.ok(dx<=b.width/2+1e-8&&dy<=b.height/2+1e-8);assert.ok(Math.abs(dx-b.width/2)<1e-8||Math.abs(dy-b.height/2)<1e-8);assert.ok(Number.isFinite(p.nx+p.ny));}
    const right=cycleAnchorPoint(n,{angle:0},true);assert.equal(right.x,n.x+b.x+b.width);assert.equal(right.y,cy);assert.equal(right.nx,1);assert.equal(right.ny,0);
  }
});
test('orientations round-trip in project v6 and legacy project v5 keeps missing orientations',()=>{
  const f=fixture(),p=save(f);assert.equal(p.projectVersion,6);const parsed=parseInput(JSON.stringify(p));assert.deepEqual(projectData(parsed.doc,parsed.labels,parsed.cycles),p);p.projectVersion=5;assert.throws(()=>parseInput(JSON.stringify(p)),/projectVersion.*6/);
  Object.values(p.cycleDiagrams).flat()[0].nodes.forEach(n=>delete n.barOrientation);const old=parseInput(JSON.stringify(p));assert.equal(projectData(old.doc,old.labels,old.cycles).projectVersion,5);assert.ok(Object.values(old.cycles).flat()[0].nodes.every(n=>n.barOrientation===undefined));
});
test('invalid orientations or orientation on other kinds are rejected without changing the project',()=>{
  const f=fixture();for(const value of ['diagonal','',null,0,{},true]){const before=f.store.snapshot();assert.throws(()=>f.store.transaction(s=>s.cycles[f.owner][0].nodes[1].barOrientation=value));assert.deepEqual(f.store.snapshot(),before);}
  assert.throws(()=>f.store.transaction(s=>s.cycles[f.owner][0].nodes[0].barOrientation='vertical'));assert.throws(()=>f.store.transaction(s=>s.cycles[f.owner][0].diagramType='cycle'));
});
test('rotating bars retains details, node positions, guards, routes and anchor directions with undo and redo',()=>{
  const f=fixture(),before=f.store.snapshot(),edge=f.d.edges[0],g=cycleGeometry(f.d).edges[0],uml=plantUml(f.d);f.store.transaction(s=>s.cycles[f.owner][0].nodes[1].barOrientation='horizontal');const d=f.store.cycles[f.owner][0],after=cycleGeometry(d).edges[0];assert.deepEqual(d.edges[0],edge);assert.deepEqual(d.nodes[1],{...before.cycles[f.owner][0].nodes[1],barOrientation:'horizontal'});assert.notEqual(g.targetPoint.x,after.targetPoint.x);assert.deepEqual(g.sourcePoint,after.sourcePoint);assert.equal(plantUml(d),uml);f.store.undo();assert.deepEqual(f.store.snapshot(),before);f.store.redo();assert.equal(f.store.cycles[f.owner][0].nodes[1].barOrientation,'horizontal');
});
test('cloning and cross-document clipboard preserve each bar orientation, with safe cross-mode conversion',()=>{
  const f=fixture(),clone=cloneCycle(f.d),text=copyCycleSelection(f.d,f.d.nodes.map(n=>n.id)),packet=parseCycleClipboard(text);assert.equal(packet.clipboardVersion,3);assert.deepEqual(clone.nodes.map(n=>n.barOrientation),f.d.nodes.map(n=>n.barOrientation));
  const target=createCycle('貼り付け先','activity');pasteCycleSelection(target,text);assert.deepEqual(target.nodes.map(n=>n.barOrientation),f.d.nodes.map(n=>n.barOrientation));assert.deepEqual(target.nodes[1].details[0].text,f.d.nodes[1].details[0].text);assert.equal(validateCycleMap(walk(f.doc),{[f.owner]:[target]}),true);
  const cycle=createCycle();assert.throws(()=>pasteCycleSelection(cycle,text));pasteCycleSelection(cycle,text,undefined,true);assert.ok(cycle.nodes.every(n=>!Object.hasOwn(n,'barOrientation')));assert.equal(validateCycleMap(walk(f.doc),{[f.owner]:[cycle]}),true);
  packet.clipboardVersion=2;assert.throws(()=>parseCycleClipboard(JSON.stringify(packet)),/形式3/);
});
test('switching to cycle mode removes only unsupported orientation metadata and undo restores it',()=>{
  const f=fixture(),before=f.store.snapshot();f.store.transaction(s=>convertDiagram(s.cycles[f.owner][0],'cycle'));const d=f.store.cycles[f.owner][0];assert.ok(d.nodes.every(n=>n.barOrientation===undefined));assert.deepEqual(d.nodes[1].details,before.cycles[f.owner][0].nodes[1].details);assert.deepEqual(d.edges,before.cycles[f.owner][0].edges);f.store.undo();assert.deepEqual(f.store.snapshot(),before);
});
