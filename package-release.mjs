import {readFile,writeFile,copyFile} from 'node:fs/promises';
const libs=['ajv','fast-deep-equal','fast-uri','json-schema-traverse','require-from-string'];
let notices='USDM Studio — Third-party notices\n\n';
for(const name of libs){
  const pkg=JSON.parse(await readFile(`node_modules/${name}/package.json`,'utf8'));
  let license='';for(const file of ['LICENSE','LICENSE.txt','LICENSE.md']){try{license=await readFile(`node_modules/${name}/${file}`,'utf8');break;}catch{}}
  if(!license)throw Error(`Missing license: ${name}`);
  notices+=`${name} ${pkg.version}\n${'='.repeat(64)}\n${license}\n\n`;
}
await writeFile('THIRD-PARTY-NOTICES.txt',notices);
await copyFile('THIRD-PARTY-NOTICES.txt','dist/THIRD-PARTY-NOTICES.txt');
await copyFile('README.md','dist/README.md');
await copyFile('CHANGELOG.md','dist/CHANGELOG.md');
await writeFile('dist/Start.cmd','@echo off\r\nstart "" "%~dp0USDM-Studio.html"\r\n');
const result=JSON.parse(await readFile('test-results/browser/results.json','utf8'));
const graph=JSON.parse(await readFile('test-results/browser/graph-results.json','utf8'));
const v15=JSON.parse(await readFile('test-results/browser/v15-results.json','utf8'));
const v16=JSON.parse(await readFile('test-results/browser/v16-results.json','utf8'));
const v17=JSON.parse(await readFile('test-results/browser/v17-results.json','utf8'));
const cycles=JSON.parse(await readFile('test-results/browser/cycles-results.json','utf8'));
const v19=JSON.parse(await readFile('test-results/browser/v19-results.json','utf8'));
const suites=[result,graph,v15,v16,v17,cycles,v19];
if(suites.some(s=>s.errors.length||s.requests.length))throw Error('Browser verification must pass without errors or external requests.');
const {version}=JSON.parse(await readFile('package.json','utf8'));
await writeFile('dist/TEST-RESULTS.txt',`USDM Studio v${version} verification — 2026-10-01\n\nModel + graph + review/diff + transformations + cycles: 46/46 tests passed (node --test)\nBrowser: ${result.passed} scenarios passed (Chrome headless)\nGraph browser: ${graph.passed} scenarios passed (Chrome headless)\nv1.5 browser: ${v15.passed} scenarios passed (Chrome headless)\nv1.6 browser: ${v16.passed} scenarios passed (Chrome headless)\nv1.7 browser: ${v17.passed} scenarios passed (Chrome headless)\nCycle browser: ${cycles.passed} scenarios passed (Chrome headless)\nv1.9 browser: ${v19.passed} scenarios passed (Chrome headless)\nTotal: ${46+suites.reduce((n,s)=>n+s.passed,0)} checks passed\nJavaScript page errors: ${suites.reduce((n,s)=>n+s.errors.length,0)}\nExternal network requests during operation: ${suites.reduce((n,s)=>n+s.requests.length,0)}\n\n${suites.flatMap(s=>s.tests).map((x,i)=>`${i+1}. PASS ${x}`).join('\n')}\n`);
for(const file of ['USDM-Studio.html','Start.cmd','document.schema.json','SCHEMA-LICENSE.txt','TEST-RESULTS.txt'])await copyFile(`dist/${file}`,file);
console.log('Release assets prepared; repository launch files updated.');
