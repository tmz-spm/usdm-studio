import {loadSample} from './fixture.mjs';
import {chromium,expect} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseInput,validate} from './model.bundle.mjs';
const out=resolve('test-results/browser');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const ctx=await browser.newContext({viewport:{width:1512,height:1050},acceptDownloads:true});
const page=await ctx.newPage(),errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('http'))requests.push(r.url());});
page.on('dialog',d=>d.accept());
await page.goto(pathToFileURL(resolve('dist/USDM-Studio.html')).href);
const action=n=>page.locator(`[data-action="${n}"]`).first();
const treeId=id=>page.locator('.tree-row').filter({has:page.locator('.node-id',{hasText:new RegExp('^'+id+'$')})});
const textTree=s=>page.locator('.tree-row').filter({has:page.locator('.node-label',{hasText:s})});
const checkbox=id=>treeId(id).locator('input[type=checkbox]');
const tests=[];
async function check(name,fn){await fn();tests.push(name);console.log('PASS '+name);}
await check('Offline startup is an empty, schema-valid document ready for its first requirement',async()=>{
  await expect(page.locator('h1')).toHaveText('新しい要求仕様書');
  await expect(page.locator('.requirement-card')).toHaveCount(0);
  await expect(page.locator('.tree-row')).toHaveCount(1);
  await expect(page.locator('[name="name"]')).toHaveValue('＜機能要求＞');
  await page.screenshot({path:resolve('dist/screenshot.png'),fullPage:true});
  await page.locator('[data-tab="json"]').click();
  const initial=parseInput(await page.locator('#jsonEditor').inputValue()).doc;
  if(validate(initial).errors.length||initial.categories[0].requirements.length)throw Error('Invalid empty document');
  await page.locator('[data-tab="explorer"]').click();
  await page.locator('[data-action="quick-add"][data-type="requirement"]').click();
  await expect(page.locator('[name="id"]')).toHaveValue('R01');
  await action('undo').click();await expect(page.locator('.requirement-card')).toHaveCount(0);
});
await check('Importing an existing document remains available from the empty startup',async()=>{
  await loadSample(page);
  await expect(page.locator('h1')).toHaveText('予約管理システム 要求仕様書');
  await expect(page.locator('.requirement-card')).toHaveCount(4);
  await expect(page.locator('.tree-row')).toHaveCount(23);
});
await check('Edit persists when switching nodes; shared keyword batch is scoped',async()=>{
  await page.locator('[name="reason"]').fill('編集した理由');
  await treeId('R03').click();
  await treeId('R01').click();
  await expect(page.locator('[name="reason"]')).toHaveValue('編集した理由');
  await checkbox('R03').check();
  await page.locator('#batchLabel').fill('優先度高, 初版');
  await action('batch-add').click();
  await treeId('R01').click();
  await expect(page.locator('[name="keywords"]')).toHaveValue(/優先度高/);
  await treeId('R03').click();
  await expect(page.locator('[name="keywords"]')).toHaveValue(/初版/);
  await treeId('R04').click();
  await expect(page.locator('[name="keywords"]')).not.toHaveValue(/初版/);
});
await check('Mixed element free labels persist and standard export excludes them',async()=>{
  await treeId('R01').click();await checkbox('S01-01').check();
  await page.locator('#batchTarget').selectOption('labels');
  await page.locator('#batchLabel').fill('確認待ち');await action('batch-add').click();
  const pd=page.waitForEvent('download');await action('save').click();const project=await pd;await project.saveAs(resolve(out,'saved-project.json'));
  const saved=parseInput(await readFile(resolve(out,'saved-project.json'),'utf8'));
  if(Object.values(saved.labels).filter(x=>x.includes('確認待ち')).length!==2)throw Error('Free labels not saved');
  const sd=page.waitForEvent('download');await action('export').click();await(await sd).saveAs(resolve(out,'standard.json'));
  const raw=await readFile(resolve(out,'standard.json'),'utf8');if(raw.includes('確認待ち')||raw.includes('_key'))throw Error('Standard JSON polluted');
  if(validate(parseInput(raw).doc).errors.length)throw Error('Invalid exported JSON');
});
await check('Insert specification before selection, delete, undo and redo',async()=>{
  await treeId('S01-02').click();await action('insert').click();await expect(page.locator('#addKind')).toHaveValue('after:specification');await page.locator('#addKind').selectOption('before:specification');await action('confirm-add').click();
  await expect(page.locator('[name="text"]')).toHaveValue('新しい仕様');
  const id=await page.locator('[name="id"]').inputValue();
  await page.locator('[name="text"]').fill('追加した仕様');await page.locator('#editForm button[type=submit]').click();
  await action('delete').click();await action('confirm-delete').click();await expect(treeId(id)).toHaveCount(0);
  await action('undo').click();await expect(treeId(id)).toHaveCount(1);
  await action('redo').click();await expect(treeId(id)).toHaveCount(0);
});
await check('Move requirement across categories and preserve labels',async()=>{
  await treeId('R03').click();await action('move').click();
  const target=await textTree('品質要求').getAttribute('data-node');await page.locator('#moveTarget').selectOption(target);await action('confirm-move').click();
  await treeId('R03').click();await expect(page.locator('[name="keywords"]')).toHaveValue(/初版/);
  await page.locator('[data-tab="json"]').click();
  const d=JSON.parse(await page.locator('#jsonEditor').inputValue());
  if(!d.categories[2].requirements.some(r=>r.id==='R03'))throw Error('Move failed');
  await page.locator('[data-tab="explorer"]').click();
});
await check('Invalid deletion is blocked and retains last child',async()=>{
  await treeId('S03-01').click();await action('delete').click();await action('confirm-delete').click();
  await expect(page.locator('#dialog')).toBeVisible();await expect(page.locator('#dialog')).toContainText('必須の子要素');
  await action('close-dialog').click();await expect(treeId('S03-01')).toHaveCount(1);
});
await check('JSON syntax/schema errors leave document intact and corrected JSON applies',async()=>{
  await page.locator('[data-tab="json"]').click();const original=await page.locator('#jsonEditor').inputValue();
  await page.locator('#jsonEditor').fill('{invalid');await action('apply-json').click();await expect(page.locator('#dialog')).toBeVisible();await action('close-dialog').click();
  const d=JSON.parse(original);d.title='JSON編集済み文書';await page.locator('#jsonEditor').fill(JSON.stringify(d));await action('apply-json').click();
  await expect(page.locator('h1')).toHaveText('JSON編集済み文書');
  await page.locator('[data-tab="explorer"]').click();
});
await check('Relations follow edited requirement ID',async()=>{
  await page.locator('[data-tab="relations"]').click();await action('add-relation').click();await page.locator('#rel0').selectOption('R01');await page.locator('#rel1').selectOption('R04');await action('confirm-relation').click();
  await treeId('R01').click();await page.locator('[name="id"]').fill('R_NEW');await page.locator('#editForm button[type=submit]').click();await expect(page.locator('.rel-path')).toHaveText('R_NEW　 →　 R04');
});
await check('Project file reimport restores original title and free labels',async()=>{
  await page.locator('#fileInput').setInputFiles(resolve(out,'saved-project.json'));
  await expect(page.locator('h1')).toHaveText('予約管理システム 要求仕様書');
  await treeId('S01-01').click();await expect(page.locator('[name="labels"]')).toHaveValue('確認待ち');
});
await check('Tree drag-and-drop reorders requirements',async()=>{
  const from=treeId('R01'),to=treeId('R02');const box=await to.boundingBox();
  await from.dragTo(to,{targetPosition:{x:box.width/2,y:box.height-2}});
  await page.locator('[data-tab="json"]').click();const d=JSON.parse(await page.locator('#jsonEditor').inputValue());
  if(d.categories[0].requirements[1].id!=='R01')throw Error('DnD reorder failed');
});
await check('Browser autosave survives reload with explicit restore',async()=>{
  const previous=await page.evaluate(()=>localStorage.getItem('usdm-studio.autosave.v1'));
  await page.reload();await expect(page.locator('#dialog')).toContainText('前回の作業を復元');
  await expect(action('skip-restore')).toHaveText('空の文書から開始');await action('skip-restore').click();
  await expect(page.locator('h1')).toHaveText('新しい要求仕様書');await expect(page.locator('.tree-row')).toHaveCount(1);
  if(await page.evaluate(()=>localStorage.getItem('usdm-studio.autosave.v1'))!==previous)throw Error('Skipping restore overwrote previous work');
  await page.reload();await expect(page.locator('#dialog')).toContainText('前回の作業を復元');await action('restore').click();
  await treeId('S01-01').click();await expect(page.locator('[name="labels"]')).toHaveValue('確認待ち');
});
await check('Responsive screen has no horizontal overflow at 1280px',async()=>{
  await page.setViewportSize({width:1280,height:900});await action('all').click();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Horizontal overflow');
  await page.screenshot({path:resolve(out,'1280.png')});
});
await check('Search commits property edits; label filter finds matching requirements',async()=>{
  await treeId('R01').click();await page.locator('[name="reason"]').fill('検索切替でも保持する理由');
  await page.locator('#search').fill('予約');await page.locator('#search').fill('');
  await treeId('R01').click();await expect(page.locator('[name="reason"]')).toHaveValue('検索切替でも保持する理由');
  await action('all').click();await page.locator('#labelFilter').selectOption('優先度高');await expect(page.locator('.requirement-card')).toHaveCount(2);await page.locator('#labelFilter').selectOption('');
});
await check('Batch specification status changes only the chosen stage and removes free labels',async()=>{
  await treeId('S01-01').click();await checkbox('S01-02').check();
  await page.locator('#batchStage').selectOption('2');await action('batch-check').click();
  await page.locator('#batchLabel').fill('確認待ち');await action('batch-remove').click();
  await treeId('S01-01').click();await expect(page.locator('[name="verified2"]')).toBeChecked();await expect(page.locator('[name="verified1"]')).toBeChecked();await expect(page.locator('[name="labels"]')).toHaveValue('');
  await treeId('S01-02').click();await expect(page.locator('[name="verified2"]')).toBeChecked();await expect(page.locator('[name="verified1"]')).not.toBeChecked();
});
await check('Shift selection spans visible rows',async()=>{
  await treeId('S01-01').click();await treeId('S01-02').click({modifiers:['Shift']});await expect(page.locator('.batch-title')).toContainText('2');
});
await check('New document, category, requirement and two-level group creation stay valid',async()=>{
  await action('new').click();await page.locator('#newTitle').fill('新規テスト文書');await action('confirm-new').click();
  await page.locator('[data-action="quick-add"][data-type="requirement"]').click();await expect(page.locator('[name="id"]')).toHaveValue('R01');
  await page.locator('[data-action="quick-add"][data-type="requirementGroup"]').click();await expect(page.locator('[name="name"]')).toHaveValue('＜新しい要求グループ＞');
  await page.locator('[name="name"]').fill('操作');await page.locator('#editForm button[type=submit]').click();await expect(page.locator('[name="name"]')).toHaveValue('＜操作＞');
  await treeId('R_SUB01').click();await page.locator('[data-action="quick-add"][data-type="specificationGroup"]').click();await expect(treeId('S01')).toHaveCount(1);
  await action('validate').click();await expect(page.locator('#dialog')).toContainText('適合しています');await action('close-dialog').click();
});
await check('Schema-valid unusual string values survive unrelated property editing',async()=>{
  const raw={version:'1.1.0',title:'文字列の保全',categories:[{name:'＜機能＞',requirements:[{id:'R01',requirement:'<script>alert(1)</script>',reason:'',keywords:['a,b','line\nbreak'],specificationGroups:[{name:'＜仕様＞',specifications:[{id:' S with spaces ',specification:'x'}]}]}]}]};
  const path=resolve(out,'unusual.json');await writeFile(path,JSON.stringify(raw));await page.locator('#fileInput').setInputFiles(path);
  await treeId('R01').click();await page.locator('[name="reason"]').fill('理由');await page.locator('#editForm button[type=submit]').click();
  await treeId(' S with spaces ').click();await page.locator('[name="reason"]').fill('仕様の理由');await page.locator('#editForm button[type=submit]').click();
  await page.locator('[data-tab="json"]').click();const d=JSON.parse(await page.locator('#jsonEditor').inputValue());
  if(JSON.stringify(d.categories[0].requirements[0].keywords)!==JSON.stringify(raw.categories[0].requirements[0].keywords))throw Error('Keywords changed');
  if(d.categories[0].requirements[0].specificationGroups[0].specifications[0].id!==' S with spaces ')throw Error('Spec ID changed');
});
if(errors.length)throw Error('Browser errors: '+errors.join('\n'));
if(requests.length)throw Error('App made external requests: '+requests.join('\n'));
await writeFile(resolve(out,'results.json'),JSON.stringify({passed:tests.length,tests,errors,requests},null,2));
await browser.close();
console.log(`${tests.length} browser scenarios passed; no page errors; no external requests.`);
