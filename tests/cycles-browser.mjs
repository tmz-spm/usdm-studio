import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseInput,validate} from './model.bundle.mjs';

const out=resolve('test-results/browser');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1100},acceptDownloads:true});
page.setDefaultTimeout(12000);
const errors=[],requests=[],tests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('http'))requests.push(r.url());});page.on('dialog',d=>d.accept());
const action=name=>page.locator(`[data-action="${name}"]:visible`).first();
const field=name=>page.locator(`#cycleForm [name="${name}"]`);
const node=id=>page.locator(`[data-cycle-node="${id}"]`);
const tab=name=>page.locator(`[data-tab="${name}"]`).click();
const graphNode=id=>page.locator(`.graph-node[data-node="cycle:${id}"]`);
const stored=()=>page.evaluate(()=>localStorage.getItem('usdm-studio.autosave.v1'));
let first,second,a,b,c,end,detail,behavior,project,saveIndex=0;
const diagrams=p=>Object.values(p.cycleDiagrams||{}).flat();
async function check(name,fn){await fn();tests.push(name);console.log('PASS '+name);}
async function saved(){const wait=page.waitForEvent('download');await action('save').click();const d=await wait,file=resolve(out,'cycle-save-'+saveIndex+++'.json');await d.saveAs(file);return JSON.parse(await readFile(file,'utf8'));}
async function createDiagram(title){await action('cycle-create').click();await page.locator('#cycleTitle').fill(title);await action('cycle-confirm-create').click();return (await page.locator('.tabs [data-tab^="cycle:"].active').getAttribute('data-tab')).slice(6);}
async function addNode(kind,text){await page.locator(`[data-action="cycle-add-node"][data-kind="${kind}"]`).click();await field('text').fill(text);await page.keyboard.press('Control+Enter');return await page.locator('.cycle-node.selected').getAttribute('data-cycle-node');}
async function connect(source,target,label){await action('cycle-connect').click();await node(source).click();await node(target).click();await field('label').fill(label);await page.keyboard.press('Control+Enter');}
async function load(p){await page.locator('#fileInput').setInputFiles({name:'game-flow.usdm-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});}

try{
  await page.goto(pathToFileURL(resolve('dist/USDM-Studio.html')).href);
  await check('A group creates a cycle diagram with its own tab while keeping the hierarchy tab',async()=>{
    await tab('graph');await page.locator('.graph-node.category').click();first=await createDiagram('対戦の流れ');
    await expect(page.locator('.cycle-heading')).toContainText('対戦の流れ');await expect(page.locator('[data-tab="graph"]')).toBeVisible();
    await expect(page.locator('.cycle-node')).toHaveCount(0);await expect(page.locator('.tree .cycle-tree-link')).toHaveCount(1);
  });
  await check('Game phases and decisions can be placed and connected with conditional return paths and self loops',async()=>{
    a=await addNode('phase','対戦準備');b=await addNode('action','拠点と資源を争う');c=await addNode('decision','勝敗が決まったか');end=await addNode('end','結果を確認する');
    await action('cycle-fit').click();
    await connect(a,b,'準備完了');await connect(b,c,'制限時間または目標達成');await connect(c,a,'再戦する');await connect(c,end,'対戦を終了する');await connect(a,a,'参加者を待つ');
    await expect(page.locator('.cycle-edge')).toHaveCount(5);project=await saved();const d=diagrams(project)[0];assert.equal(d.nodes.length,4);assert.equal(d.edges.filter(e=>e.source===e.target).length,1);assert.equal(d.edges.find(e=>e.source===c&&e.target===a).label,'再戦する');
  });
  await check('Each flow node owns detailed specifications and behaviors with further nested children',async()=>{
    await node(a).click();await page.locator('[data-action="cycle-add-detail"][data-kind="specification"]').click();await field('text').fill('対戦前に参加者とチーム編成を確定する');await page.keyboard.press('Control+Enter');detail=await page.locator('.cycle-detail-row.active').getAttribute('data-id');
    await page.locator('[data-action="cycle-add-detail"][data-kind="behavior"]').click();await field('text').fill('全員のロード完了後にカウントダウンを開始する');await page.keyboard.press('Control+Enter');behavior=await page.locator('.cycle-detail-row.active').getAttribute('data-id');
    await page.locator('[data-action="cycle-add-detail"][data-kind="specification"]').click();await field('text').fill('開始前は移動範囲を拠点内に制限する');await page.keyboard.press('Control+Enter');
    const n=diagrams(await saved())[0].nodes.find(n=>n.id===a);assert.equal(n.details[0].id,detail);assert.equal(n.details[0].children[0].kind,'behavior');assert.equal(n.details[0].children[0].children[0].text,'開始前は移動範囲を拠点内に制限する');await expect(node(a)).toContainText('詳細 3 件');
  });
  await check('Details can change parents while retaining their children and support undo',async()=>{
    await page.locator(`[data-action="cycle-select-detail"][data-id="${behavior}"]`).click();await field('detailParent').selectOption('');await page.keyboard.press('Control+Enter');
    let n=diagrams(await saved())[0].nodes.find(n=>n.id===a);assert.equal(n.details.length,2);assert.equal(n.details[1].children.length,1);
    await action('undo').click();n=diagrams(await saved())[0].nodes.find(n=>n.id===a);assert.equal(n.details.length,1);assert.equal(n.details[0].children[0].id,behavior);
  });
  await check('Dragging changes node placement and connected arrows, with undo and redo',async()=>{
    await node(b).click();await action('cycle-actual').click();const before=diagrams(await saved())[0].nodes.find(n=>n.id===b);
    const box=await node(b).boundingBox(),path=await page.locator('.cycle-edge-line').first().getAttribute('d');await field('description').fill('対戦中の中心となる行動');
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+55,box.y+box.height/2+65,{steps:8});await page.mouse.up();
    const after=diagrams(await saved())[0].nodes.find(n=>n.id===b);assert.ok(after.x>before.x&&after.y>before.y);assert.equal(after.description,'対戦中の中心となる行動');assert.notEqual(await page.locator('.cycle-edge-line').first().getAttribute('d'),path);
    await action('undo').click();assert.equal(diagrams(await saved())[0].nodes.find(n=>n.id===b).x,before.x);await action('redo').click();assert.equal(diagrams(await saved())[0].nodes.find(n=>n.id===b).x,after.x);await action('cycle-fit').click();
  });
  await check('Multiple cycle diagrams have independent tabs and reopening from the tree graph reuses the tab',async()=>{
    await action('cycle-owner').click();second=await createDiagram('復帰の流れ');await addNode('phase','復帰待ち');await expect(page.locator('.cycle-tab')).toHaveCount(2);
    await tab('cycle:'+first);await expect(page.locator('.cycle-node')).toHaveCount(4);await tab('graph');await graphNode(first).click();await expect(page.locator('.cycle-tab')).toHaveCount(2);await expect(page.locator('.cycle-heading')).toContainText('対戦の流れ');
    await page.locator(`[data-action="cycle-close"][data-id="${first}"]`).click();await expect(page.locator('.cycle-tab')).toHaveCount(1);assert.equal(diagrams(await saved()).length,2);
    await tab('graph');await graphNode(first).focus();await page.keyboard.press('Enter');await expect(page.locator('.cycle-tab')).toHaveCount(2);
  });
  await check('Existing return arrows can be selected directly on the canvas and their conditions edited',async()=>{
    await action('cycle-fit').click();const d=diagrams(await saved()).find(d=>d.id===first),edge=d.edges.find(e=>e.source===c&&e.target===a);
    const point=await page.locator(`[data-cycle-edge="${edge.id}"] .cycle-edge-hit`).evaluate(el=>{const p=el.getPointAtLength(el.getTotalLength()*.3),m=el.getScreenCTM();return {x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f};});
    await page.mouse.click(point.x,point.y);await expect(field('label')).toHaveValue('再戦する');await field('label').fill('再戦を選んだ場合');await page.keyboard.press('Control+Enter');assert.equal(diagrams(await saved()).find(d=>d.id===first).edges.find(e=>e.id===edge.id).label,'再戦を選んだ場合');
  });
  await check('Invalid detail drafts survive layout changes and block tab switching without corrupting saved data',async()=>{
    await node(a).click();await page.locator(`[data-action="cycle-select-detail"][data-id="${detail}"]`).click();const before=await stored();await action('cycle-connect').click();await field('text').fill('');await page.keyboard.press('Escape');await expect(field('text')).toHaveValue('');await expect(page.locator('.cycle-connection-status')).toHaveCount(0);
    await page.locator('.layout-controls [data-action="toggle-inspector"]').click();await page.locator('.layout-controls [data-action="toggle-inspector"]').click();await expect(field('text')).toHaveValue('');
    await tab('graph');await expect(page.locator('#dialog')).toContainText('詳細の内容');await action('close-dialog').click();await expect(field('text')).toHaveValue('');assert.equal(await stored(),before);await action('cycle-discard').click();await expect(field('text')).toHaveValue('対戦前に参加者とチーム編成を確定する');
  });
  await check('Project save and reload preserve all diagrams, geometry, nested behaviors and free labels',async()=>{
    project=await saved();assert.equal(project.projectVersion,2);assert.equal(validate(project.document).errors.length,0);assert.equal(Object.keys(parseInput(JSON.stringify(project)).cycles).length,1);
    await load(project);await expect(page.locator('.cycle-tab')).toHaveCount(0);await tab('graph');await expect(page.locator('.graph-node.cycle')).toHaveCount(2);await graphNode(first).click();assert.deepEqual(await saved(),project);
    await page.reload();await expect(page.locator('#dialog')).toContainText('前回の作業を復元');await action('restore').click();await tab('graph');await graphNode(first).click();assert.deepEqual(await saved(),project);
  });
  await check('Whole-project JSON editing includes cycles, rejects broken connections and preserves diagrams on standard edits',async()=>{
    await tab('json');let p=JSON.parse(await page.locator('#jsonEditor').inputValue());assert.equal(p.projectVersion,2);const original=JSON.stringify(p);diagrams(p)[0].edges[0].target='missing';await page.locator('#jsonEditor').fill(JSON.stringify(p));await action('apply-json').click();await expect(page.locator('#dialog')).toContainText('接続先');await action('close-dialog').click();
    await page.locator('#jsonEditor').fill(original);await action('apply-json').click();p=JSON.parse(original);p.document.title='ゲームの要求とフロー';await page.locator('#jsonEditor').fill(JSON.stringify(p.document));await action('apply-json').click();assert.equal(diagrams(await saved()).length,2);await expect(page.locator('h1')).toHaveText('ゲームの要求とフロー');
    await page.locator('#jsonEditor').fill(JSON.stringify({...p.document,categories:[{name:'＜所属先を変更＞',requirements:[]}]}));await action('apply-json').click();await expect(page.locator('#dialog')).toContainText('サイクル図');await action('close-dialog').click();await action('reset-json').click();
  });
  await check('Standard export explains omitted diagrams while document preview includes detailed behavior',async()=>{
    await action('export').click();await expect(page.locator('#dialog')).toContainText('サイクル図・UML図とその詳細仕様・挙動・ルールを含められません');await action('close-dialog').click();
    await tab('document');await expect(page.locator('.document-view')).toContainText('全員のロード完了後にカウントダウンを開始する');await expect(page.locator('.document-view')).toContainText('参加者を待つ');await tab('graph');await graphNode(first).click();
  });
  await check('Node deletion also removes its nested details and incident arrows, and undo restores the whole node',async()=>{
    await node(a).click();const before=await saved();await action('cycle-delete-selection').click();await expect(page.locator('#dialog')).toContainText('詳細 3 件');await action('cycle-confirm-delete').click();await expect(node(a)).toHaveCount(0);let d=diagrams(await saved()).find(d=>d.id===first);assert.ok(!d.edges.some(e=>e.source===a||e.target===a));await action('undo').click();assert.deepEqual((await saved()).cycleDiagrams,before.cycleDiagrams);
  });
  await check('Diagram deletion closes only its tab and undo makes the diagram available from the hierarchy again',async()=>{
    await tab('graph');await graphNode(second).click();await action('cycle-select-diagram').click();await action('cycle-delete-diagram').click();await action('cycle-confirm-delete').click();await expect(page.locator(`[data-tab="cycle:${second}"]`)).toHaveCount(0);assert.equal(diagrams(await saved()).length,1);await action('undo').click();assert.equal(diagrams(await saved()).length,2);await tab('graph');await graphNode(second).click();await expect(page.locator('.cycle-heading')).toContainText('復帰の流れ');
  });
  await check('A diagram can change its owning group while keeping all node specifications and arrows',async()=>{
    await action('cycle-owner').click();await action('add').click();await page.locator('#addKind').selectOption('category:category');await action('confirm-add').click();await page.locator('#editForm [name="name"]').fill('対戦モード');await page.keyboard.press('Control+Enter');
    await tab('cycle:'+first);await action('cycle-select-diagram').click();const before=diagrams(await saved()).find(d=>d.id===first);const target=await field('owner').locator('option').last().getAttribute('value');await field('owner').selectOption(target);await page.keyboard.press('Control+Enter');const p=await saved();assert.equal(p.cycleDiagrams['/categories/1'][0].id,first);assert.deepEqual(p.cycleDiagrams['/categories/1'][0],before);await expect(page.locator('.cycle-heading')).toContainText('対戦モード');
  });
  await check('Cycle UI stays within narrow layouts and the game-flow editor is visually reviewable',async()=>{
    await tab('cycle:'+first);await action('cycle-fit').click();await node(a).click();
    await page.locator('.layout-controls [data-action="cycle-header"]').click();await page.locator('.layout-controls [data-action="toggle-sidebar"]').click();await action('cycle-fit').click();
    await page.screenshot({path:resolve('dist/v1.8-cycle-editor.png'),fullPage:true,style:'#toast{display:none!important}'});
    for(const width of [1280,960,760]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow at ${width}`);await expect(action('cycle-connect')).toBeVisible();}
  });
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  await writeFile(resolve(out,'cycles-results.json'),JSON.stringify({passed:tests.length,tests,errors,requests},null,2));console.log(`${tests.length} cycle browser scenarios passed.`);
}finally{await browser.close();}
