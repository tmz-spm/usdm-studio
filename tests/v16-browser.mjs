import {chromium,expect} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseInput,validate} from './model.bundle.mjs';
import {sample,loadSample} from './fixture.mjs';
const out=resolve('test-results/browser');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1512,height:1050},acceptDownloads:true});
const errors=[],requests=[],tests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('http'))requests.push(r.url());});page.on('dialog',d=>d.accept());
const action=n=>page.locator(`[data-action="${n}"]`).first(),tree=id=>page.locator('.tree-row').filter({has:page.locator('.node-id',{hasText:new RegExp('^'+id+'$')})});
async function saved(){const wait=page.waitForEvent('download');await action('save').click();const d=await wait,p=resolve(out,'v16-project.json');await d.saveAs(p);return JSON.parse(await readFile(p,'utf8'));}
async function check(name,fn){await fn();tests.push(name);console.log('PASS '+name);}
await page.goto(pathToFileURL(resolve('dist/USDM-Studio.html')).href);
await loadSample(page);
await check('Operation context wording and selectable node type are visible',async()=>{
  await expect(page.locator('.app-version')).toHaveText('v'+JSON.parse(await readFile('package.json','utf8')).version);await expect(page.locator('#nodeType')).toHaveValue('requirement');await action('add').click();await expect(page.locator('#dialog')).toContainText('操作対象の階層：');await expect(page.locator('#dialog')).not.toContainText('基準：');await action('close-dialog').click();
});
await check('Preserve-children deletion is disabled when direct connection violates the schema',async()=>{
  const before=await saved();await action('delete').click();await page.locator('#deleteMode').selectOption('preserve');await expect(action('confirm-delete')).toBeDisabled();await expect(page.locator('#deletePreview')).toContainText('削除禁止');await expect(page.locator('#deletePreview')).toContainText('種類変更は自動で行いません');await action('close-dialog').click();if(JSON.stringify(await saved())!==JSON.stringify(before))throw Error('Forbidden deletion changed data');
});
await check('Selected intermediate nodes can be removed while reconnecting intact children',async()=>{
  await tree('S02-01').click();await page.locator('[name="labels"]').fill('残すラベル');await page.keyboard.press('Control+Enter');
  const group=page.locator('.tree-row').filter({has:page.locator('.node-label',{hasText:'予約の変更操作'})});await group.click();await tree('R02-01').locator('input[type=checkbox]').check();await tree('R02-02').locator('input[type=checkbox]').check();
  await action('delete').click();await page.locator('#deleteMode').selectOption('preserve');await expect(action('confirm-delete')).toBeEnabled();await expect(page.locator('#deletePreview')).toContainText('2 件の子');await action('confirm-delete').click();
  const p=await saved(),r=p.document.categories[0].requirements[1];if(r.specificationGroups.length!==2||r.specificationGroups[0].specifications[0].id!=='S02-01')throw Error('Direct reconnect failed');
  if(!Object.values(p.labels).some(x=>x.includes('残すラベル')))throw Error('Child label lost');await expect(tree('R02-01')).toHaveCount(0);await expect(tree('S02-01')).toHaveCount(1);await action('undo').click();await expect(tree('R02-01')).toHaveCount(1);
});
await check('Cancelling type conversion does not change data or leave the wrong type in the selector',async()=>{
  await tree('R01').click();const before=await saved();await page.locator('#nodeType').selectOption('specification');await expect(page.locator('#dialog')).toContainText('実行前に確認');await expect(page.locator('#conversionPreview')).toContainText('キーワード');await action('close-dialog').click();await expect(page.locator('#nodeType')).toHaveValue('requirement');if(JSON.stringify(await saved())!==JSON.stringify(before))throw Error('Cancelled conversion changed data');
  await page.locator('#nodeType').selectOption('specification');await page.keyboard.press('Escape');await expect(page.locator('#nodeType')).toHaveValue('requirement');
});
await check('Requirement to specification shows data loss and preserves text, reason and free labels',async()=>{
  await page.locator('[name="labels"]').fill('種類変更後も保持');await page.keyboard.press('Control+Enter');const oldText=await page.locator('[name="text"]').inputValue(),oldReason=await page.locator('[name="reason"]').inputValue();
  const destination=page.locator('.tree-row').filter({has:page.locator('.node-label',{hasText:'表示性能'})});const parent=await destination.getAttribute('data-node');
  await page.locator('#nodeType').selectOption('specification');await page.locator('#conversionParent').selectOption(parent);await expect(page.locator('#conversionPreview')).toContainText('削除されるノード');await expect(page.locator('#conversionPreview')).toContainText('キーワード');
  await page.screenshot({path:resolve('dist/v1.6-conversion.png'),fullPage:true,style:'#toast{visibility:hidden!important}'});
  await action('confirm-conversion').click();await expect(page.locator('#nodeType')).toHaveValue('specification');await expect(page.locator('[name="id"]')).toHaveValue('R01');await expect(page.locator('[name="text"]')).toHaveValue(oldText);await expect(page.locator('[name="reason"]')).toHaveValue(oldReason);await expect(page.locator('[name="labels"]')).toHaveValue('種類変更後も保持');await expect(page.locator('[name="keywords"]')).toHaveCount(0);
  const p=await saved();if(validate(parseInput(JSON.stringify(p)).doc).errors.length)throw Error('Conversion export invalid');await expect(tree('S01-01')).toHaveCount(0);await action('undo').click();await tree('R01').click();await expect(page.locator('#nodeType')).toHaveValue('requirement');await expect(tree('S01-01')).toHaveCount(1);
});
await check('Specification can become a requirement with a new compatible destination',async()=>{
  await tree('S01-01').click();const text=await page.locator('[name="text"]').inputValue();await page.locator('#nodeType').selectOption('requirement');await expect(page.locator('#conversionPreview')).toContainText('仕様ラベル');await action('confirm-conversion').click();await expect(page.locator('#nodeType')).toHaveValue('requirement');await expect(page.locator('[name="text"]')).toHaveValue(text);await expect(page.locator('[name="verified0"]')).toHaveCount(0);await action('undo').click();
});
await check('Compatible destination hierarchy creation is previewed and collision-free',async()=>{
  const doc={version:'1.1.0',title:'最小文書',categories:[{name:'＜機能＞',requirements:[{id:'R01',requirement:'仕様として記載したい内容',reason:'理由'}]}]};const f=resolve(out,'minimal-v16.json');await writeFile(f,JSON.stringify(doc));await page.locator('#fileInput').setInputFiles(f);await tree('R01').click();await page.locator('#nodeType').selectOption('specification');await expect(page.locator('#conversionPreview')).toContainText('新しく作る階層');await action('confirm-conversion').click();const p=await saved();if(validate(parseInput(JSON.stringify(p)).doc).errors.length)throw Error('Wrapper invalid');if(p.document.categories[0].requirements[0].id==='R01')throw Error('ID collision');
});
await check('Cascade deletion still removes descendants and supports undo',async()=>{
  const f=resolve(out,'sample-v16.json');await writeFile(f,JSON.stringify(sample()));await page.locator('#fileInput').setInputFiles(f);await tree('R01').click();await action('delete').click();await expect(page.locator('#deleteMode')).toHaveValue('cascade');await action('confirm-delete').click();await expect(tree('S01-01')).toHaveCount(0);await action('undo').click();await expect(tree('S01-01')).toHaveCount(1);
});
if(errors.length||requests.length)throw Error(JSON.stringify({errors,requests}));await writeFile(resolve(out,'v16-results.json'),JSON.stringify({passed:tests.length,tests,errors,requests},null,2));await browser.close();console.log(`${tests.length} v1.6 browser scenarios passed.`);
