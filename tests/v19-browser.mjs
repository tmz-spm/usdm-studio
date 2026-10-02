import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hydrate,emptyDocument,createNode,projectData,parseInput,validate} from './model.bundle.mjs';
import {createCycle,createCycleNode,createDetail,connectCycle} from './cycles.bundle.mjs';

const doc=hydrate(emptyDocument('ゲームのルールと状態・画面の遷移'));
doc.categories[0].name='＜ゲーム仕様＞';
const req=createNode('requirement',doc);req.requirement='対戦の進行と結果を参加者が把握できる';req.reason='参加者が同じルールとタイミングで対戦するため';doc.categories[0].requirements.push(req);
const sg=createNode('specificationGroup',doc);sg.name='＜対戦の進行＞';sg.specifications[0].specification='対戦時間を10分とする';req.specificationGroups=[sg];
const rg=createNode('requirementGroup',doc);rg.name='＜参加と復帰＞';rg.subRequirements[0].requirement='参加者が対戦へ復帰できる';req.requirementGroups=[rg];
const category=createNode('category',doc);category.name='＜画面構成＞';doc.categories.push(category);
const diagram=createCycle('対戦の流れ'),a=createCycleNode('phase',80,100),b=createCycleNode('state',390,100);
a.text='対戦準備';b.text='対戦中';const detail=createDetail(),behavior=createDetail('behavior'),child=createDetail();
detail.text='参加者と開始時刻を確定する';behavior.text='全員の読み込み完了後にカウントダウンする';child.text='応答がない参加者は待機状態へ戻す';detail.children=[behavior];behavior.children=[child];a.details=[detail];
diagram.nodes=[a,b];connectCycle(diagram,a.id,b.id,'準備が完了');connectCycle(diagram,b.id,a.id,'再戦を選択');connectCycle(diagram,b.id,b.id,'勝敗未確定');
const recovery=createCycle('復帰の流れ'),recoveryNode=structuredClone(a);recoveryNode.text='再参加の準備';recoveryNode.details[0].text='参加枠が空いていることを確認する';recoveryNode.details[0].children=[];recovery.nodes=[recoveryNode];
const screens=createCycle('画面遷移'),screen=createCycleNode('screen');screen.text='対戦結果画面';const screenDetail=createDetail();screenDetail.text='チーム別のスコアを表示する';screen.details=[screenDetail];screens.nodes=[screen];
const initial=projectData(doc,{[sg._key]:['対戦'],[category._key]:['画面']},{[sg._key]:[diagram],[rg._key]:[recovery],[category._key]:[screens]});
assert.equal(validate(initial.document).errors.length,0);

const out=resolve('test-results/browser');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1760,height:1120},acceptDownloads:true});page.setDefaultTimeout(12000);
const tests=[],errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('http'))requests.push(r.url());});page.on('dialog',d=>d.accept());
const action=name=>page.locator(`[data-action="${name}"]:visible`).first(),tab=name=>page.locator(`[data-tab="${name}"]`).click(),field=name=>page.locator(`#cycleForm [name="${name}"]`);
const key=(d,n,detail)=>`cycle:${d.id}${detail?':detail:'+detail.id:n?':node:'+n.id:''}`;
const graph=k=>page.locator(`.graph-node[data-node="${k}"]`),tree=k=>page.locator(`.cycle-tree-row[data-node="${k}"]`),flow=id=>page.locator(`[data-cycle-node="${id}"]`);
const summary=d=>page.locator(`[data-cycle-summary="${d.id}"]`),diagrams=p=>Object.values(p.cycleDiagrams).flat();
let savedIndex=0;
async function saved(){const wait=page.waitForEvent('download');await action('save').click();const download=await wait,path=resolve(out,`v19-save-${savedIndex++}.json`);await download.saveAs(path);return JSON.parse(await readFile(path,'utf8'));}
async function load(p){await page.locator('#fileInput').setInputFiles({name:'upstream.usdm-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});}
async function check(name,fn){await fn();tests.push(name);console.log('PASS '+name);}

try{
  await page.goto(pathToFileURL(resolve('dist/USDM-Studio.html')).href);await load(initial);
  await check('Tree graph shows diagram, flow specification and recursively nested specifications and behaviors',async()=>{
    await tab('graph');await expect(page.locator('.graph-node.cycle')).toHaveCount(3);await expect(page.locator('.graph-node.cycleNode')).toHaveCount(4);await expect(page.locator('.graph-node.cycleSpecification')).toHaveCount(4);await expect(page.locator('.graph-node.cycleBehavior')).toHaveCount(1);
    const keys=[key(diagram),key(diagram,a),key(diagram,a,detail),key(diagram,a,behavior),key(diagram,a,child)];let last=-1;
    for(const k of keys){const x=await graph(k).evaluate(el=>parseFloat(el.style.left));assert.ok(x>last);last=x;assert.equal(await graph(k).getAttribute('draggable'),'false');assert.equal(await graph(k).getAttribute('data-graph-drop'),null);await expect(page.locator(`.graph-edge-plus[data-target="${k}"]`)).toHaveCount(1);}
    await expect(graph(key(diagram,a,detail))).toContainText('詳細仕様');await expect(graph(key(diagram,a,behavior))).toContainText('挙動');await expect(graph(key(recovery,recoveryNode,detail))).toContainText('参加枠');
  });
  await check('Both trees can collapse a flow specification or nested detail without hiding unrelated diagrams',async()=>{
    await tree(key(diagram,a,detail)).locator('[data-collapse]').click();await expect(tree(key(diagram,a,behavior))).toHaveCount(0);await expect(tree(key(diagram,b))).toBeVisible();await tree(key(diagram,a,detail)).locator('[data-collapse]').click();await expect(tree(key(diagram,a,child))).toBeVisible();
    await graph(key(diagram,a)).locator('[data-action="graph-collapse"]').click();await expect(graph(key(diagram,a,detail))).toHaveCount(0);await expect(graph(key(diagram,b))).toHaveCount(1);await graph(key(diagram,a)).locator('[data-action="graph-collapse"]').click();await expect(graph(key(diagram,a,child))).toHaveCount(1);
  });
  await check('Selecting a nested graph or explorer item opens the exact diagram property and reuses its tab',async()=>{
    await graph(key(diagram,a,child)).click();await expect(page.locator('#cycleForm')).toHaveAttribute('data-kind','detail');await expect(field('text')).toHaveValue(child.text);await expect(tree(key(diagram,a,child))).toHaveClass(/selected/);
    await field('text').fill('応答のない参加者を待機へ戻す');await page.keyboard.press('Control+Enter');await tab('graph');await expect(graph(key(diagram,a,child))).toContainText('応答のない参加者');await action('undo').click();await expect(graph(key(diagram,a,child))).toContainText(child.text);
    await tree(key(diagram,a,behavior)).locator('.cycle-tree-link').focus();await page.keyboard.press('Enter');await expect(field('text')).toHaveValue(behavior.text);await expect(page.locator('.cycle-tab')).toHaveCount(1);
    await tree(key(recovery,recoveryNode,detail)).locator('.cycle-tree-link').click();await expect(field('text')).toHaveValue(recoveryNode.details[0].text);await expect(page.locator('.cycle-tab')).toHaveCount(2);
  });
  await check('Structure and content embeds cycle specifications under each owner and includes diagrams without requirements',async()=>{
    await tab('explorer');await action('all').click();await expect(page.locator('.requirement-card').locator(`[data-cycle-summary="${diagram.id}"]`)).toHaveCount(1);await expect(page.locator('.requirement-card').locator(`[data-cycle-summary="${recovery.id}"]`)).toHaveCount(1);await expect(summary(screens)).toContainText(screenDetail.text);await expect(page.locator('.content')).toContainText('対戦時間を10分');await expect(summary(diagram)).toContainText(child.text);
    await summary(diagram).locator(`[data-detail-id="${child.id}"]`).click();await expect(field('text')).toHaveValue(child.text);await field('text').fill('待機表示は <再参加> とする');await page.keyboard.press('Control+Enter');await tab('explorer');await expect(summary(diagram)).toContainText('待機表示は <再参加> とする');await tab('graph');await expect(graph(key(diagram,a,child))).toContainText('待機表示は <再参加> とする');await action('undo').click();
  });
  await check('Search and quick jump find nested cycle specifications and owner labels filter their branches',async()=>{
    await page.locator('#search').fill('応答がない参加者');await expect(graph(key(diagram,a,child))).toHaveCount(1);await expect(graph(key(diagram,b))).toHaveCount(0);await expect(graph(key(diagram))).toHaveCount(1);await expect(tree(key(diagram,a,child))).toBeVisible();await tab('explorer');await expect(page.locator('.cycle-summary')).toHaveCount(1);
    await page.keyboard.press('Control+k');await page.locator('#jumpInput').fill('応答がない参加者');await page.keyboard.press('Enter');await expect(field('text')).toHaveValue(child.text);
    await page.locator('#search').fill('');await tab('graph');await page.locator('#labelFilter').selectOption('対戦');await expect(graph(key(diagram,a,child))).toHaveCount(1);await expect(graph(key(recovery))).toHaveCount(0);await expect(graph(key(screens))).toHaveCount(0);await page.locator('#labelFilter').selectOption('');
  });
  await check('State and screen nodes expose incoming and outgoing transitions and preserve details on kind changes',async()=>{
    await graph(key(diagram,b)).click();await expect(field('kind')).toHaveValue('state');await expect(page.locator('.cycle-transitions [data-direction="incoming"]')).toContainText('入る（2）');await expect(page.locator('.cycle-transitions [data-direction="outgoing"]')).toContainText('出る（2）');
    await page.locator('.cycle-transitions [data-direction="outgoing"] [data-action="cycle-select-edge"]').first().click();await expect(field('label')).toHaveValue('再戦を選択');await field('label').fill('再戦ボタンを押す');await page.keyboard.press('Control+Enter');
    await page.locator('[data-action="cycle-add-node"][data-kind="screen"]').click();await field('text').fill('再戦確認画面');await page.keyboard.press('Control+Enter');await expect(page.locator('.cycle-node.selected')).toHaveClass(/screen/);await expect(page.locator('.cycle-node.selected .screen-titlebar')).toHaveCount(1);
    await flow(a.id).click();await field('kind').selectOption('state');await page.keyboard.press('Control+Enter');await expect(flow(a.id)).toContainText('詳細 3 件');await field('kind').selectOption('phase');await page.keyboard.press('Control+Enter');
    const p=await saved(),d=diagrams(p).find(d=>d.id===diagram.id);assert.equal(d.nodes.find(n=>n.id===a.id).details[0].children[0].children[0].text,child.text);assert.ok(d.nodes.some(n=>n.kind==='state'));assert.ok(d.nodes.some(n=>n.kind==='screen'));assert.ok(d.edges.some(e=>e.label==='再戦ボタンを押す'));
  });
  await check('Saving and reopening rebuilds the same visible hierarchy from one copy of each specification',async()=>{
    const p=await saved();parseInput(JSON.stringify(p));assert.equal(validate(p.document).errors.length,0);assert.ok(!JSON.stringify(p.document).includes('cycle:'));assert.equal(diagrams(p).find(d=>d.id===diagram.id).nodes[0].details.length,1);await load(p);await tab('graph');await expect(graph(key(diagram,a,child))).toHaveCount(1);await expect(page.locator('.graph-node.cycleNode')).toHaveCount(5);assert.deepEqual(await saved(),p);
  });
  await check('Deleting a cycle specification updates both trees and structure view and undo restores the entire branch',async()=>{
    await graph(key(diagram,a,detail)).click();await action('cycle-delete-selection').click();await expect(page.locator('#dialog')).toContainText('配下の詳細 2 件');await action('cycle-confirm-delete').click();await tab('graph');await expect(graph(key(diagram,a,child))).toHaveCount(0);await expect(tree(key(diagram,a,detail))).toHaveCount(0);await tab('explorer');await expect(summary(diagram)).not.toContainText(child.text);await action('undo').click();await expect(summary(diagram)).toContainText(child.text);await tab('graph');await expect(graph(key(diagram,a,child))).toHaveCount(1);
  });
  await check('Hierarchy and content views remain usable at desktop and narrow widths',async()=>{
    await page.locator('.layout-controls [data-action="cycle-header"]').click();await page.locator('.layout-controls [data-action="toggle-sidebar"]').click();await page.locator('.layout-controls [data-action="toggle-inspector"]').click();await action('graph-fit').click();await page.screenshot({path:resolve('dist/v1.9-cycle-hierarchy.png'),fullPage:true,style:'#toast{display:none!important}'});
    await tab('explorer');await page.screenshot({path:resolve('dist/v1.9-cycle-content.png'),fullPage:true,style:'#toast{display:none!important}'});
    for(const width of [1280,960,760]){await page.setViewportSize({width,height:1050});for(const t of ['graph','explorer']){await tab(t);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${t} overflow at ${width}`);}}
  });
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await writeFile(resolve(out,'v19-results.json'),JSON.stringify({passed:tests.length,tests,errors,requests},null,2));console.log(`${tests.length} v1.9 browser scenarios passed.`);
}finally{await browser.close();}
