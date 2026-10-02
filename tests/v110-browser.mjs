import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hydrate,emptyDocument,createNode,projectData,parseInput} from './model.bundle.mjs';
import {CYCLE_NODE,createCycle,createCycleNode,createDetail,connectCycle} from './cycles.bundle.mjs';

const doc=hydrate(emptyDocument('サイクル図の挿入と集中編集'));
doc.categories[0].name='＜ゲーム仕様＞';const req=createNode('requirement',doc);req.requirement='対戦の進行を把握できる';doc.categories[0].requirements.push(req);
const group=createNode('specificationGroup',doc);group.name='＜対戦の進行＞';req.specificationGroups=[group];
const other=createNode('category',doc);other.name='＜別の仕様＞';doc.categories.push(other);
const d=createCycle('対戦の流れ'),a=createCycleNode('phase',80,110),b=createCycleNode('state',420,110),detail=createDetail(),behavior=createDetail('behavior');
a.text='対戦準備';b.text='対戦中';detail.text='参加者の準備を確認する';behavior.text='読み込み完了後に対戦を開始する';detail.children=[behavior];a.details=[detail];d.nodes=[a,b];
const forward=connectCycle(d,a.id,b.id,'準備完了'),back=connectCycle(d,b.id,a.id,'再戦'),loop=connectCycle(d,a.id,a.id,'参加者を待つ');
const second=createCycle('受付の流れ'),secondNode=createCycleNode('screen');secondNode.text='受付画面';second.nodes=[secondNode];
const initial=projectData(doc,{[group._key]:['ゲーム'],[other._key]:['別']},{[group._key]:[d],[other._key]:[second]});
const out=resolve('test-results/browser');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1700,height:1100},acceptDownloads:true});page.setDefaultTimeout(12000);
const tests=[],errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('http'))requests.push(r.url());});page.on('dialog',dialog=>dialog.accept());
const action=name=>page.locator(`[data-action="${name}"]:visible`).first(),tab=name=>page.locator(`[data-tab="${name}"]`).click(),field=name=>page.locator(`#cycleForm [name="${name}"]`);
const key=(diagram,node,item)=>`cycle:${diagram.id}${item?':detail:'+item.id:node?':node:'+node.id:''}`;
const graph=k=>page.locator(`.graph-node[data-node="${k}"]`),tree=k=>page.locator(`.cycle-tree-row[data-node="${k}"]`),plus=k=>page.locator(`.graph-edge-plus[data-target="${k}"]`);
const diagrams=p=>Object.values(p.cycleDiagrams).flat(),cycle=p=>diagrams(p).find(x=>x.id===d.id);let saveIndex=0;
async function check(name,fn){await fn();tests.push(name);console.log('PASS '+name);}
async function load(p){await page.locator('#fileInput').setInputFiles({name:'cycles.usdm-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});}
async function saved(){const wait=page.waitForEvent('download');await action('save').click();const download=await wait,path=resolve(out,`v110-save-${saveIndex++}.json`);await download.saveAs(path);return JSON.parse(await readFile(path,'utf8'));}

try{
  await page.goto(pathToFileURL(resolve('dist/USDM-Studio.html')).href);await load(initial);
  await check('A hierarchy branch to a cycle diagram has a working plus with insertion after selected by default',async()=>{
    await tab('graph');await plus(key(d)).click();await expect(page.locator('#cycleInsertPosition')).toHaveValue('after');await page.locator('#cycleInsertText').fill('追加のサイクル図');await action('cycle-confirm-hierarchy-insert').click();
    const p=await saved(),list=Object.values(p.cycleDiagrams).find(list=>list.some(x=>x.id===d.id));assert.equal(list[0].id,d.id);assert.equal(list[1].title,'追加のサイクル図');await expect(page.locator('.cycle-heading')).toContainText('追加のサイクル図');await action('undo').click();assert.equal(diagrams(await saved()).length,2);await tab('graph');
  });
  await check('Hierarchy plus adds neighboring flow specifications and wraps existing details without losing their children',async()=>{
    await plus(key(d,a)).click();await expect(page.locator('#cycleInsertPosition')).toHaveValue('after');await page.locator('#cycleInsertPosition').selectOption('before');await page.locator('#cycleInsertKind').selectOption('state');await page.locator('#cycleInsertText').fill('参加待ち');await action('cycle-confirm-hierarchy-insert').click();let current=cycle(await saved());assert.equal(current.nodes[0].text,'参加待ち');assert.equal(current.nodes[1].id,a.id);assert.deepEqual(current.edges,d.edges);await action('undo').click();await tab('graph');
    await plus(key(d,a,detail)).click();await page.locator('#cycleInsertPosition').selectOption('wrap');await page.locator('#cycleInsertText').fill('開始前の制御');await action('cycle-confirm-hierarchy-insert').click();current=cycle(await saved());assert.equal(current.nodes[0].details[0].text,'開始前の制御');assert.deepEqual(current.nodes[0].details[0].children,[detail]);await action('undo').click();await tab('graph');
  });
  await check('Cycle arrow plus inserts between endpoints and retains the original condition with atomic undo and redo',async()=>{
    await graph(key(d)).click();await action('cycle-fit').click();await expect(page.locator('.cycle-edge-plus')).toHaveCount(3);const before=await saved();await page.locator(`.cycle-edge-plus[data-id="${forward.id}"]`).click();await action('close-dialog').click();assert.deepEqual(await saved(),before);
    await page.locator(`.cycle-edge-plus[data-id="${forward.id}"]`).click();await page.locator('#cycleInsertKind').selectOption('action');await page.locator('#cycleInsertText').fill('開始を通知する');await action('cycle-confirm-edge-insert').click();const after=await saved(),current=cycle(after),inserted=current.nodes.find(n=>n.text==='開始を通知する'),original=current.edges.find(e=>e.id===forward.id);assert.equal(original.source,a.id);assert.equal(original.target,inserted.id);assert.equal(original.label,'準備完了');assert.ok(current.edges.some(e=>e.source===inserted.id&&e.target===b.id&&e.label===''));assert.deepEqual(current.nodes.find(n=>n.id===a.id).details,a.details);await expect(field('text')).toHaveValue(inserted.text);await expect(page.locator('.cycle-edge-plus')).toHaveCount(4);
    await action('undo').click();assert.deepEqual((await saved()).cycleDiagrams,before.cycleDiagrams);await action('redo').click();assert.deepEqual((await saved()).cycleDiagrams,after.cycleDiagrams);
  });
  await check('Focused explorer reveals a hidden sidebar and shows only the current diagram independently of document filters',async()=>{
    await page.locator('#search').fill('ゲーム');await page.locator('#labelFilter').selectOption('別');await page.locator('.layout-controls [data-action="toggle-sidebar"]').click();await action('cycle-explorer').click();await expect(page.locator('#explorerPanel')).toBeVisible();await expect(page.locator('[data-action="explorer-focus"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#search')).toHaveValue('');await expect(page.locator('#labelFilter')).toHaveCount(0);await expect(tree(key(d))).toBeVisible();await expect(tree(key(second))).toHaveCount(0);await expect(page.locator('.tree-row:not(.cycle-tree-row)')).toHaveCount(0);assert.equal(await tree(key(d)).evaluate(el=>parseFloat(el.style.paddingLeft)),7);
    await action('explorer-document').click();await expect(page.locator('#search')).toHaveValue('ゲーム');await expect(page.locator('#labelFilter')).toHaveValue('別');await page.locator('#search').fill('');await page.locator('#labelFilter').selectOption('');await action('explorer-focus').click();
  });
  await check('Focused search and collapse follow the active diagram tab and preserve independent per-diagram views',async()=>{
    await page.locator('#search').fill('読み込み');await expect(tree(key(d,a,behavior))).toBeVisible();await expect(tree(key(d,b))).toHaveCount(0);await tab('graph');await graph(key(second)).click();await expect(page.locator('#search')).toHaveValue('');await expect(tree(key(second,secondNode))).toBeVisible();await expect(tree(key(d))).toHaveCount(0);await page.locator('#search').fill('受付');
    await tab('cycle:'+d.id);await expect(page.locator('#search')).toHaveValue('読み込み');await page.locator('#search').fill('');await tree(key(d,a,detail)).locator('[data-collapse]').click();await expect(tree(key(d,a,behavior))).toHaveCount(0);await tab('cycle:'+second.id);await expect(page.locator('#search')).toHaveValue('受付');await tab('cycle:'+d.id);await expect(tree(key(d,a,behavior))).toHaveCount(0);
    await action('explorer-document').click();await expect(tree(key(d,a,behavior))).toHaveCount(1);await action('explorer-focus').click();await expect(tree(key(d,a,behavior))).toHaveCount(0);
  });
  await check('Explorer scope, search and folding preserve invalid property drafts without saving or losing them',async()=>{
    await tree(key(d,a)).locator('.cycle-tree-link').click();await field('text').fill('');const before=await page.evaluate(()=>localStorage.getItem('usdm-studio.autosave.v1'));
    await action('explorer-document').click();await expect(field('text')).toHaveValue('');await action('cycle-explorer').click();await page.locator('#search').fill('読み込み');await action('cycle-explorer-expand').click();await action('cycle-explorer-collapse').click();await expect(field('text')).toHaveValue('');assert.equal(await page.evaluate(()=>localStorage.getItem('usdm-studio.autosave.v1')),before);
    await tree(key(d,a,behavior)).locator('.cycle-tree-link').click();await expect(page.locator('#dialog')).toContainText('大まかな仕様・場面');await action('close-dialog').click();await expect(field('text')).toHaveValue('');await action('cycle-discard').click();await page.locator('#search').fill('');await action('cycle-explorer-expand').click();
  });
  await check('Focused explorer adds into the current diagram and reflects deletion and undo in its outline',async()=>{
    const before=cycle(await saved()).nodes.length;await action('cycle-explorer-add').click();await field('text').fill('後処理');await page.keyboard.press('Control+Enter');const current=cycle(await saved()),node=current.nodes.find(n=>n.text==='後処理');assert.equal(current.nodes.length,before+1);assert.ok(current.nodes.filter(n=>n.id!==node.id).every(n=>Math.abs(n.x-node.x)>=CYCLE_NODE.width||Math.abs(n.y-node.y)>=CYCLE_NODE.height),'Added node must not overlap existing or inserted nodes');await expect(tree(key(d,node))).toBeVisible();await action('cycle-delete-selection').click();await action('cycle-confirm-delete').click();await expect(tree(key(d,node))).toHaveCount(0);await action('undo').click();await expect(tree(key(d,node))).toHaveCount(1);
  });
  await check('Project round-trip preserves insertions while keeping explorer preferences outside the saved JSON',async()=>{
    const p=await saved();parseInput(JSON.stringify(p));assert.ok(!JSON.stringify(p).includes('explorer'));assert.equal(p.projectVersion,2);await page.locator('#search').fill('後処理');await load(p);await tab('graph');await graph(key(d)).click();await expect(page.locator('#search')).toHaveValue('');await expect(tree(key(d,a,behavior))).toHaveCount(1);assert.deepEqual(await saved(),p);await page.locator(`[data-action="cycle-close"][data-id="${d.id}"]`).click();await expect(page.locator('.tree-row:not(.cycle-tree-row)')).not.toHaveCount(0);await graph(key(d)).click();
  });
  await check('Insertion buttons and focused explorer stay usable across layout sizes',async()=>{
    await tree(key(d,a)).locator('.cycle-tree-link').click();await page.locator('.layout-controls [data-action="cycle-header"]').click();await action('cycle-fit').click();await page.screenshot({path:resolve('dist/v1.10-cycle-explorer.png'),fullPage:true,style:'#toast{display:none!important}'});
    for(const width of [1280,960,760]){await page.setViewportSize({width,height:1050});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow at ${width}`);await expect(action('cycle-explorer')).toBeVisible();await expect(action('explorer-document')).toBeVisible();await action('cycle-fit').click();await expect(page.locator('.cycle-edge-plus').first()).toBeVisible();}
  });
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await writeFile(resolve(out,'v110-results.json'),JSON.stringify({passed:tests.length,tests,errors,requests},null,2));console.log(`${tests.length} v1.10 browser scenarios passed.`);
}finally{await browser.close();}
