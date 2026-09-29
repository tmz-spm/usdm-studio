import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sample} from './fixture.mjs';

const out=resolve('test-results/browser');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1050},acceptDownloads:true});
const errors=[],requests=[],tests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('http'))requests.push(r.url());});page.on('dialog',d=>d.accept());
const action=n=>page.locator(`[data-action="${n}"]:visible`).first();
const tool=n=>page.locator(`.layout-controls [data-action="${n}"]`);
const tree=id=>page.locator('.tree-row').filter({has:page.locator('.node-id',{hasText:new RegExp('^'+id+'$')})});
const width=async selector=>(await page.locator(selector).boundingBox()).width;
const height=async selector=>(await page.locator(selector).boundingBox()).height;
const stored=()=>page.evaluate(()=>localStorage.getItem('usdm-studio.autosave.v1'));
const fixture={format:'usdm-studio-project',projectVersion:1,document:sample(),labels:{}};
fixture.document.title='表示領域の確認';
fixture.document.metadata={...fixture.document.metadata,description:'文書の長い説明です。\n'.repeat(55)+'<em>記号は文字として表示</em>'};
const input=resolve(out,'v17-layout-project.json');await writeFile(input,JSON.stringify(fixture));
const html=pathToFileURL(resolve('dist/USDM-Studio.html')).href;
async function check(name,fn){await fn();tests.push(name);console.log('PASS '+name);}
async function settings(values){await tool('layout-settings').click();for(const [key,value]of Object.entries(values))await page.locator(`#${key}Mode`).selectOption(value);await action('close-dialog').click();}
async function reset(){await tool('layout-settings').click();await action('layout-reset').click();await action('close-dialog').click();}
async function saved(){const wait=page.waitForEvent('download');await action('save').click();const download=await wait;const file=resolve(out,'v17-saved-project.json');await download.saveAs(file);return JSON.parse(await readFile(file,'utf8'));}

try {
  await page.goto(html);
  await page.locator('#fileInput').setInputFiles(input);
  await check('Description opens on demand without occupying the workspace header',async()=>{
    await expect(page.locator('.workspace-head .document-subtitle')).toHaveCount(0);
    assert.ok(await height('.workspace-head')<200);
    await action('doc-description').click();
    await expect(page.locator('.document-description')).toHaveText(fixture.document.metadata.description);
    await expect(page.locator('.document-description em')).toHaveCount(0);
    await action('close-dialog').click();
    assert.deepEqual(await saved(),fixture);
  });
  await check('Each side panel can be compacted, hidden, and restored independently',async()=>{
    const left=await width('.sidebar'),right=await width('.inspector'),main=await width('.main');
    await settings({sidebar:'compact',inspector:'compact'});
    assert.ok(await width('.sidebar')<left);assert.ok(await width('.inspector')<right);assert.ok(await width('.main')>main);
    await tool('toggle-sidebar').click();await expect(page.locator('.sidebar')).toBeHidden();await expect(page.locator('.inspector')).toBeVisible();
    await tool('toggle-inspector').click();await expect(page.locator('.inspector')).toBeHidden();assert.ok(await width('.main')>=1599);
    await tool('toggle-sidebar').click();await tool('toggle-inspector').click();
    await expect(page.locator('.app-shell')).toHaveClass(/sidebar-compact/);await expect(page.locator('.app-shell')).toHaveClass(/inspector-compact/);
    assert.equal(await width('.sidebar'),220);assert.equal(await width('.inspector'),260);await reset();
  });
  await check('Header has three sizes and keeps save, view tabs, and restore controls available',async()=>{
    const normal=await height('.content');
    await tool('cycle-header').click();const compact=await height('.content');assert.ok(compact>normal);
    await expect(page.locator('.app-shell')).toHaveClass(/header-compact/);
    await tool('cycle-header').click();assert.ok(await height('.content')>compact);
    await expect(page.locator('.topbar')).toBeHidden();await expect(page.locator('.workspace-info')).toBeHidden();
    await expect(page.locator('.tabs')).toBeVisible();await expect(page.locator('.header-hidden-actions [data-action="save"]')).toBeVisible();
    await expect(tool('layout-settings')).toBeVisible();await tool('cycle-header').click();await expect(page.locator('.topbar')).toBeVisible();
  });
  await check('Layout changes preserve invalid, unapplied property edits without committing them',async()=>{
    await tree('R01').click();const before=await stored();
    await page.locator('[name="id"]').fill('');await page.locator('[name="reason"]').fill('入力途中の理由');
    await page.evaluate(()=>{window.draftElement=document.querySelector('[name="reason"]');});
    await settings({inspector:'compact',sidebar:'compact',header:'compact'});
    await tool('toggle-inspector').click();await tool('toggle-sidebar').click();await tool('cycle-header').click();
    await expect(page.locator('#dialog')).not.toBeVisible();await tool('toggle-inspector').click();
    await expect(page.locator('[name="id"]')).toHaveValue('');await expect(page.locator('[name="reason"]')).toHaveValue('入力途中の理由');
    assert.equal(await page.evaluate(()=>window.draftElement===document.querySelector('[name="reason"]')),true);
    assert.equal(await stored(),before);await expect(page.locator('#editState')).toContainText('未適用');
    await action('discard-form').click();await reset();
  });
  await check('Invalid raw JSON remains editable across maximize, panel toggles, and reset',async()=>{
    await page.locator('[data-tab="json"]').click();const before=await stored();
    await page.locator('#jsonEditor').fill('{ "入力途中": ');
    await tool('layout-settings').click();await action('layout-maximize').click();await action('close-dialog').click();
    await expect(page.locator('.sidebar')).toBeHidden();await expect(page.locator('.inspector')).toBeHidden();
    await reset();await expect(page.locator('#jsonEditor')).toHaveValue('{ "入力途中": ');
    assert.equal(await stored(),before);await expect(page.locator('#jsonState')).toContainText('未適用');await action('reset-json').click();
  });
  await check('Batch selection and unsubmitted label text survive display changes',async()=>{
    await page.locator('[data-tab="explorer"]').click();await tree('R01').click();
    await tree('R02').locator('input[type="checkbox"]').check();await expect(page.locator('.batch-title')).toContainText('2');
    await page.locator('#batchLabel').fill('あとで追加する共通ラベル');
    await settings({sidebar:'hidden',inspector:'compact',header:'hidden'});await tool('toggle-inspector').click();await tool('toggle-inspector').click();
    await expect(page.locator('#batchLabel')).toHaveValue('あとで追加する共通ラベル');await expect(page.locator('.batch-title')).toContainText('2');
    await reset();await action('clear-selection').click();
  });
  await check('Graph uses the same panel controls and resizes without losing nodes or property drafts',async()=>{
    await tree('R01').click();await page.locator('[data-tab="graph"]').click();
    const count=await page.locator('.graph-node').count(),w=await width('.graph-viewport');
    await page.locator('[name="reason"]').fill('グラフで入力中');await action('graph-wide').click();
    await expect(page.locator('.sidebar')).toBeHidden();assert.ok(await width('.graph-viewport')>w);
    await expect(page.locator('[name="reason"]')).toHaveValue('グラフで入力中');await expect(page.locator('.graph-node')).toHaveCount(count);
    await tool('toggle-sidebar').click();await expect(action('graph-wide')).toHaveText('表示領域を広げる');
    await settings({inspector:'hidden',header:'hidden'});await tool('toggle-inspector').click();
    await expect(page.locator('[name="reason"]')).toHaveValue('グラフで入力中');await action('discard-form').click();await reset();
  });
  await check('Display preferences survive reload and document import and stay out of project JSON',async()=>{
    await settings({sidebar:'hidden',inspector:'compact',header:'compact'});const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('usdm-studio.layout.v1')));
    await page.reload();await expect(page.locator('.app-shell')).toHaveClass(/sidebar-hidden/);await expect(page.locator('.app-shell')).toHaveClass(/inspector-compact/);await expect(page.locator('.app-shell')).toHaveClass(/header-compact/);
    if(await page.locator('#dialog').isVisible())await action('restore').click();
    await page.locator('#fileInput').setInputFiles(input);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('usdm-studio.layout.v1'))),state);
    assert.deepEqual(await saved(),fixture);await reset();
  });
  await check('Keyboard focus transfers to a visible restore control when a focused panel closes',async()=>{
    const hide=page.locator('.inspector [data-action="toggle-inspector"]');await hide.focus();await page.keyboard.press('Enter');
    await expect(tool('toggle-inspector')).toBeFocused();await expect(tool('toggle-inspector')).toHaveAttribute('aria-expanded','false');
    await page.keyboard.press('Enter');await expect(page.locator('.inspector')).toBeVisible();await expect(tool('toggle-inspector')).toHaveAttribute('aria-expanded','true');
  });
  await check('All sizes remain usable at desktop and narrow viewport widths',async()=>{
    for(const viewportWidth of [1280,960,760]){
      await page.setViewportSize({width:viewportWidth,height:900});
      for(const mode of ['normal','compact','hidden']){
        await settings({sidebar:mode,inspector:mode,header:mode});
        await expect(tool('layout-settings')).toBeVisible();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Horizontal overflow at ${viewportWidth}/${mode}`);
      }
    }
    await page.setViewportSize({width:1600,height:1050});await reset();
  });
  await check('Document preview and print retain the description with the interface hidden',async()=>{
    await settings({sidebar:'hidden',inspector:'hidden',header:'hidden'});await page.locator('[data-tab="document"]').click();
    await expect(page.locator('.document-view')).toContainText(fixture.document.metadata.description);
    await page.emulateMedia({media:'print'});await expect(page.locator('.document-view')).toBeVisible();await expect(page.locator('.toolbar')).toBeHidden();
    await page.emulateMedia({media:'screen'});assert.deepEqual(await saved(),fixture);await reset();
  });
  await check('Long project fits the compact and maximized editor without a persistent description',async()=>{
    const hg=resolve('../HG_要求整理版/HG_要求整理版.usdm-project.json');
    const hasHG=await access(hg).then(()=>true,()=>false);
    await page.locator('#fileInput').setInputFiles(hasHG?hg:input);
    await settings({sidebar:'compact',inspector:'compact',header:'compact'});
    await tree(hasHG?'R13':'R01').click();
    await page.screenshot({path:resolve('dist/v1.7-compact.png'),fullPage:true,style:'#toast{visibility:hidden!important}'});
    await page.locator('[data-tab="graph"]').click();await action('graph-focus').click();
    await settings({sidebar:'hidden',inspector:'hidden',header:'hidden'});await action('graph-fit').click();
    await page.screenshot({path:resolve('dist/v1.7-focus.png'),fullPage:true,style:'#toast{visibility:hidden!important}'});
    await expect(page.locator('.workspace-info')).toBeHidden();await expect(page.locator('.graph-node')).not.toHaveCount(0);
  });
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  await writeFile(resolve(out,'v17-results.json'),JSON.stringify({passed:tests.length,tests,errors,requests},null,2));
  console.log(`${tests.length} v1.7 browser scenarios passed.`);
} finally {await browser.close();}
