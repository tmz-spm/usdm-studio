import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hydrate,emptyDocument,projectData,parseInput} from './model.bundle.mjs';
import {createCycle,createCycleNode,createDetail,connectCycle} from './cycles.bundle.mjs';

const doc=hydrate(emptyDocument('棒の向き')),d=createCycle('同期の編集','activity');
d.nodes=[createCycleNode('action',80,180),createCycleNode('join',390,180),createCycleNode('fork',680,180)];
const [a,join,fork]=d.nodes;join.text='全員の準備を待つ';fork.text='並行して処理';fork.barOrientation='horizontal';join.details=[createDetail()];join.details[0].text='味方全員の準備が完了したら進む';
const edge=connectCycle(d,a.id,join.id,'準備完了');edge.sourceAnchor={angle:0};edge.targetAnchor={angle:180};edge.route={x:20,y:45};
const initial=projectData(doc,{}, {[doc.categories[0]._key]:[d]}),out=resolve('test-results/browser');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),contexts=await Promise.all([0,1].map(()=>browser.newContext({viewport:{width:1700,height:1050},acceptDownloads:true,permissions:['clipboard-read','clipboard-write']}))),[page,other]=await Promise.all(contexts.map(c=>c.newPage()));
const tests=[],errors=[],requests=[];for(const p of [page,other]){p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().startsWith('http'))requests.push(r.url());});p.on('dialog',x=>x.accept());}
const action=(name,p=page)=>p.locator(`[data-action="${name}"]:visible`).first(),field=name=>page.locator(`#cycleForm [name="${name}"]`),node=(id,p=page)=>p.locator(`[data-cycle-node="${id}"]`),diagram=p=>Object.values(p.cycleDiagrams).flat()[0];let saveIndex=0;
async function check(name,fn){await fn();tests.push(name);console.log('PASS '+name);}
async function load(p=page,project=initial){await p.bringToFront();await p.locator('#fileInput').setInputFiles({name:'bar-test.usdm-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await p.locator('[data-tab="graph"]').click();await p.locator(`.graph-node[data-node="cycle:${d.id}"]`).click();await action('cycle-fit',p).click();}
async function saved(p=page){await p.bringToFront();const wait=p.waitForEvent('download');await action('save',p).click();const download=await wait,path=resolve(out,`v1141-save-${saveIndex++}.json`);await download.saveAs(path);return JSON.parse(await readFile(path,'utf8'));}
async function select(id,p=page){await node(id,p).locator('.cycle-node-shape > *').first().click();}
async function submit(){await page.locator('#cycleForm button[type="submit"]').click();}
async function bar(id,orientation,p=page){const rect=node(id,p).locator('rect');await expect(rect).toHaveAttribute('width',orientation==='vertical'?'12':'160');await expect(rect).toHaveAttribute('height',orientation==='vertical'?'96':'12');}
async function tail(id){return page.locator(`.cycle-tail:has([data-cycle-tail="${id}"])`).evaluate(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top)}));}
try{
  const url=pathToFileURL(resolve('dist/USDM-Studio.html')).href;await page.goto(url);await other.goto(url);
  await check('New synchronization and fork nodes default to vertical bars with a rightward terminal line',async()=>{
    await load();for(const kind of ['join','fork']){await page.locator(`[data-action="cycle-add-node"][data-kind="${kind}"]`).click();await expect(field('barOrientation')).toHaveValue('vertical');const n=diagram(await saved()).nodes.at(-1);await bar(n.id,'vertical');assert.deepEqual(await tail(n.id),{x:n.x+106,y:n.y+41});const line=page.locator(`[data-cycle-tail="${n.id}"]`),plus=page.locator(`[data-action="cycle-add-tail"][data-id="${n.id}"]`);await action('cycle-fit').click();const l=await line.boundingBox(),b=await plus.boundingBox();assert.ok(b.x>l.x);}
  });
  await check('Orientation properties rotate the bar and reattach the existing edge without changing its route or content',async()=>{
    await load();await select(join.id);await expect(field('barOrientation')).toHaveValue('vertical');await field('barOrientation').selectOption('horizontal');await submit();await bar(join.id,'horizontal');assert.deepEqual(await tail(join.id),{x:join.x+180,y:join.y+41});const p=await saved(),n=diagram(p).nodes[1];assert.deepEqual(n,{...join,barOrientation:'horizontal'});assert.deepEqual(diagram(p).edges,[edge]);const end=await page.locator(`[data-cycle-edge="${edge.id}"] .cycle-edge-hit`).evaluate(el=>{const p=el.getPointAtLength(el.getTotalLength());return {x:p.x,y:p.y};});assert.ok(Math.abs(end.x-(join.x+20))<.01);assert.ok(Math.abs(end.y-(join.y+54))<.01);await action('undo').click();await bar(join.id,'vertical');await action('redo').click();await bar(join.id,'horizontal');
  });
  await check('Legacy bars remain horizontal and retain project v5 until a direction is explicitly applied',async()=>{
    const old=structuredClone(initial);diagram(old).nodes.forEach(n=>delete n.barOrientation);old.projectVersion=5;await load(page,old);await bar(join.id,'horizontal');assert.equal((await saved()).projectVersion,5);await select(join.id);await expect(field('barOrientation')).toHaveValue('horizontal');await field('barOrientation').selectOption('vertical');await submit();assert.equal((await saved()).projectVersion,6);await bar(join.id,'vertical');
  });
  await check('Changing to a bar offers vertical by default, and leaving the bar kind warns before removing its setting',async()=>{
    await load();await select(a.id);await expect(page.locator('#cycleBarFields')).toBeHidden();await field('kind').selectOption('join');await expect(field('barOrientation')).toBeVisible();await expect(field('barOrientation')).toHaveValue('vertical');await submit();await bar(a.id,'vertical');await field('kind').selectOption('action');await submit();await expect(page.locator('#dialog')).toContainText('棒の向きの設定を取り除きます');await action('close-dialog').click();await submit();await action('cycle-confirm-kind').click();await expect(page.locator('#cycleBarFields')).toBeHidden();assert.equal(diagram(await saved()).nodes[0].barOrientation,undefined);
  });
  await check('Saving, reopening and copying through the real clipboard to another browser tab retain both bar directions',async()=>{
    await load();const p=await saved();parseInput(JSON.stringify(p));await load(page,p);await select(join.id);await node(fork.id).locator('rect').click({modifiers:['Control']});await page.locator('.cycle-viewport').focus();await page.keyboard.press('Control+c');const empty=structuredClone(initial);diagram(empty).nodes=[];diagram(empty).edges=[];await load(other,empty);await other.locator('.cycle-viewport').focus();await other.keyboard.press('Control+v');await expect(other.locator('.cycle-node')).toHaveCount(2);const next=diagram(await saved(other));assert.deepEqual(next.nodes.map(n=>n.barOrientation),['vertical','horizontal']);assert.equal(next.nodes[0].details[0].text,join.details[0].text);await bar(next.nodes[0].id,'vertical',other);await bar(next.nodes[1].id,'horizontal',other);await action('undo',other).click();await expect(other.locator('.cycle-node')).toHaveCount(0);
  });
  await check('The rightward plus on a vertical bar appends and connects an action while retaining bar orientation',async()=>{
    await load();await page.locator(`[data-action="cycle-add-tail"][data-id="${join.id}"]`).click();await page.locator('#cycleTailText').fill('準備後に開始する');await action('cycle-confirm-tail').click();const next=diagram(await saved()),added=next.nodes.find(n=>n.text==='準備後に開始する');assert.ok(added);assert.equal(added.kind,'action');assert.ok(next.edges.some(e=>e.source===join.id&&e.target===added.id));assert.equal(next.nodes.find(n=>n.id===join.id).barOrientation,'vertical');await expect(page.locator(`[data-cycle-tail="${join.id}"]`)).toHaveCount(0);
  });
  await check('Vertical labels remain clear of the bar and tail, and both orientations stay usable in the properties panel',async()=>{
    await load();await select(join.id);const text=await node(join.id).locator('.cycle-node-text').boundingBox(),shape=await node(join.id).locator('rect').boundingBox();assert.ok(text.x+text.width<shape.x);await page.screenshot({path:resolve('dist/v1141-bars.png'),fullPage:true});await page.setViewportSize({width:900,height:850});await expect(field('barOrientation')).toBeVisible();await field('barOrientation').selectOption('horizontal');await submit();await bar(join.id,'horizontal');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await writeFile(resolve(out,'v1141-results.json'),JSON.stringify({passed:tests.length,tests,errors,requests},null,2));console.log(`${tests.length} v1.14.1 browser scenarios passed.`);
}catch(e){await page.screenshot({path:resolve(out,'v1141-failure.png'),fullPage:true});console.error(e);process.exitCode=1;}finally{await browser.close();}
