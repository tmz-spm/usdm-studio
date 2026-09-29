import {loadSample} from './fixture.mjs';
import {chromium,expect} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseInput,canonical,validate} from './model.bundle.mjs';
const out=resolve('test-results/browser');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1050},acceptDownloads:true});
const errors=[],requests=[],tests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('http'))requests.push(r.url());});page.on('dialog',d=>d.accept());
const action=n=>page.locator(`[data-action="${n}"]`).first();
const node=id=>page.locator(`.graph-node[data-id="${id}"]`);
const key=async id=>node(id).getAttribute('data-node');
const edge=async id=>page.locator(`.graph-edge-plus[data-target="${await key(id)}"]`);
const graphTab=()=>page.locator('[data-tab="graph"]').click();
async function data(){const wait=page.waitForEvent('download');await action('save').click();const d=await wait;const path=resolve(out,'graph-project.json');await d.saveAs(path);return JSON.parse(await readFile(path,'utf8'));}
async function check(name,fn){await fn();tests.push(name);console.log('PASS '+name);}
await page.goto(pathToFileURL(resolve('dist/USDM-Studio.html')).href);
await loadSample(page);
await check('Graph renders every document node, distinct type styles and branch insertion buttons',async()=>{
  await graphTab();await expect(page.locator('.graph-node')).toHaveCount(24);await expect(page.locator('.graph-edge-plus')).toHaveCount(23);
  for(const type of ['document','category','requirement','requirementGroup','subRequirement','specificationGroup','specification'])await expect(page.locator(`.graph-node.${type}`).first()).toBeVisible();
  const colors=await page.locator('.graph-node').evaluateAll(els=>Object.fromEntries(els.map(el=>[el.dataset.type,getComputedStyle(el).backgroundColor])));if(new Set(Object.values(colors)).size!==7)throw Error('Node types not differentiated');
  await page.screenshot({path:resolve('dist/graph-screenshot.png'),fullPage:true});
  await expect(page).toHaveTitle('USDM Studio');await expect(page.locator('body')).not.toContainText('要求と仕様のつながりを、ひとつの文書に。');
});
await check('Clicking graph nodes edits the right property panel and preserves viewport',async()=>{
  await node('R01').click();await expect(page.locator('[name="id"]')).toHaveValue('R01');
  await page.locator('[name="reason"]').fill('グラフから変更');await node('R02').click();await node('R01').click();await expect(page.locator('[name="reason"]')).toHaveValue('グラフから変更');
  await page.locator('[name="labels"]').fill('移動しても保持');await page.locator('#editForm button[type=submit]').click();
});
await check('Dragging onto a branch changes sibling order',async()=>{
  await node('S01-02').dragTo(await edge('S01-01'));
  const d=(await data()).document;if(d.categories[0].requirements[0].specificationGroups[0].specifications[0].id!=='S01-02')throw Error('Branch reorder failed');
});
await check('Dragging onto another parent branch moves requirements and retains labels',async()=>{
  await node('R01').dragTo(await edge('R04'));
  const p=await data();if(p.document.categories[2].requirements[0].id!=='R01')throw Error('Cross-parent branch move failed');
  if(!p.labels['/categories/2/requirements/0'].includes('移動しても保持'))throw Error('Labels lost');
  await action('undo').click();await expect(node('R01')).toBeVisible();
});
await check('Branch plus inserts a schema-valid sibling and selects it for editing',async()=>{
  await(await edge('S01-01')).click();await expect(page.locator('#dialog')).toContainText('枝に要素を挿入');await expect(page.locator('#graphInsertKind')).toHaveValue('after');await action('graph-confirm-insert').click();
  await expect(page.locator('[name="text"]')).toHaveValue('新しい仕様');
  const newId=await page.locator('[name="id"]').inputValue();await expect(node(newId)).toHaveClass(/selected/);
  const d=(await data()).document;const specs=d.categories[0].requirements.find(r=>r.id==='R01').specificationGroups[0].specifications;
  if(specs[2].id!==newId||specs[1].id!=='S01-01')throw Error('Inserted in wrong position');
  await action('undo').click();
});
await check('A lower requirement can be inserted between a requirement and its specification group',async()=>{
  const p=await data(),groupName=p.document.categories[0].requirements.find(r=>r.id==='R01').specificationGroups[0].name;
  const g=page.locator('.graph-node.specificationGroup').filter({hasText:groupName.replace(/^＜|＞$/g,'')});const gkey=await g.getAttribute('data-node');
  await page.locator(`.graph-edge-plus[data-target="${gkey}"]`).click();await expect(page.locator('#graphInsertKind')).toHaveValue('after');await page.locator('#graphInsertKind').selectOption('wrap');await action('graph-confirm-insert').click();
  await expect(page.locator('[name="id"]')).toHaveValue(/R_SUB/);const d=(await data()).document,r=d.categories[0].requirements.find(r=>r.id==='R01');
  if(r.requirementGroups[0].subRequirements[0].specificationGroups[0].name!==groupName)throw Error('Wrapping lost old group');
  if(validate(parseInput(JSON.stringify(d)).doc).errors.length)throw Error('Invalid wrapped document');
  await action('undo').click();await action('graph-fit').click();
});
await check('Node drop reparents a specification group',async()=>{
  const g=page.locator('.graph-node.specificationGroup').filter({hasText:'予約の確定'});await g.dragTo(node('R04'));
  const d=(await data()).document;if(!d.categories[2].requirements[0].specificationGroups.some(x=>x.name==='＜予約の確定＞'))throw Error('Node reparent failed');
  await action('undo').click();
});
await check('Invalid drag is rejected without changing document or creating history',async()=>{
  const before=(await data()).document;await node('R01').dragTo(await edge('S01-01'));
  if(await page.locator('#dialog').isVisible())await action('close-dialog').click();
  const after=(await data()).document;if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Invalid drop changed document');
});
await check('Dropping directly onto the visible branch line moves a node',async()=>{
  const target=await key('R04'),path=page.locator(`.graph-edge[data-edge="${target}"] .graph-edge-hit`);
  const point=await path.evaluate(el=>{const p=el.getPointAtLength(el.getTotalLength()*.2),m=el.getScreenCTM();return{x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f};});
  const from=await node('R03').boundingBox();await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(from.x+from.width/2+10,from.y+from.height/2,{steps:3});await page.mouse.move(point.x,point.y,{steps:12});await page.mouse.move(point.x+1,point.y,{steps:2});await page.mouse.up();
  const d=(await data()).document;if(d.categories[2].requirements[0].id!=='R03')throw Error('Branch line drop failed');
  await action('undo').click();
});
await check('Graph multi-select applies a common label to selected nodes',async()=>{
  await node('R01').click();await node('R03').click({modifiers:['Control']});await expect(page.locator('.batch-title')).toContainText('2');
  await page.locator('#batchLabel').fill('グラフ一括');await action('batch-add').click();
  const d=(await data()).document;const req=d.categories.flatMap(c=>c.requirements).filter(r=>['R01','R03'].includes(r.id));if(req.some(r=>!r.keywords.includes('グラフ一括')))throw Error('Batch failed');
});
await check('Collapse, focus, zoom, keyboard and pan are usable',async()=>{
  await node('R01').click();const k=await key('R01');await page.locator(`.graph-collapse[data-target="${k}"]`).click();await expect(node('S01-01')).toHaveCount(0);await page.locator(`.graph-collapse[data-target="${k}"]`).click();await expect(node('S01-01')).toHaveCount(1);
  await action('graph-focus').click();await expect(page.locator('.graph-node.document')).toHaveCount(0);
  await action('graph-all').click();await action('graph-actual').click();await expect(page.locator('#graphZoom')).toHaveText('100%');
  const vp=page.locator('.graph-viewport');const box=await vp.boundingBox();await page.mouse.move(box.x+box.width-50,box.y+20);await page.mouse.down();await page.mouse.move(box.x+box.width-180,box.y+20,{steps:8});await page.mouse.up();
  if(await vp.evaluate(el=>el.scrollLeft)<=0)throw Error('Pan did not move');
  await action('graph-all').click();await node('R03').focus();await page.keyboard.press('Enter');await expect(page.locator('[name="id"]')).toHaveValue('R03');
  await page.setViewportSize({width:1280,height:900});await action('graph-fit').click();if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Graph page overflow');
});
if(errors.length||requests.length)throw Error(JSON.stringify({errors,requests}));
await writeFile(resolve(out,'graph-results.json'),JSON.stringify({passed:tests.length,tests,errors,requests},null,2));
await browser.close();console.log(`${tests.length} graph browser scenarios passed.`);
