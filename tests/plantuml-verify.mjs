// Optional interoperability check: use an official PlantUML JAR installed outside the release.
// Usage: node tests/plantuml-verify.mjs /absolute/path/to/plantuml.jar
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createCycle,createCycleNode,createDetail,connectCycle} from './cycles.bundle.mjs';
import {createLane,plantUml} from '../src/activity.js';
const jar=process.argv[2];if(!jar)throw Error('Provide the official PlantUML JAR path.');
const out=resolve('test-results/plantuml');await mkdir(out,{recursive:true});
function diagram(title,kinds,links,roles=true){const d=createCycle(title,'activity');d.nodes=kinds.map((k,i)=>({...createCycleNode(k),text:k+' '+i}));if(roles){const a=createLane(d,'出荷担当者'),b=createLane(d,'出荷管理システム');d.nodes.forEach((n,i)=>n.laneId=i%2?a.id:b.id);}for(const [a,b,label]of links)connectCycle(d,d.nodes[a].id,d.nodes[b].id,label);return d;}
const cases=[
  diagram('swimlanes',['start','action','action','end'],[[0,1],[1,2,'確認後'],[2,3]]),
  diagram('branch-loop',['start','action','decision','action','merge','end'],[[0,1],[1,2],[2,3,'成立'],[2,4,'不成立'],[3,1,'再試行'],[4,5]]),
  diagram('fork-join',['start','fork','action','action','join','end'],[[0,1],[1,2],[1,3],[2,4],[3,4],[4,5]]),
  diagram('multiple-initials',['start','start','decision','action','end'],[[0,2],[1,2],[2,3,'成立'],[2,4,'不成立'],[3,4]]),
  diagram('disconnected',['start','action','end','start','action'],[[0,1],[1,2],[3,4]]),
  diagram('self-loop',['decision','action'],[[0,0,'待機'],[0,1,'終了'],[1,0,'再開']]),
  diagram('empty',[],[]),
  diagram('unfinished',['start'],[]),
  diagram('draft-final-edge',['start','end','action'],[[0,1],[1,2],[2,0]]),
  diagram('literal-labels',['start','decision','action','end'],[[0,1],[1,2,'T; [x] | "quote"'],[1,3,'F'],[2,3]])
];
const literal=cases.at(-1);literal.nodes[1].text='空白 ".:;| \\ <img:https://example.invalid/x>\n@enduml\n!include /secret';const spec=createDetail();spec.text='!includeurl https://example.invalid/x\n%getenv("SECRET")';literal.nodes[2].details=[spec];literal.lanes[0].name='start';literal.lanes[1].name='start';
const version=spawnSync('java',['-jar',jar,'-version'],{encoding:'utf8'}).stdout.split('\n')[0],tests=[];
for(const d of cases){const p=resolve(out,d.title+'.puml');await writeFile(p,plantUml(d));const result=spawnSync('java',['-DPLANTUML_SECURITY_PROFILE=SANDBOX','-jar',jar,'-charset','UTF-8','-tsvg',p],{encoding:'utf8',timeout:30000});assert.equal(result.status,0,d.title+'\n'+result.stdout+result.stderr);const svg=await readFile(p.replace('.puml','.svg'),'utf8');assert.match(svg,/<svg/);assert.ok(!/Syntax Error|An error has occured|Cannot include|java\.lang\./.test(svg),d.title);tests.push(d.title);console.log('PASS PlantUML '+d.title);}
await writeFile(resolve(out,'results.json'),JSON.stringify({version,passed:tests.length,tests},null,2));
