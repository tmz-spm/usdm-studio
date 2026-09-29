import {chromium,expect} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseInput,canonical,validate} from './model.bundle.mjs';
import {sample,loadSample} from './fixture.mjs';
const out=resolve('test-results/browser');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1512,height:1050},acceptDownloads:true});
const errors=[],requests=[],tests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('http'))requests.push(r.url());});page.on('dialog',d=>d.accept());
const action=n=>page.locator(`[data-action="${n}"]`).first();const tab=n=>page.locator(`[data-tab="${n}"]`).click();
const tree=id=>page.locator('.tree-row').filter({has:page.locator('.node-id',{hasText:new RegExp('^'+id+'$')})});
async function download(a,file){const waiting=page.waitForEvent('download');await action(a).click();const d=await waiting;const p=resolve(out,file);await d.saveAs(p);return JSON.parse(await readFile(p,'utf8'));}
async function check(name,fn){await fn();tests.push(name);console.log('PASS '+name);}
await page.goto(pathToFileURL(resolve('dist/USDM-Studio.html')).href);
await loadSample(page);
await check('v1.5 review filters list unreviewed specs and navigate to graph',async()=>{
  await expect(page.locator('.app-version')).toHaveText('v'+JSON.parse(await readFile('package.json','utf8')).version);await tab('review');await expect(page.locator('.review-item')).toHaveCount(4);
  await page.locator('[data-action="review-filter"][data-filter="unreviewed"]').click();await expect(page.locator('.review-item')).toHaveCount(4);
  await page.locator('.review-item').first().click();await expect(page.locator('[name="id"]')).toHaveValue('S01-03');
  await page.locator('.review-item').first().locator('[data-action="locate"]').click();await expect(page.locator('.graph-node[data-id="S01-03"]')).toHaveClass(/selected/);
});
await check('Review candidates disappear after property fix, with per-node selection for batch',async()=>{
  await action('jump').click();await page.locator('#jumpInput').fill('R01');await page.locator('#jumpInput').press('Enter');await page.locator('[name="reason"]').fill('');await page.locator('#editForm button[type=submit]').click();
  await tab('review');await page.locator('[data-action="review-filter"][data-filter="attention"]').click();await expect(page.locator('.review-item')).toContainText('理由が未記入');await page.locator('.review-item').click();await page.locator('[name="reason"]').fill('予約を成立させるため。');await page.keyboard.press('Control+Enter');await expect(page.locator('.review-item')).toHaveCount(0);
  await page.locator('[data-action="review-filter"][data-filter="unreviewed"]').click();await action('review-select').click();await expect(page.locator('.batch-title')).toContainText('4');
  const report=await download('export-review','review-v15.json');if(report.issues.length!==4||report.issues.some(i=>'key' in i))throw Error('Invalid review report');
});
await check('Quick navigation ranks exact ID first and supports keyboard',async()=>{
  await page.keyboard.press('Control+k');await page.locator('#jumpInput').fill('R02');await expect(page.locator('.jump-result').first()).toContainText('R02');await page.locator('#jumpInput').press('Enter');await expect(page.locator('[name="id"]')).toHaveValue('R02');
  await action('jump').click();await page.locator('#jumpInput').fill('S01');await page.locator('#jumpInput').press('ArrowDown');await page.locator('#jumpInput').press('Enter');await expect(page.locator('[name="id"]')).toHaveValue('S01-02');
});
await check('Duplicate copies a subtree, regenerates IDs and preserves labels',async()=>{
  await tree('R01').click();await page.locator('[name="labels"]').fill('複製ラベル');await page.keyboard.press('Control+Enter');await action('duplicate').click();await action('confirm-duplicate').click();await expect(page.locator('[name="id"]')).toHaveValue('R01_copy');await expect(page.locator('[name="labels"]')).toHaveValue('複製ラベル');
  const p=await download('save','duplicate-v15.json');const d=p.document;const copied=d.categories[0].requirements[1];if(copied.id!=='R01_copy'||copied.specificationGroups[0].specifications[0].verified.some(Boolean))throw Error('Duplicate state invalid');if(validate(parseInput(JSON.stringify(p)).doc).errors.length)throw Error('Invalid duplicate export');
  await action('undo').click();await expect(tree('R01_copy')).toHaveCount(0);
});
await check('Discarding pending properties does not discard applied document changes',async()=>{
  await tree('R01').click();const value=await page.locator('[name="reason"]').inputValue();await page.locator('[name="reason"]').fill('取り消す入力');await action('discard-form').click();await expect(page.locator('[name="reason"]')).toHaveValue(value);
});
await check('Current document baseline tracks text and labels without modification-time noise',async()=>{
  await tab('compare');await action('set-baseline').click();await expect(page.locator('.diff-item')).toHaveCount(0);
  await page.locator('[name="reason"]').fill('比較テストの理由');await page.locator('[name="labels"]').fill('差分ラベル');await page.keyboard.press('Control+Enter');await expect(page.locator('.diff-item')).toHaveCount(1);await expect(page.locator('.diff-item')).toContainText('比較テストの理由');await expect(page.locator('.diff-item')).toContainText('自由ラベル');
  const report=await download('export-diff','diff-v15.json');if(report.changes.length!==1||report.changes[0].kind!=='changed')throw Error('Invalid diff export');
  await page.screenshot({path:resolve('dist/v1.5-comparison.png'),fullPage:true});
});
await check('Loading a baseline never replaces current document, invalid baseline is rejected',async()=>{
  const baseline=sample();baseline.title='別の基準文書';const p=resolve(out,'baseline-v15.json');await writeFile(p,JSON.stringify(baseline));const title=await page.locator('h1').textContent();await page.locator('#baselineInput').setInputFiles(p);await expect(page.locator('h1')).toHaveText(title);await expect(page.locator('.baseline-info')).toContainText('別の基準文書');
  await writeFile(resolve(out,'bad-v15.json'),'{invalid');await page.locator('#baselineInput').setInputFiles(resolve(out,'bad-v15.json'));await expect(page.locator('#dialog')).toBeVisible();await action('close-dialog').click();await expect(page.locator('.baseline-info')).toContainText('別の基準文書');
});
await check('Graph find-selection expands ancestors and clears hidden filters',async()=>{
  await tab('explorer');await page.locator('#search').fill('通知');await tab('graph');await expect(page.locator('.filter-indicator')).toBeVisible();await action('clear-filters').click();await expect(page.locator('.filter-indicator')).toHaveCount(0);
  await page.keyboard.press('Control+k');await page.locator('#jumpInput').fill('S01-01');await page.locator('#jumpInput').press('Enter');await expect(page.locator('.graph-node[data-id="S01-01"]')).toHaveClass(/selected/);await expect(page.locator('[name="id"]')).toHaveValue('S01-01');
  const box=await page.locator('.graph-node[data-id="S01-01"]').boundingBox(),v=await page.locator('.graph-viewport').boundingBox();if(box.x<v.x||box.x+box.width>v.x+v.width)throw Error('Located node outside viewport');
});
await check('Review UI remains within viewport at desktop width',async()=>{
  await tab('review');await page.locator('[data-action="review-filter"][data-filter="all"]').click();await page.screenshot({path:resolve('dist/v1.5-review.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Page overflow');
});
if(errors.length||requests.length)throw Error(JSON.stringify({errors,requests}));await writeFile(resolve(out,'v15-results.json'),JSON.stringify({passed:tests.length,tests,errors,requests},null,2));await browser.close();console.log(`${tests.length} v1.5 browser scenarios passed.`);
