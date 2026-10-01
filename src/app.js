import {TYPES,AXES,clone,titleOf,tags,walk,hydrate,canonical,validate,parseInput,projectData,createNode,selectedRoots,moveNodes,removeNodes,insertSubRequirementOnEdge,Store,emptyDocument} from './model.js';
import {version as appVersion} from '../package.json';
import {layoutGraph,renderGraph,bindGraph,setGraphDragKeys} from './graph.js';
import {reviewDocument,duplicateNodes,compareDocuments} from './review.js';
import {conversionOptions,planConversion,planPreserveDelete} from './transform.js';
import {createLayout} from './layout.js';
import {CYCLE_OWNERS,CYCLE_ROW_TYPES,cycleRows,validateCycleMap} from './cycles.js';
import {createCycleUI} from './cycles-ui.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={tree:'M4 3v14h5 M4 7h5 M12 4h8v6h-8z M12 14h8v6h-8z',file:'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',plus:'M12 5v14 M5 12h14',open:'M3 7h7l2 2h9l-3 11H3z M3 7V4h7l2 3',save:'M4 3h13l3 3v15H4z M8 3v6h8V3 M8 21v-8h8v8',search:'M20 20l-5-5 M17 10a7 7 0 1 1-14 0a7 7 0 0 1 14 0',chevron:'M9 5l7 7-7 7',down:'M5 9l7 7 7-7',undo:'M9 4L4 9l5 5 M4 9h10a6 6 0 0 1 0 12',redo:'M15 4l5 5-5 5 M20 9H10a6 6 0 0 0 0 12',trash:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',move:'M12 3v18 M3 12h18 M8 7l4-4 4 4 M8 17l4 4 4-4 M7 8l-4 4 4 4 M17 8l4 4-4 4',up:'M5 14l7-7 7 7',code:'M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18',check:'M5 12l4 4L19 6',help:'M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5 M12 17h.01 M22 12a10 10 0 1 1-20 0a10 10 0 0 1 20 0',link:'M10 14l4-4 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M13 17a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1',tag:'M3 3h9l9 9-9 9-9-9z M7 7h.01',print:'M6 9V3h12v6 M6 17H3V9h18v8h-3 M6 14h12v7H6z'};
Object.assign(icons,{'panel-left':'M3 4h18v16H3z M9 4v16','panel-right':'M3 4h18v16H3z M15 4v16','panel-top':'M3 4h18v16H3z M3 10h18',layout:'M3 4h18v16H3z M3 9h18 M9 9v11 M15 9v11'});
const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[n]||icons.file}"/></svg>`;
const typeIcon=t=>`<span class="type-icon ${t}">${CYCLE_ROW_TYPES[t]?.symbol||(t==='requirement'?'R':t==='subRequirement'?'r':t==='specification'?'S':t==='document'?'▤':'▱')}</span>`;
const btn=(action,label,i,cls='',extra='')=>`<button type="button" data-action="${action}" class="${cls}" ${extra}>${i?icon(i):''}${label}</button>`;
let store=new Store(hydrate(emptyDocument())), selected=new Set(),active='',scope='',collapsed=new Set(),tab='explorer',query='',labelFilter='',fileName='新しい文書',dirty=false,formDirty=false,rawDirty=false,rawDraft='',anchor='',storageOK=true,lastSaved='',toastTimer;
const dirtyFields=new Set();
const graph={zoom:.75,left:0,top:0,collapsed:new Set(),root:'',initialized:false,layout:null};
let graphDraggingKeys=[];
let reviewFilter='all',comparison=null,comparisonName='',diffFilter='all';
let jumpResults=[],jumpIndex=0;
let pendingTransform=null,deleteSelection=[];
const STORAGE='usdm-studio.autosave.v1';
const view=createLayout({$, $$, btn, modal, toast});
const cycleUI=createCycleUI({$, $$, esc,btn,modal,toast,error,state:()=>store,rows,tab:()=>tab,setTab:value=>{tab=value;},render,transact,flush,showOwner:key=>navigateTo(key,'graph'),onOpen:owner=>{active=owner;selected=new Set([owner]);}});
const cycleCount=()=>Object.values(store.cycles).reduce((n,list)=>n+list.length,0);
function treeRows(){const base=rows(),all=[...base,...cycleRows(base,store.cycles)],children=new Map(all.map(r=>[r.node._key,[]])),out=[];for(const r of all)if(r.parent)children.get(r.parent._key).push(r);function visit(r){out.push(r);children.get(r.node._key).forEach(visit);}visit(base[0]);return out;}
let recovery=null;
try{const s=localStorage.getItem(STORAGE);if(s)recovery=parseInput(s);}catch{storageOK=false;}
function rows(){return walk(store.doc);}function get(key){return rows().find(x=>x.node._key===key);}function current(){return get(active)||rows()[0];}
selected.add(store.doc.categories[0]._key);active=[...selected][0];scope=store.doc._key;
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
function modal(title,body,actions=btn('close-dialog','閉じる',null)){
  $('#dialogContent').innerHTML=`<div class="dialog-head"><h2>${esc(title)}</h2></div><div class="dialog-body">${body}</div><div class="dialog-actions">${actions}</div>`;
  if(!$('#dialog').open)$('#dialog').showModal();
}
function error(e){modal('変更を確認してください',`<div class="error-detail">${esc(e.message||e)}</div>`);}
function autosave(){try{localStorage.setItem(STORAGE,JSON.stringify(projectData(store.doc,store.labels,store.cycles)));storageOK=true;lastSaved=new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});}catch{storageOK=false;}}
function changed(msg){dirty=true;formDirty=false;dirtyFields.clear();rawDirty=false;autosave();const all=new Set(rows().map(x=>x.node._key));selected=new Set([...selected].filter(k=>all.has(k)));if(!all.has(active))active=[...selected][0]||store.doc._key;if(!all.has(scope))scope=store.doc._key;render();if(msg)toast(msg);}
function transact(fn,msg){try{store.transaction(fn);changed(msg);return true;}catch(e){error(e);return false;}}
const chips=(n)=>[...(n.keywords||[]).map(x=>`<span class="chip">${esc(x)}</span>`),...(store.labels[n._key]||[]).map(x=>`<span class="chip free">${esc(x)}</span>`)].join('');
const checks=n=>`<span class="checks" title="レビュー・実装・テスト">${(n.verified||[false,false,false]).map(v=>`<span class="${v?'on':''}">${v?'■':'□'}</span>`).join('')}</span>`;
function matches(r){const labels=[...(r.node.keywords||[]),...(store.labels[r.node._key]||[]),...(r.ownerKey?store.labels[r.ownerKey]||[]:[])],s=[titleOf(r.node),r.node.id,r.node.reason,r.node.explanation,r.label,...labels].join(' ').toLowerCase();return(!query||s.includes(query.toLowerCase()))&&(!labelFilter||labels.includes(labelFilter));}
function shownRows(){const rs=treeRows();return rs.filter(r=>r.type!=='document'&&(!query&&!labelFilter||rs.some(x=>matches(x)&&(x.path===r.path||x.path.startsWith(r.path+'/'))))&&(!(!query&&!labelFilter)&&true||!rs.some(a=>collapsed.has(a.node._key)&&r.path.startsWith(a.path+'/'))));}
function treeHTML(){return shownRows().map(r=>{
  const n=r.node;
  if(r.diagram){const has=r.childCount;return `<div class="tree-row cycle-tree-row ${cycleUI.selectedRowKey()===n._key?'selected':''}" data-node="${n._key}" role="treeitem" aria-selected="${cycleUI.selectedRowKey()===n._key}" ${has?`aria-expanded="${!collapsed.has(n._key)}"`:''} style="padding-left:${7+(r.depth-1)*15}px" title="${esc(r.label+'：'+titleOf(n))}"><button class="toggle" data-collapse="${n._key}" aria-label="${collapsed.has(n._key)?'展開':'折りたたむ'}" ${has?'':'disabled'}>${has?icon(collapsed.has(n._key)?'chevron':'down'):''}</button>${typeIcon(r.type)}${btn('cycle-jump',esc(titleOf(n)),null,'cycle-tree-link',`data-target="${n._key}" title="図の該当箇所を編集"`)}</div>`;}
  const has=Object.keys(TYPES[r.type].child).some(f=>n[f]?.length)||store.cycles[n._key]?.length;
  return `<div class="tree-row ${selected.has(n._key)?'selected':''} ${active===n._key?'active':''}" data-node="${n._key}" data-tree="1" draggable="true" role="treeitem" aria-selected="${selected.has(n._key)}" ${has?`aria-expanded="${!collapsed.has(n._key)}"`:''} style="padding-left:${7+(r.depth-1)*15}px" tabindex="0" title="${esc(titleOf(n))}"><button class="toggle" data-collapse="${n._key}" aria-label="${collapsed.has(n._key)?'展開':'折りたたむ'}" ${has?'':'disabled'}>${has?icon(collapsed.has(n._key)?'chevron':'down'):''}</button><input type="checkbox" data-select="${n._key}" aria-label="${esc(n.id||titleOf(n))}を選択" ${selected.has(n._key)?'checked':''}>${typeIcon(r.type)}<span class="node-label">${r.type==='category'||r.type.endsWith('Group')?esc(titleOf(n).replace(/^＜|＞$/g,'')):`<span class="node-id">${esc(n.id)}</span> ${esc(titleOf(n))}`}</span></div>`;
}).join('')||'<div class="empty">一致する要素がありません</div>';}
function render(){
  cycleUI.remember();cycleUI.sync();
  const scrolls=['.tree','.content','.inspector-content'].map(s=>$(s)?.scrollTop||0);
  if($('.graph-viewport')){graph.left=$('.graph-viewport').scrollLeft;graph.top=$('.graph-viewport').scrollTop;}
  const all=rows(),req=all.filter(x=>['requirement','subRequirement'].includes(x.type)).length,specs=all.filter(x=>x.type==='specification'),done=specs.filter(x=>x.node.verified?.every(Boolean)).length;
  const v=validate(store.doc);const viewScope=tab==='graph'?(graph.root||store.doc._key):scope;const isAll=viewScope===store.doc._key;
  const allLabels=[...new Set(all.flatMap(x=>[...(x.node.keywords||[]),...(store.labels[x.node._key]||[])]))].sort();
  $('#app').innerHTML=`<div class="app-shell ${view.classes()}"><header class="topbar"><div class="brand-icon">${icon('tree')}</div><div><div class="brand-name">USDM <span style="font-weight:400">Studio</span></div></div><span class="app-version">v${appVersion}</span><span class="version">SCHEMA 1.1.0</span><span class="top-divider"></span><span class="top-file">${esc(fileName)}${dirty?' •':''}</span><div class="spacer"></div>${btn('jump','検索 / 移動','search','', 'title="Ctrl+K"')}${btn('new','新規','plus','ghost')}${btn('open','開く','open')}${btn('export','USDM JSON','code')}${btn('save','プロジェクト保存','save','primary')}${btn('help','','help','icon', 'aria-label="使い方" title="使い方"')}</header>
  <div class="layout"><aside class="sidebar" id="explorerPanel" aria-label="エクスプローラー"><div class="side-heading flex between"><strong>エクスプローラー</strong>${btn('add','', 'plus','icon','title="要素を追加" aria-label="要素を追加"')}${btn('toggle-sidebar','','panel-left','icon','aria-controls="explorerPanel"')}</div><div class="search">${icon('search')}<input id="search" placeholder="ID・本文・ラベルを検索" aria-label="検索" value="${esc(query)}"></div><div class="side-tools">${btn('all','文書全体','file','ghost')}${btn('expand','すべて展開',null,'ghost')}<div class="spacer"></div>${btn('collapse','−',null,'icon','title="折りたたむ"')}</div><div class="tree" role="tree" aria-label="USDM構造" aria-multiselectable="true">${treeHTML()}</div><div class="side-bottom"><div class="eyebrow">LABEL FILTER</div><select id="labelFilter" aria-label="ラベルで絞り込み" style="margin-top:9px;font-size:11px"><option value="">すべてのラベル</option>${allLabels.map(x=>`<option ${x===labelFilter?'selected':''}>${esc(x)}</option>`).join('')}</select><div class="legend"><span>${typeIcon('requirement')}要求</span><span>${typeIcon('specification')}仕様</span><span>${typeIcon('category')}カテゴリ</span></div></div></aside>
  <main class="main"><div class="workspace-head"><div class="workspace-info" id="workspaceInfo"><div class="breadcrumb">ワークスペース ${icon('chevron')} ${isAll?'文書全体':esc(titleOf(get(viewScope)?.node||store.doc))}</div><div class="flex between workspace-title"><h1 title="${esc(store.doc.title)}">${esc(store.doc.title)}</h1><div class="workspace-title-actions">${store.doc.metadata?.description?btn('doc-description','説明',null,'','title="文書の説明を読む"'):''}${btn('doc-settings','','file','icon','title="文書情報を編集" aria-label="文書情報を編集"')}</div></div><div class="summary"><span><b>${store.doc.categories.length}</b>カテゴリ</span><span><b>${req}</b>要求</span><span><b>${specs.length}</b>仕様</span><span><b>${done}/${specs.length}</b>テスト済み</span>${cycleCount()?`<span><b>${cycleCount()}</b>サイクル図</span>`:''}<span class="spacer"></span><span style="color:${v.warnings.length?'#b59852':'#4a9985'}">${v.errors.length?'● エラー':v.warnings.length?`● 注意 ${v.warnings.length}`:'● スキーマ適合'}</span></div></div><nav class="tabs" aria-label="表示モード">${[['explorer','構造と内容','tree'],['graph','ツリーグラフ','tree'],['review','レビュー','check'],['compare','変更比較','code'],['document','文書プレビュー','file'],['relations','関連','link'],['json','JSON 編集','code']].map(([t,l,i])=>btn('tab',l,i,`tab ${tab===t?'active':''}`,`data-tab="${t}"`)).join('')}${cycleUI.tabsHTML()}</nav></div>
  <div class="toolbar ${cycleUI.isActive()?'cycle-main-toolbar':''}">${btn('add','追加','plus')}${btn('insert','挿入',null)}${btn('duplicate','複製',null,'',selected.size?'':'disabled')}${btn('move','移動','move','',selected.size?'':'disabled')}${btn('up','','up','icon',`title="上へ移動" aria-label="上へ移動" ${selected.size!==1?'disabled':''}`)}${btn('down','','down','icon',`title="下へ移動" aria-label="下へ移動" ${selected.size!==1?'disabled':''}`)}${btn('delete','','trash','icon danger',`title="削除" aria-label="削除" ${!selected.size?'disabled':''}`)}<div class="spacer"></div>${btn('undo','','undo','icon',`title="元に戻す (Ctrl+Z)" aria-label="元に戻す" ${!store.past.length?'disabled':''}`)}${btn('redo','','redo','icon',`title="やり直す (Ctrl+Shift+Z)" aria-label="やり直す" ${!store.future.length?'disabled':''}`)}${btn('validate','検証','check','ghost')}<div class="header-hidden-actions">${btn('open','','open','icon','aria-label="JSONを開く" title="JSONを開く"')}${btn('save','保存','save','primary','title="プロジェクト保存 (Ctrl+S)"')}</div>${view.controls()}</div>
  ${!cycleUI.isActive()&&selected.size>1?`<div class="selection-bar">${icon('check')} ${selected.size} 件を選択中 <span class="muted">右の編集欄からラベルを一括設定</span><span class="spacer"></span>${btn('clear-selection','解除',null,'ghost')}</div>`:''}<div class="content ${tab==='graph'?'graph-content':cycleUI.isActive()?'cycle-content':''}">${contentHTML()}</div></main>
  <aside class="inspector" id="propertyPanel" aria-label="プロパティ"><div class="inspector-heading"><span>${selected.size>1?'一括編集':'プロパティ'}</span><span class="eyebrow">${selected.size>1?'BATCH EDIT':'DETAILS'}</span>${btn('toggle-inspector','','panel-right','icon','aria-controls="propertyPanel"')}</div><div class="inspector-content">${inspectorHTML()}</div></aside></div>
  <footer class="statusbar"><span class="status-dot"></span><span>ローカルで動作</span><span>·</span><span>${storageOK?(lastSaved?`${lastSaved} ブラウザに一時保存`:'データはこのブラウザ内で編集'):'一時保存を利用できません。ファイル保存してください。'}</span><span class="spacer"></span><span class="${dirty?'unsaved':''}">${dirty?'ファイル未保存':'ファイル保存済み／初期状態'}</span><span>·</span><span>Ctrl / Shift + クリックで複数選択</span><span>·</span><a href="https://github.com/affordd-prj/usdm-schema" target="_blank" rel="noopener">AFFORDD schema ↗</a></footer></div>`;
  ['.tree','.content','.inspector-content'].forEach((s,i)=>{if($(s))$(s).scrollTop=scrolls[i];});
  bind();
  view.apply();
  if(tab==='graph'){
    const viewport=$('.graph-viewport');viewport.scrollLeft=graph.left;viewport.scrollTop=graph.top;
    if(!graph.initialized){graph.initialized=true;fitGraph();}
  }
}
function scopedRows(){const rs=rows(),r=get(scope)||rs[0];return rs.filter(x=>x.path===r.path||x.path.startsWith(r.path+'/'));}
function contentHTML(){
  if(cycleUI.isActive())return cycleUI.contentHTML();
  if(tab==='review')return reviewHTML();
  if(tab==='compare')return comparisonHTML();
  if(tab==='graph')return (query||labelFilter?`<div class="filter-indicator">絞り込み中：${esc([query,labelFilter].filter(Boolean).join(' / '))}${btn('clear-filters','解除',null,'ghost')}</div>`:'')+graphHTML();
  if(tab==='json')return `<div class="notice">${cycleCount()?'サイクル図・詳細仕様・挙動・自由ラベルを含むプロジェクトJSON全体を編集します。所属先はdocument内のJSON Pointerで指定します。':'標準USDM JSONを直接編集できます。適用前にスキーマを検証します。自由ラベルはID・一意なグループ名で引き継ぎます。'}</div><textarea id="jsonEditor" class="json-editor" spellcheck="false" aria-label="USDM JSONエディター">${esc(rawDirty?rawDraft:JSON.stringify(cycleCount()?projectData(store.doc,store.labels,store.cycles):canonical(store.doc),null,2))}</textarea><div class="flex" style="margin-top:12px">${btn('apply-json','JSONを検証して適用','check','primary')}${btn('reset-json','編集を取り消す',null)}<span id="jsonState" class="muted" style="font-size:11px">${rawDirty?'未適用の変更があります':cycleCount()?'プロジェクトJSON · UTF-8':'標準JSON · UTF-8'}</span></div>`;
  if(tab==='document')return documentHTML();
  if(tab==='relations')return relationsHTML();
  const rs=scopedRows(), all=rows(),hierarchy=treeRows();
  let reqs=rs.filter(x=>x.type==='requirement');
  if(!reqs.length){const cur=get(scope);if(cur){const ancestor=all.filter(x=>x.type==='requirement'&&(cur.path===x.path||cur.path.startsWith(x.path+'/')))[0];if(ancestor)reqs=[ancestor];}}
  const filtered=reqs.filter(r=>!query&&!labelFilter||hierarchy.some(x=>(x.path===r.path||x.path.startsWith(r.path+'/'))&&matches(x)));
  let html='';
  for(const cat of all.filter(r=>r.type==='category')){let body=filtered.filter(r=>r.path.startsWith(cat.path+'/')).map(r=>requirementHTML(r.node)).join('');if(rs.some(r=>r.node===cat.node))body+=cycleUI.ownerContentHTML(cat.node._key,matches);if(body)html+=`<div class="section-title" data-node="${cat.node._key}">${typeIcon('category')}${esc(cat.node.name.replace(/^＜|＞$/g,''))}<span class="muted" style="font-weight:400;font-size:10px">${cat.node.requirements.length} 要求</span></div>`+body;}
  return html||`<div class="empty">${icon('tree')}<h3>${query||labelFilter?'一致する要求がありません':'要求がありません'}</h3><p>${query||labelFilter?'検索条件を変更してください。':'カテゴリを選び「追加」から要求を作成できます。'}</p>${btn('add','要素を追加','plus','primary','style="margin-top:15px"')}</div>`;
}
function graphHTML(){
  graph.layout=layoutGraph(store.doc,{rootKey:graph.root||store.doc._key,collapsed:graph.collapsed,include:matches,extraRows:cycleRows(rows(),store.cycles)});
  return renderGraph(graph.layout,{esc,selected,active,collapsed:graph.collapsed,labels:store.labels,zoom:graph.zoom,wide:view.state.sidebar==='hidden',btn});
}
function setGraphZoom(value,point){
  const v=$('.graph-viewport');if(!v)return;
  const old=graph.zoom;graph.zoom=Math.max(.25,Math.min(1.6,value));
  const p=point||{x:v.clientWidth/2,y:v.clientHeight/2};
  const x=(v.scrollLeft+p.x)/old,y=(v.scrollTop+p.y)/old;
  $('.graph-stage').style.transform=`scale(${graph.zoom})`;
  $('.graph-sizer').style.width=graph.layout.width*graph.zoom+'px';$('.graph-sizer').style.height=graph.layout.height*graph.zoom+'px';
  $('#graphZoom').textContent=Math.round(graph.zoom*100)+'%';
  v.scrollLeft=x*graph.zoom-p.x;v.scrollTop=y*graph.zoom-p.y;graph.left=v.scrollLeft;graph.top=v.scrollTop;
}
function fitGraph(){const v=$('.graph-viewport');if(!v)return;setGraphZoom(Math.min(1,(v.clientWidth-24)/graph.layout.width,(v.clientHeight-24)/graph.layout.height));v.scrollLeft=v.scrollTop=0;graph.left=graph.top=0;}
function centerGraphNode(key){const n=graph.layout?.nodes.find(x=>x.node._key===key),v=$('.graph-viewport');if(n&&v){v.scrollLeft=(n.x+94)*graph.zoom-v.clientWidth/2;v.scrollTop=(n.y+47)*graph.zoom-v.clientHeight/2;}}
function graphInsertDialog(targetKey){
  const r=get(targetKey);if(!r?.parent)return;
  const parent=get(r.parent._key),wrap=r.type==='specificationGroup'&&parent.type==='requirement';
  modal('枝に要素を挿入',`<p class="graph-insert-context">${esc(parent.node.id||titleOf(parent.node))}<br>↓<br>${esc(r.node.id||titleOf(r.node))}</p><label class="field">挿入方法<select id="graphInsertKind"><option value="before">${TYPES[r.type].label}を同じ階層の直前に挿入</option><option value="after" selected>${TYPES[r.type].label}を同じ階層の直後に挿入</option>${wrap?'<option value="wrap">間に下位要求を挿入（要求グループも作成）</option>':''}</select></label><p class="muted" style="font-size:11px;line-height:1.8">${wrap?'間に下位要求を挿入すると、既存の仕様グループと仕様をその下へ移します。':'この枝にはスキーマ上の中間階層がないため、同じ親の下へ挿入します。'}</p>`,btn('close-dialog','キャンセル')+btn('graph-confirm-insert','挿入する','plus','primary',`data-target="${targetKey}"`));
}
function reviewHTML(){
  const issues=reviewDocument(store.doc),attention=issues.filter(x=>x.severity==='attention'),unreviewed=issues.filter(x=>x.code==='unreviewed'),coverage=issues.filter(x=>x.code==='coverage');
  const visible=issues.filter(x=>(reviewFilter==='all'||reviewFilter==='attention'&&x.severity==='attention'||x.code===reviewFilter)&&matches(get(x.key)));
  const specs=rows().filter(x=>x.type==='specification'),reviewed=specs.filter(x=>x.node.verified?.[0]).length;
  return `<div class="view-heading"><div><h2>レビュー支援</h2><p>記述漏れ・未確定事項・レビュー状況を確認します。</p></div>${btn('export-review','一覧を保存','save')}</div><div class="review-metrics">${[['all',issues.length,'指摘全体'],['attention',attention.length,'記述・整合性'],['unreviewed',unreviewed.length,'未レビュー仕様'],['coverage',coverage.length,'仕様のない要求']].map(([f,n,l])=>`<button class="review-metric ${reviewFilter===f?'active':''}" data-action="review-filter" data-filter="${f}"><b>${n}</b><span>${l}</span></button>`).join('')}</div><div class="review-progress"><span>仕様のレビュー済み ${reviewed} / ${specs.length}</span><progress value="${reviewed}" max="${specs.length||1}"></progress></div><div class="review-note">ルールによる確認候補です。要件の正しさ・完全性を判定するものではありません。下位要求が1つだけのグループでは、理由の未記入を指摘しません。</div><div class="flex between" style="margin:18px 0 12px"><span class="muted">${visible.length} 件${visible.length>200?'（先頭200件を表示）':''}</span>${btn('review-select','表示中の要素を一括選択',null,'',visible.length?'':'disabled')}</div>${visible.slice(0,200).map(i=>`<article class="review-item ${selected.has(i.key)?'selected':''}" data-node="${i.key}"><div class="flex"><span class="issue-level ${i.severity}">${i.severity==='attention'?'要確認':'未レビュー'}</span><span class="mono">${esc(i.id||TYPES[i.type].label)}</span><span class="spacer"></span>${btn('locate','グラフで表示',null,'ghost',`data-target="${i.key}"`)}</div><h3>${esc(i.message)}</h3><p>${esc(i.title)}</p><small class="muted">${esc(locationLabel(store.doc,i.key))}</small></article>`).join('')||'<div class="empty">この条件に該当する確認候補はありません。</div>'}`;
}
function locationLabel(doc,key,path){
  const rs=doc===store.doc?treeRows():walk(doc),r=rs.find(x=>key?x.node._key===key:x.path===path);if(!r)return '文書全体';
  return rs.filter(a=>a.path&&a.path!==r.path&&r.path.startsWith(a.path+'/')).map(a=>a.node.id||titleOf(a.node)).join(' › ')||'文書直下';
}
const diffNames={added:'追加',removed:'削除',changed:'内容変更',moved:'所属変更',reordered:'順序変更'};
const fieldNames={requirement:'要求',specification:'仕様',reason:'理由',explanation:'説明',keywords:'キーワード',verified:'仕様ラベル',name:'名前',title:'文書タイトル',metadata:'文書情報',requirementRelations:'要求間関連',specificationGroupRelations:'仕様グループ間関連'};
const displayValue=v=>v===undefined?'（なし）':typeof v==='string'?v:JSON.stringify(v,null,2);
function comparisonHTML(){
  const header=`<div class="view-heading"><div><h2>変更比較</h2><p>基準文書と現在の文書を比較します。</p></div></div><div class="comparison-controls">${btn('choose-baseline','基準JSONを開く','open')}${btn('set-baseline','現在の文書を基準にする',null)}${comparison?btn('clear-baseline','基準を解除',null,'ghost'):''}</div>`;
  if(!comparison)return header+'<div class="empty">比較するJSONを選択してください。<br>標準JSONとプロジェクトJSONの両方を読み込めます。<br>現在の文書は置き換わりません。</div>';
  const diff=compareDocuments(comparison,{doc:store.doc,labels:store.labels,cycles:store.cycles}),visible=diff.filter(x=>diffFilter==='all'||x.kind===diffFilter);
  return header+`<div class="baseline-info"><strong>比較元：${esc(comparisonName)}</strong><span>${esc(comparison.doc.title)}</span></div><div class="review-note">IDで照合します。ID変更は削除＋追加、IDのないグループは親・名前・同名内の順番で照合します。更新日時は比較しません。比較基準はこの画面内だけで保持し、プロジェクト保存には含みません。</div><div class="diff-filters">${[['all','すべて'],...Object.entries(diffNames)].map(([f,l])=>btn('diff-filter',`${l} ${f==='all'?diff.length:diff.filter(x=>x.kind===f).length}`,null,diffFilter===f?'primary':'',`data-filter="${f}"`)).join('')}<span class="spacer"></span>${btn('export-diff','差分を保存','save')}</div>${visible.slice(0,200).map(d=>`<article class="diff-item"><div class="flex"><span class="diff-kind ${d.kind}">${diffNames[d.kind]}</span><span class="mono">${esc(d.id||TYPES[d.type].label)}</span><span class="spacer"></span>${d.key?btn('locate','グラフで表示',null,'ghost',`data-target="${d.key}"`):'<small class="muted">基準文書にのみ存在</small>'}</div><h3>${esc(d.title)}</h3><small class="muted">${esc(locationLabel(d.key?store.doc:comparison.doc,d.key,d.path))}</small>${d.fields.map(f=>`<div class="diff-field-name">${esc(fieldNames[f.field]||f.field)}</div><div class="diff-values"><div><small>基準</small><pre>${esc(displayValue(f.before))}</pre></div><div><small>現在</small><pre>${esc(displayValue(f.after))}</pre></div></div>`).join('')}</article>`).join('')||'<div class="empty">この条件での変更はありません。</div>'}${visible.length>200?'<div class="notice">先頭200件を表示しています。「差分を保存」で全件を取得できます。</div>':''}`;
}
function navigateTo(key,view='explorer'){
  if(key?.startsWith('cycle:')){selectNode(key);return;}
  const r=get(key);if(!r)return;
  active=key;selected=new Set([key]);query=labelFilter='';
  for(const a of rows())if(a.path===r.path||r.path.startsWith(a.path+'/')){collapsed.delete(a.node._key);graph.collapsed.delete(a.node._key);}
  if(view==='graph'){tab='graph';graph.root=store.doc._key;render();setGraphZoom(Math.max(.75,graph.zoom));centerGraphNode(key);}
  else{tab='explorer';scope=key;render();$(`.tree-row[data-node="${key}"]`)?.scrollIntoView({block:'nearest'});}
}
function jumpDialog(){
  modal('要素へ移動',`<input id="jumpInput" placeholder="ID・本文・ラベルを入力" aria-label="移動先を検索" autocomplete="off"><div id="jumpResults" role="listbox" aria-label="検索結果"></div><p class="field-hint" style="margin:12px 0 0">↑↓で選択、Enterで移動。先頭60件を表示します。</p>`);
  jumpIndex=0;renderJump('');$('#jumpInput').focus();
  $('#jumpInput').oninput=e=>{jumpIndex=0;renderJump(e.target.value);};
  $('#jumpInput').onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();jumpIndex=Math.max(0,Math.min(jumpResults.length-1,jumpIndex+(e.key==='ArrowDown'?1:-1)));highlightJump();}else if(e.key==='Enter'&&jumpResults[jumpIndex]){e.preventDefault();$('#dialog').close();navigateTo(jumpResults[jumpIndex].node._key,tab==='graph'?'graph':'explorer');}};
}
function renderJump(value){
  const q=value.trim().toLowerCase();jumpResults=treeRows().filter(r=>[r.node.id,titleOf(r.node),r.node.reason,...(r.node.keywords||[]),...(store.labels[r.node._key]||[])].join(' ').toLowerCase().includes(q)).sort((a,b)=>Number(b.node.id?.toLowerCase()===q)-Number(a.node.id?.toLowerCase()===q)).slice(0,60);
  $('#jumpResults').innerHTML=jumpResults.map((r,i)=>`<button class="jump-result" data-action="jump-result" data-target="${r.node._key}" data-jump-index="${i}" role="option" aria-selected="${i===jumpIndex}">${typeIcon(r.type)}<span><strong>${esc(r.node.id||r.label||TYPES[r.type].label)}</strong><span>${esc(titleOf(r.node))}</span><small>${esc(locationLabel(store.doc,r.node._key))}</small></span></button>`).join('')||'<div class="empty">一致する要素がありません</div>';highlightJump();
}
function highlightJump(){$$('[data-jump-index]').forEach(el=>{const on=Number(el.dataset.jumpIndex)===jumpIndex;el.classList.toggle('active',on);el.setAttribute('aria-selected',on);if(on)el.scrollIntoView({block:'nearest'});});}
function duplicateDialog(){
  const roots=selectedRoots(store.doc,selected);if(!roots.length){toast('文書以外の要素を選択してください');return;}
  modal('要素を複製',`<p class="error-detail">${roots.length} 件と子要素を、各要素の直後へ複製します。ID・グループ名は重複しない名前に変え、キーワードと自由ラベルは引き継ぎます。</p><label class="check-field" style="margin-top:18px"><input id="duplicateReset" type="checkbox" checked>複製した仕様のチェックを未レビューに戻す</label><p class="field-hint" style="margin:15px 0 0">要求間・仕様グループ間の関連は複製しません。複製後に「関連」で設定できます。</p>`,btn('close-dialog','キャンセル')+btn('confirm-duplicate','複製する',null,'primary'));
}
const transformFields={...fieldNames,id:'ID',specificationGroups:'仕様グループ',requirementGroups:'要求グループ',subRequirements:'下位要求',requirements:'要求',specifications:'仕様'};
function transformationWarning(plan){
  const removed=plan.removed||[],fields=(plan.dropped||[]).filter(f=>!Object.keys(TYPES[plan.sourceType]?.child||{}).includes(f));
  return `<div class="notice warn"><strong>実行前に確認してください</strong><br>共通する項目と自由ラベルを引き継ぎます。次の削除・変更は実行後に反映されます。元に戻す操作が可能です。</div>${fields.length?`<div class="loss-block"><b>引き継がない項目</b>${fields.map(f=>`<div><strong>${esc(transformFields[f]||f)}</strong><pre>${esc(displayValue(plan.old[f]))}</pre></div>`).join('')}</div>`:'<p class="transform-note">削除される固有項目はありません。</p>'}${removed.length?`<div class="loss-block"><b>削除されるノード：${removed.length} 件</b><ul>${removed.slice(0,30).map(r=>`<li>${esc(TYPES[r.type].label+' '+(r.id||r.title))}</li>`).join('')}</ul>${removed.length>30?`ほか ${removed.length-30} 件`:''}</div>`:''}${plan.labelsRemoved.length?`<p class="loss-text">削除ノードに付いた自由ラベル：${plan.labelsRemoved.length} 件分も削除します。</p>`:''}${plan.cyclesRemoved?.length?`<div class="loss-block"><b>削除されるサイクル図：${plan.cyclesRemoved.length} 件（各図の詳細仕様・挙動を含む）</b><ul>${plan.cyclesRemoved.map(d=>`<li>${esc(d.title)}</li>`).join('')}</ul></div>`:''}${plan.relationsRemoved?`<p class="loss-text">削除・種類変更で参照先がなくなる関連：${plan.relationsRemoved} 件を削除します。</p>`:''}${plan.created?.length?`<div class="transform-detail"><b>新しく作る階層・要素</b><ul>${plan.created.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}${plan.changes?.length?`<div class="transform-detail"><b>項目の変更</b><ul>${plan.changes.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}${plan.retained?.length?`<p class="transform-note">引き継ぐ項目：${esc(plan.retained.map(f=>transformFields[f]||f).join('、'))}、自由ラベル</p>`:''}`;
}
function changeTypeDialog(key,type){
  const r=get(key);if(!r||r.type==='document')return;
  pendingTransform=null;
  modal('ノードの種類を変更',`<p class="transform-context">操作対象の階層：${esc(locationLabel(store.doc,key))}<br>${esc(TYPES[r.type].label+' '+(r.node.id||titleOf(r.node)))}</p><label class="field">変更後の種類<select id="conversionType">${Object.entries(TYPES).filter(([t])=>t!=='document'&&t!==r.type).map(([t,v])=>`<option value="${t}" ${t===type?'selected':''}>${v.label}</option>`).join('')}</select></label><label class="field">変更後の所属先<select id="conversionParent"></select></label><div id="conversionPreview"></div>`,btn('close-dialog','キャンセル')+btn('confirm-conversion','警告を確認して種類を変更',null,'danger','disabled'));
  const updatePreview=()=>{try{pendingTransform=planConversion(store.snapshot(),key,$('#conversionType').value,$('#conversionParent').value);$('#conversionPreview').innerHTML=transformationWarning(pendingTransform);$('[data-action="confirm-conversion"]').disabled=false;}catch(e){pendingTransform=null;$('#conversionPreview').innerHTML=`<div class="notice warn error-detail">${esc(e.message)}</div>`;$('[data-action="confirm-conversion"]').disabled=true;}};
  const updateOptions=()=>{const options=conversionOptions(store.doc,key,$('#conversionType').value);$('#conversionParent').innerHTML=options.map(o=>`<option value="${o.parentKey}">${esc(o.label)}</option>`).join('');updatePreview();};
  $('#conversionType').onchange=updateOptions;$('#conversionParent').onchange=updatePreview;updateOptions();
}
function deleteDialog(){
  deleteSelection=[...selected];const roots=selectedRoots(store.doc,deleteSelection);if(!roots.length){toast('文書全体は削除できません');return;}
  modal('選択した要素を削除',`<p class="transform-context">操作対象の階層：${esc(roots.map(r=>r.node.id||titleOf(r.node)).join('、'))}</p><label class="field">削除方法<select id="deleteMode"><option value="cascade">子孫もすべて削除</option><option value="preserve">選択ノードだけ削除し、残す子をその親へ直接つなぐ</option></select></label><div id="deletePreview"></div>`,btn('close-dialog','キャンセル')+btn('confirm-delete','削除する','trash','danger'));
  $('#deleteMode').onchange=updateDeletePreview;updateDeletePreview();
}
function updateDeletePreview(){
  pendingTransform=null;const preserve=$('#deleteMode').value==='preserve';
  if(!preserve){const roots=selectedRoots(store.doc,deleteSelection),removed=rows().filter(x=>roots.some(r=>x.path===r.path||x.path.startsWith(r.path+'/')));$('#deletePreview').innerHTML=`<div class="notice warn">選択した要素と子孫、合計 ${removed.length} 件を削除します。対象の自由ラベルと参照する関連も削除します。${removed.reduce((n,r)=>n+(store.cycles[r.node._key]?.length||0),0)} 件のサイクル図と配下の詳細も対象です。元に戻す操作が可能です。</div>`;$('[data-action="confirm-delete"]').disabled=false;return;}
  try{pendingTransform=planPreserveDelete(store.snapshot(),deleteSelection);$('#deletePreview').innerHTML=`<div class="notice">${pendingTransform.childCount} 件の子を、選択したノードの親へ直接つなぎます。子の内容・種類・ID・自由ラベルは保持します。</div><p class="transform-note">連続した中間ノードを複数選択した場合は、それらをまとめて取り除きます。</p>`+transformationWarning(pendingTransform);$('[data-action="confirm-delete"]').disabled=false;}catch(e){$('#deletePreview').innerHTML=`<div class="notice warn"><strong>この削除は実行できません</strong><div class="error-detail">${esc(e.message)}</div></div><p class="transform-note">スキーマに合わない直結は禁止します。子の移動や種類変更は自動で行いません。</p>`;$('[data-action="confirm-delete"]').disabled=true;}
}
function specGroupsHTML(n){return(n.specificationGroups||[]).map(g=>`<div class="spec-group" data-node="${g._key}">${esc(g.name)} ${chips(g)}</div>${g.specifications.map(s=>`<div class="spec-line ${selected.has(s._key)?'selected':''}" data-node="${s._key}"><input type="checkbox" data-select="${s._key}" aria-label="${esc(s.id)}を選択" ${selected.has(s._key)?'checked':''}><span class="spec-id">${esc(s.id)}</span><div style="flex:1">${esc(s.specification)}${store.labels[s._key]?.length?`<div class="chips">${chips(s)}</div>`:''}</div>${checks(s)}</div>`).join('')}${cycleUI.ownerContentHTML(g._key,matches)}`).join('');}
function requirementHTML(n){return `<article class="requirement-card ${selected.has(n._key)?'selected':''}" data-node="${n._key}"><div class="card-head"><input type="checkbox" data-select="${n._key}" aria-label="${esc(n.id)}を選択" ${selected.has(n._key)?'checked':''}><div class="card-body"><div class="flex between"><span class="card-id">${esc(n.id)}</span><span class="eyebrow" style="font-size:8px;letter-spacing:1px">REQUIREMENT</span></div><div class="card-title">${esc(n.requirement)}</div><div class="card-reason"><span>理由</span>${esc(n.reason||'未記入')}</div><div class="chips">${chips(n)}</div></div></div>${specGroupsHTML(n)}${(n.requirementGroups||[]).map(g=>`<div class="spec-group" data-node="${g._key}">${esc(g.name)}</div>${g.subRequirements.map(s=>`<div class="sub-block ${selected.has(s._key)?'selected':''}" data-node="${s._key}"><div class="flex"><input type="checkbox" data-select="${s._key}" aria-label="${esc(s.id)}を選択" ${selected.has(s._key)?'checked':''}><span class="card-id">${esc(s.id)}</span></div><div class="card-title">${esc(s.requirement)}</div><div class="chips">${chips(s)}</div></div>${specGroupsHTML(s)}`).join('')}${cycleUI.ownerContentHTML(g._key,matches)}`).join('')}</article>`;}
function documentHTML(){return `<div class="flex between" style="margin-bottom:15px"><span class="muted" style="font-size:11px">文書全体 · 印刷用プレビュー</span>${btn('print','印刷 / PDF','print')}</div><div class="document-view"><h1>${esc(store.doc.title)}</h1><p class="muted">${esc(store.doc.metadata?.author||'')} ${esc(store.doc.metadata?.description||'')}</p>${store.doc.categories.map(c=>`<h2>${esc(c.name)}</h2>${c.requirements.map(r=>docReq(r)).join('')}`).join('')}${cycleUI.documentHTML()}</div>`;}
function docReq(n){return `<h3>${esc(n.id)}　${esc(n.requirement)}</h3>${n.reason?`<p><b>理由：</b>${esc(n.reason)}</p>`:''}${n.explanation?`<p><b>説明：</b>${esc(n.explanation)}</p>`:''}<div class="chips">${chips(n)}</div>${(n.specificationGroups||[]).map(g=>`<p><b>${esc(g.name)}</b></p><table>${g.specifications.map(s=>`<tr><td style="width:90px">${esc(s.id)}<br>${checks(s)}</td><td>${esc(s.specification)}${s.reason?`<p>理由：${esc(s.reason)}</p>`:''}${s.explanation?`<p>説明：${esc(s.explanation)}</p>`:''}${chips(s)}</td></tr>`).join('')}</table>`).join('')}${(n.requirementGroups||[]).map(g=>`<h2>${esc(g.name)}</h2>${g.subRequirements.map(docReq).join('')}`).join('')}`;}
function relationsHTML(){return `<div class="flex between" style="margin-bottom:20px"><div><h2>要求と仕様グループの関連</h2><p class="muted" style="font-size:11px;margin-top:7px">分割軸を指定して、要素間の関係を記録します。</p></div>${btn('add-relation','関連を追加','plus')}</div>${[['requirementRelations','要求間関連','sourceId','targetId'],['specificationGroupRelations','仕様グループ間関連','sourceName','targetName']].map(([f,l,a,b])=>`<div class="section-title">${l}</div>${(store.doc[f]||[]).map((r,i)=>`<div class="relation"><div class="flex between"><span class="axis">${esc(r.divisionAxis)}</span>${btn('remove-relation','削除','trash','ghost',`data-field="${f}" data-index="${i}"`)}</div><div class="rel-path">${esc(r[a])}　 →　 ${esc(r[b])}</div></div>`).join('')||'<div class="empty" style="padding:20px">関連はまだありません</div>'}`).join('')}`;}
const field=(label,name,value,area=false,extra='')=>`<label class="field">${label}${area?`<textarea name="${name}" ${extra}>${esc(value)}</textarea>`:`<input name="${name}" value="${esc(value)}" ${extra}>`}</label>`;
function inspectorHTML(){
  if(cycleUI.isActive())return cycleUI.inspectorHTML();
  if(selected.size>1)return batchHTML();
  const r=current(),n=r.node;
  let html=`<form id="editForm"><div class="node-kind">${typeIcon(r.type)}${TYPES[r.type].label}<span class="spacer"></span><span class="mono muted">${r.type==='category'?'':esc(n.id||'')}</span></div>`;
  const ancestors=rows().filter(x=>x.path!==r.path&&r.path.startsWith(x.path+'/'));
  html+=`<div class="property-context">${ancestors.map(a=>btn('inspect-parent',esc(a.node.id||titleOf(a.node)),null,'ghost',`data-target="${a.node._key}"`)).join('<span>›</span>')}${btn('locate','グラフで表示',null,'',`data-target="${n._key}"`)}</div>`;
  if(r.type!=='document')html+=`<label class="field">種類<select id="nodeType" aria-label="ノードの種類">${Object.entries(TYPES).filter(([t])=>t!=='document').map(([t,v])=>`<option value="${t}" ${r.type===t?'selected':''}>${v.label}</option>`).join('')}</select></label>`;
  if(r.type==='document')html+=field('文書タイトル','title',n.title)+field('著者','author',n.metadata?.author||'')+field('文書の説明','description',n.metadata?.description||'',true)+field('作成日時','created',n.metadata?.created||'');
  else if(r.type==='category'||r.type.endsWith('Group'))html+=field('名前','name',n.name)+'<p class="field-hint">全角の ＜ ＞ は自動で補います。</p>';
  else {html+=field('ID','id',n.id)+field(r.type==='specification'?'仕様':'要求','text',n.requirement??n.specification,true,'rows="4"')+field('理由','reason',n.reason||'',true)+field('説明','explanation',n.explanation||'',true);}
  if(['requirement','subRequirement'].includes(r.type))html+=field('キーワードラベル','keywords',(n.keywords||[]).join(', '))+'<p class="field-hint">カンマ区切り。標準JSONの keywords に保存。</p>';
  if(r.type==='specification')html+=`<div class="inspector-section"><h3>仕様ラベル</h3>${['レビュー済み','実装済み','テスト済み'].map((l,i)=>`<label class="check-field"><input type="checkbox" name="verified${i}" ${n.verified?.[i]?'checked':''}>${l}</label>`).join('')}</div>`;
  html+=`<div class="inspector-section">${field('自由ラベル','labels',(store.labels[n._key]||[]).join(', '))}<p class="field-hint">全種類に設定可能。プロジェクトJSONに保存。<br>標準USDM JSONへの書き出しには含みません。</p></div><div class="edit-actions"><button class="primary" type="submit" title="Ctrl+Enter">変更を適用</button>${btn('discard-form','取り消す',null,'','title="未適用の入力を戻す"')}</div><p id="editState" class="field-hint" style="margin-top:10px">変更は「適用」または要素の切り替え時に反映します。</p></form>`;
  if(Object.keys(TYPES[r.type].child).length)html+=`<div class="inspector-section"><h3>この要素に追加</h3><div style="display:flex;gap:7px;flex-wrap:wrap">${Object.entries(TYPES[r.type].child).map(([f,t])=>btn('quick-add',TYPES[t].label,'plus','',`data-type="${t}" data-parent="${n._key}"`)).join('')}</div></div>`;
  return html+cycleUI.ownerHTML(n._key);
}
function batchHTML(){const rs=rows().filter(r=>selected.has(r.node._key)),req=rs.filter(r=>['requirement','subRequirement'].includes(r.type)).length,sp=rs.filter(r=>r.type==='specification').length;return `<div class="batch-title">${rs.length}<span style="font-size:13px;margin-left:8px">件をまとめて編集</span></div><p class="batch-summary">${Object.keys(TYPES).map(t=>{const count=rs.filter(r=>r.type===t).length;return count?`${TYPES[t].label} ${count}`:null;}).filter(Boolean).join(' / ')}</p><div class="notice">選択した要素だけに適用します。子要素へは自動で付与しません。</div><label class="field">共通ラベル<input id="batchLabel" placeholder="例：優先度高, リリース1"></label><label class="field">保存先<select id="batchTarget"><option value="keywords" ${!req?'disabled':''} ${req?'selected':''}>キーワード（要求 ${req} 件）</option><option value="labels" ${!req?'selected':''}>自由ラベル（全 ${rs.length} 件）</option></select></label><div class="flex">${btn('batch-add','ラベルを追加','plus','primary')}${btn('batch-remove','取り除く',null)}</div><p class="field-hint" style="margin-top:13px">キーワードは要求・下位要求にのみ適用します。自由ラベルはプロジェクト保存が必要です。</p>${sp?`<div class="inspector-section"><h3>仕様ラベル · ${sp} 件</h3><label class="field">変更する項目<select id="batchStage"><option value="0">レビュー済み</option><option value="1">実装済み</option><option value="2">テスト済み</option></select></label><div class="flex">${btn('batch-check','チェックを付ける','check')}${btn('batch-uncheck','外す',null)}</div></div>`:''}<div class="inspector-section"><h3>選択中の要素</h3>${rs.slice(0,30).map(r=>`<div class="flex" style="margin:9px 0;font-size:11px">${typeIcon(r.type)}<span>${esc(r.type==='category'||r.type.endsWith('Group')?titleOf(r.node):r.node.id)}</span></div>`).join('')}</div>`;}
function saveForm(){
  if(!formDirty)return true;
  const form=$('#editForm');if(!form)return true;
  const data=new FormData(form),r=current(),key=r.node._key;
  return transact(s=>{
    const n=walk(s.doc).find(x=>x.node._key===key).node;
    if(r.type==='document'){if(dirtyFields.has('title'))n.title=data.get('title');n.metadata??={};for(const f of ['author','description','created']) if(dirtyFields.has(f))n.metadata[f]=data.get(f);}
    else if(r.type==='category'||r.type.endsWith('Group')){
      const old=n.name,name=data.get('name').trim();if(dirtyFields.has('name'))n.name=name.startsWith('＜')&&name.endsWith('＞')?name:`＜${name}＞`;
      if(r.type==='specificationGroup'&&old!==n.name){const count=rows().filter(x=>x.type==='specificationGroup'&&x.node.name===old).length;if(!count)for(const rel of s.doc.specificationGroupRelations||[])for(const f of ['sourceName','targetName'])if(rel[f]===old)rel[f]=n.name;}
    } else {
      const old=n.id;if(dirtyFields.has('id'))n.id=r.type==='specification'?data.get('id'):data.get('id').trim();if(dirtyFields.has('text'))n[r.type==='specification'?'specification':'requirement']=data.get('text');
      for(const f of ['reason','explanation'])if(dirtyFields.has(f))n[f]=data.get(f);
      if(r.type!=='specification'&&old!==n.id)for(const rel of s.doc.requirementRelations||[])for(const f of ['sourceId','targetId'])if(rel[f]===old)rel[f]=n.id;
      if(r.type==='specification'&&[0,1,2].some(i=>dirtyFields.has('verified'+i)))n.verified=[0,1,2].map(i=>data.has('verified'+i));
    }
    if(dirtyFields.has('keywords'))n.keywords=tags(data.get('keywords'));
    if(dirtyFields.has('labels'))s.labels[key]=tags(data.get('labels'));
  });
}
function flush(){if(!cycleUI.flush())return false;if(rawDirty){error('JSONに未適用の変更があります。「JSONを検証して適用」または「編集を取り消す」を選んでください。');return false;}return saveForm();}
function selectNode(key,e={}){
  if(!flush())return;
  if(key?.startsWith('cycle:')){const r=treeRows().find(r=>r.node._key===key);if(r)cycleUI.open(r.diagram.id,r.selection);return;}
  if(cycleUI.isActive())tab='graph';
  const row=get(key);if(!row)return;
  if(e.shiftKey&&anchor){const visible=(tab==='graph'?graph.layout.nodes:shownRows()).filter(r=>!r.diagram).map(r=>r.node._key),a=visible.indexOf(anchor),b=visible.indexOf(key);if(a>=0&&b>=0){if(!e.ctrlKey&&!e.metaKey)selected.clear();visible.slice(Math.min(a,b),Math.max(a,b)+1).forEach(k=>selected.add(k));}else selected.add(key);}
  else if(e.ctrlKey||e.metaKey||e.checkbox){selected.has(key)?selected.delete(key):selected.add(key);anchor=key;}
  else{selected=new Set([key]);anchor=key;}
  active=key;if(e.tree&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.checkbox)scope=key;render();
}
function addDialog(insert=false){const r=current();if(insert&&r.type==='document'){error('挿入位置となる要素を選択してください。');return;}
  const opts=[];
  if(!insert)for(const [f,t]of Object.entries(TYPES[r.type].child))opts.push(`<option value="inside:${t}">${TYPES[t].label}を子として追加</option>`);
  if(r.type!=='document'){opts.push(`<option value="after:${r.type}">同じ種類を直後に挿入</option>`);opts.push(`<option value="before:${r.type}">同じ種類を直前に挿入</option>`);}
  if(!insert&&CYCLE_OWNERS.has(r.type))opts.push('<option value="cycle:cycle">サイクル図を追加（専用タブで編集）</option>');
  if(!insert)opts.push('<option value="category:category">文書にカテゴリを追加</option>');
  modal(insert?'要素を挿入':'新しい要素を追加',`<p class="muted" style="margin-bottom:18px;font-size:12px">操作対象の階層：${esc(r.node.id||titleOf(r.node))}</p><label class="field">追加する場所・種類<select id="addKind">${opts.join('')}</select></label>`,btn('close-dialog','キャンセル')+btn('confirm-add','追加する','plus','primary'));
}
function addNode(parentKey,type,position='inside'){
  let key;
  const success=transact(s=>{const r=walk(s.doc).find(x=>x.node._key===parentKey);const parent=position==='inside'?r.node:r.parent;const pt=position==='inside'?r.type:walk(s.doc).find(x=>x.node===parent).type;const field=Object.entries(TYPES[pt].child).find(([,t])=>t===type)?.[0];if(!field)throw Error('この階層に追加できません。');const n=createNode(type,s.doc);key=n._key;(parent[field]??=[]).splice(position==='inside'?parent[field].length:r.index+(position==='after'?1:0),0,n);},'要素を追加しました');
  if(success){active=key;selected=new Set([key]);collapsed.delete(parentKey);render();$('#editForm input')?.focus();}
}
function moveDialog(){const roots=selectedRoots(store.doc,selected);if(!roots.length)return;const type=roots[0].type;if(roots.some(x=>x.type!==type)){error('同じ種類の要素を選択してください。');return;}const candidates=rows().filter(x=>Object.values(TYPES[x.type].child).includes(type)&&!roots.some(r=>x.path===r.path||x.path.startsWith(r.path+'/')));
  modal('選択した要素を移動',`<div class="notice">${roots.length} 件を移動先の末尾に配置します。並べ替えは上下ボタンやドラッグでも行えます。</div><label class="field">移動先<select id="moveTarget">${candidates.map(r=>`<option value="${r.node._key}">${esc((r.node.id?r.node.id+' · ':'')+titleOf(r.node))} ${esc(r.path)}</option>`).join('')}</select></label>`,btn('close-dialog','キャンセル')+btn('confirm-move','移動する','move','primary',candidates.length?'':'disabled'));
}
function shiftSelection(dir){const r=get([...selected][0]);if(!r?.parent)return;const t=r.parent[r.field][r.index+dir];if(!t)return;transact(s=>moveNodes(s.doc,selected,t._key,dir<0?'before':'after'),'並び順を変更しました');}
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
const safeName=()=>store.doc.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,100)||'USDM';
function saveFile(project,confirmed=false){if(!flush())return;if(!project&&cycleCount()&&!confirmed){modal('標準USDM JSONを書き出す',`<p class="error-detail">標準USDM JSONにはサイクル図とその詳細仕様・挙動を含められません。図を含む一式は「プロジェクト保存」で保存できます。</p>`,btn('close-dialog','戻る')+btn('confirm-standard-export','標準文書を書き出す','code'));return;}const v=validate(store.doc);if(v.errors.length){error(v.errors.join('\n'));return;}download(project?projectData(store.doc,store.labels,store.cycles):canonical(store.doc),safeName()+(project?'.usdm-project.json':'.usdm.json'));if(project){dirty=false;fileName=safeName()+'.usdm-project.json';render();}toast(project?'プロジェクトJSONを保存しました':'標準USDM JSONを書き出しました（自由ラベルは含みません）');}
function importText(text,name){try{const parsed=parseInput(text);store=new Store(parsed.doc,parsed.labels,parsed.cycles);cycleUI.reset();selected=new Set();active=scope=store.doc._key;collapsed.clear();query=labelFilter='';rawDirty=formDirty=false;tab='explorer';fileName=name;dirty=false;comparison=null;comparisonName='';dirtyFields.clear();autosave();render();toast('JSONを読み込みました');return true;}catch(e){error(e);return false;}}
function applyJSON(dropExtras=false){
  let parsed,raw;try{raw=JSON.parse($('#jsonEditor').value);parsed=parseInput($('#jsonEditor').value);}catch(e){error(e);return;}
  const identity=r=>r.type==='document'?'document':r.node.id?`${r.type}:${r.node.id}`:`${r.type}:${r.node.name}`;
  const old=rows(),neu=walk(parsed.doc),project=raw.format==='usdm-studio-project',labelMap=project?parsed.labels:{},cycleMap=project?parsed.cycles:{},unmatched=[],lost=[];
  if(project){const ids=new Set(Object.values(cycleMap).flat().map(d=>d.id));for(const d of Object.values(store.cycles).flat())if(!ids.has(d.id))lost.push(d.title);}
  else for(const r of old){
    const ls=store.labels[r.node._key],ds=store.cycles[r.node._key];if(!ls?.length&&!ds?.length)continue;
    const found=neu.filter(x=>identity(x)===identity(r));
    if(found.length===1&&old.filter(x=>identity(x)===identity(r)).length===1){if(ls?.length)labelMap[found[0].node._key]=ls;if(ds?.length)cycleMap[found[0].node._key]=ds;}
    else {if(ls?.length)unmatched.push(r.node.id||titleOf(r.node));if(ds?.length)lost.push(...ds.map(d=>d.title));}
  }
  if((unmatched.length||lost.length)&&!dropExtras){modal('付加情報の引き継ぎを確認',`<p class="error-detail">次の情報が引き継がれません。必要なら編集を戻し、GUIで変更してください。</p>${unmatched.length?`<p>自由ラベル：${esc(unmatched.join('、'))}</p>`:''}${lost.length?`<p class="loss-text">サイクル図と配下の詳細仕様・挙動：${esc(lost.join('、'))}</p>`:''}`,btn('close-dialog','編集に戻る')+btn('apply-json-drop','削除を確認して適用',null,'danger'));return;}
  if(transact(s=>{s.doc=parsed.doc;s.labels=labelMap;s.cycles=cycleMap;},'JSONを適用しました')){scope=active=store.doc._key;selected.clear();render();}
}
function relationDialog(){modal('関連を追加',`<label class="field">種類<select id="relType"><option value="requirementRelations">要求間関連</option><option value="specificationGroupRelations">仕様グループ間関連</option></select></label><div id="relEndpoints"></div><label class="field">分割軸<select id="relAxis">${AXES.map(x=>`<option>${x}</option>`).join('')}</select></label>`,btn('close-dialog','キャンセル')+btn('confirm-relation','関連を追加','link','primary'));renderEndpoints();$('#relType').onchange=renderEndpoints;}
function renderEndpoints(){const req=$('#relType').value==='requirementRelations';const list=rows().filter(r=>req?['requirement','subRequirement'].includes(r.type):r.type==='specificationGroup');const values=[...new Set(list.map(r=>req?r.node.id:r.node.name))];$('#relEndpoints').innerHTML=['元','先'].map((l,i)=>`<label class="field">関連${l}<select id="rel${i}">${values.map(x=>`<option>${esc(x)}</option>`).join('')}</select></label>`).join('');}
function batch(kind){const values=tags($('#batchLabel')?.value||''),target=$('#batchTarget')?.value;const stage=Number($('#batchStage')?.value||0);if(['add','remove'].includes(kind)&&!values.length){toast('ラベルを入力してください');return;}
  transact(s=>{for(const r of walk(s.doc).filter(x=>selected.has(x.node._key))){const n=r.node;if(kind==='check'||kind==='uncheck'){if(r.type==='specification'){n.verified??=[false,false,false];n.verified[stage]=kind==='check';}continue;}if(target==='keywords'&&!['requirement','subRequirement'].includes(r.type))continue;const before=target==='keywords'?n.keywords||[]:s.labels[n._key]||[];const after=kind==='add'?[...new Set([...before,...values])]:before.filter(x=>!values.includes(x));if(target==='keywords')n.keywords=after;else s.labels[n._key]=after;}},'選択した要素に適用しました');}
function help(){modal('USDM Studio の使い方',`<div class="notice">インストール不要。HTMLをブラウザで開いて使えます。文書は外部へ送信されません。</div><ul class="help-list"><li>左のツリーで要素を選び、右のプロパティで編集します。</li><li>ツールバーの「表示」で、左右のパネルと上部を標準・小型・非表示に切り替えます。左右のアイコンで開閉、上部アイコンで3段階を順に切り替えられます。入力途中の内容を保持し、表示設定はブラウザに記憶します。</li><li>文書のdescriptionはタイトル横の「説明」で開きます。文書プレビュー・JSON・文書情報からも確認できます。</li><li>カテゴリ・要求グループ・仕様グループのプロパティからサイクル図を追加できます。ツリーグラフの図ノードを選ぶと、図ごとの編集タブが開きます。大まかなゲームの流れをノードと矢印で描き、各ノードの下に詳細仕様・挙動を階層で追加できます。図を含む保存には「プロジェクト保存」を使います。</li><li>チェックボックス、Ctrl / Cmd、Shiftで複数選択できます。</li><li>エクスプローラーではドラッグ先の上部は直前、中央は子、下部は直後に移動します。</li><li>ツリーグラフではノードをクリックして編集、枝へドラッグして直前へ移動、ノードへドロップして子として移動できます。枝の＋で挿入します。</li><li>グラフの背景ドラッグで表示位置を移動し、Ctrl＋ホイールで拡大縮小できます。</li><li>「追加」「挿入」で階層を作成。「移動」で親を変更できます。</li><li>空にできないグループでは、最後の子だけを削除・移動できません。グループ全体を操作してください。</li><li>キーワードは要求・下位要求、仕様ラベルは仕様に設定します。自由ラベルは全要素で使えます。</li><li><b>プロジェクト保存</b>：標準文書と自由ラベルを1つのJSONに保存。</li><li><b>USDM JSON</b>：外部ツール向けの標準形式。自由ラベルは含みません。</li><li>レビュー：記述漏れ・未確定・未レビューの確認候補を一覧にします。変更比較：別JSONまたは現在の文書を基準に変更点を確認します。</li><li>複製は子要素とラベルを含み、IDを再生成します。関連はコピーしません。</li><li>Ctrl+K：要素へ移動 / Ctrl+Enter：入力を適用 / Ctrl+S：保存 / Ctrl+Z：元に戻す / Ctrl+Shift+Z：やり直す。</li><li>ブラウザの一時保存は補助です。大切な変更はファイル保存してください。</li></ul><div class="footer-credit">スキーマ：Kenichi Saito / 派生開発推進協議会（AFFORDD）, 2026。<a href="https://github.com/affordd-prj/usdm-schema" target="_blank" rel="noopener">USDM Schema 1.1.0</a>（原本を変更せず同梱）。<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>。<br>スキーマ検証：Ajv (MIT)。</div>`);}
const actions={
  'close-dialog':()=>{$('#dialog').close();if($('#nodeType'))$('#nodeType').value=current().type;pendingTransform=null;},
  'confirm-conversion':()=>{const plan=pendingTransform;if(!plan)return;$('#dialog').close();pendingTransform=null;if(transact(s=>{s.doc=plan.state.doc;s.labels=plan.state.labels;s.cycles=plan.state.cycles||{};},'種類を変更しました。元に戻せます')){active=plan.key;selected=new Set([active]);scope=store.doc._key;graph.root=store.doc._key;render();if(tab==='graph')centerGraphNode(active);}},
  'jump':jumpDialog,'jump-result':b=>{$('#dialog').close();navigateTo(b.dataset.target,tab==='graph'?'graph':'explorer');},
  'locate':b=>navigateTo(b.dataset.target||active,'graph'),
  'inspect-parent':b=>{active=b.dataset.target;selected=new Set([active]);render();},
  'clear-filters':()=>{query=labelFilter='';render();},
  'discard-form':()=>{formDirty=false;dirtyFields.clear();render();toast('未適用の入力を戻しました');},
  'duplicate':duplicateDialog,
  'confirm-duplicate':()=>{const reset=$('#duplicateReset').checked;$('#dialog').close();let keys;if(transact(s=>{keys=duplicateNodes(s.doc,s.labels,selected,{resetVerified:reset,cycles:s.cycles});},'要素を複製しました')){selected=new Set(keys);active=keys[0];render();if(tab==='graph')centerGraphNode(active);}},
  'review-filter':b=>{reviewFilter=b.dataset.filter;render();},
  'review-select':()=>{const list=reviewDocument(store.doc).filter(x=>(reviewFilter==='all'||reviewFilter==='attention'&&x.severity==='attention'||x.code===reviewFilter)&&matches(get(x.key))).slice(0,200);selected=new Set(list.map(x=>x.key));active=[...selected][0]||active;render();},
  'export-review':()=>download({title:store.doc.title,generated:new Date().toISOString(),issues:reviewDocument(store.doc).map(({key,...rest})=>rest)},safeName()+'.review.json'),
  'choose-baseline':()=>$('#baselineInput').click(),
  'set-baseline':()=>{comparison=store.snapshot();comparisonName='現在の文書（'+new Date().toLocaleTimeString('ja-JP')+'）';diffFilter='all';render();toast('比較基準を設定しました');},
  'clear-baseline':()=>{comparison=null;comparisonName='';render();},
  'diff-filter':b=>{diffFilter=b.dataset.filter;render();},
  'export-diff':()=>{if(comparison)download({baseline:comparisonName,title:store.doc.title,generated:new Date().toISOString(),changes:compareDocuments(comparison,{doc:store.doc,labels:store.labels,cycles:store.cycles}).map(({key,...rest})=>rest)},safeName()+'.changes.json');},
  'help':help,
  'all':()=>{scope=store.doc._key;render();},
  'doc-settings':()=>{if(cycleUI.isActive())tab='explorer';if(view.state.inspector==='hidden')view.toggle('inspector');active=store.doc._key;selected=new Set([active]);render();},
  'doc-description':()=>{const description=current().type==='document'?$('#editForm [name=description]')?.value??store.doc.metadata?.description:store.doc.metadata?.description;modal('文書の説明',`<p class="dialog-document-title">${esc(store.doc.title)}</p><div class="document-description">${esc(description||'説明はありません。')}</div>`);},
  'expand':()=>{collapsed.clear();render();},'collapse':()=>{collapsed=new Set(treeRows().filter(r=>r.type!=='document').map(r=>r.node._key));render();},
  'clear-selection':()=>{selected.clear();render();},
  'tab':b=>{tab=b.dataset.tab;render();},
  'graph-zoom-out':()=>setGraphZoom(graph.zoom/1.2),'graph-zoom-in':()=>setGraphZoom(graph.zoom*1.2),
  'graph-fit':fitGraph,'graph-actual':()=>setGraphZoom(1),
  'graph-wide':()=>view.toggle('sidebar'),
  'toggle-sidebar':()=>view.toggle('sidebar'),
  'toggle-inspector':()=>view.toggle('inspector'),
  'cycle-header':view.cycleHeader,
  'layout-settings':view.settings,
  'layout-reset':view.reset,
  'layout-maximize':view.maximize,
  'graph-focus':()=>{graph.root=active;render();fitGraph();},
  'graph-all':()=>{graph.root=store.doc._key;graph.collapsed.clear();render();fitGraph();},
  'graph-collapse':b=>{const k=b.dataset.target;graph.collapsed.has(k)?graph.collapsed.delete(k):graph.collapsed.add(k);render();},
  'graph-insert':b=>graphInsertDialog(b.dataset.target),
  'graph-confirm-insert':b=>{const key=b.dataset.target,kind=$('#graphInsertKind').value;$('#dialog').close();if(kind==='wrap'){let inserted;const ok=transact(s=>{inserted=insertSubRequirementOnEdge(s.doc,key);},'下位要求を挿入しました');if(ok){active=inserted;selected=new Set([inserted]);graph.collapsed.clear();render();centerGraphNode(inserted);}}else {addNode(key,get(key).type,kind);centerGraphNode(active);}},
  'add':()=>{if(cycleUI.isActive()){tab='graph';render();}addDialog();},'insert':()=>addDialog(true),
  'quick-add':b=>addNode(b.dataset.parent,b.dataset.type),
  'confirm-add':()=>{const [pos,type]=$('#addKind').value.split(':');$('#dialog').close();if(pos==='cycle'){cycleUI.create(active);return;}addNode(pos==='category'?store.doc._key:active,type,pos==='category'?'inside':pos);},
  'move':moveDialog,
  'confirm-move':()=>{const target=$('#moveTarget').value;$('#dialog').close();transact(s=>moveNodes(s.doc,selected,target),'要素を移動しました');},
  'up':()=>shiftSelection(-1),'down':()=>shiftSelection(1),
  'delete':deleteDialog,
  'confirm-delete':()=>{const preserve=$('#deleteMode').value==='preserve',plan=pendingTransform;if(preserve&&!plan)return;$('#dialog').close();pendingTransform=null;if(preserve){if(transact(s=>{s.doc=plan.state.doc;s.labels=plan.state.labels;s.cycles=plan.state.cycles||{};},'選択した親を削除し、子をつなぎ直しました')){selected=new Set(plan.kept);active=plan.kept[0]||store.doc._key;scope=store.doc._key;graph.root=store.doc._key;render();}}else transact(s=>{const deleted=removeNodes(s.doc,deleteSelection);deleted.forEach(k=>delete s.labels[k]);},'削除しました。元に戻せます');},
  'undo':()=>{if(store.undo())changed('元に戻しました');},'redo':()=>{if(store.redo())changed('やり直しました');},
  'batch-add':()=>batch('add'),'batch-remove':()=>batch('remove'),'batch-check':()=>batch('check'),'batch-uncheck':()=>batch('uncheck'),
  'save':()=>saveFile(true),'export':()=>saveFile(false),'confirm-standard-export':()=>{$('#dialog').close();saveFile(false,true);},
  'validate':()=>{const v=validate(store.doc);try{validateCycleMap(rows(),store.cycles);}catch(e){v.errors.push(e.message);}modal('文書の検証',`<div class="notice">${v.errors.length?'スキーマエラーがあります':'公開JSON Schema 1.1.0 に適合しています。'}<br>${rows().length-1} 要素とサイクル図 ${cycleCount()} 件（詳細・接続を含む）を検証しました。</div><div class="error-detail">${esc([...v.errors,...v.warnings].join('\n\n')||'IDの重複や参照先に関する注意はありません。')}</div>`);},
  'open':()=>{if(dirty){modal('別のJSONを開く',`<p class="error-detail">現在の変更はファイルに未保存です。プロジェクト保存で手元に残すことができます。</p>`,btn('close-dialog','戻る')+btn('save-before-open','保存して開く','save','primary')+btn('open-anyway','保存せず開く'));}else $('#fileInput').click();},
  'open-anyway':()=>{$('#dialog').close();$('#fileInput').click();},'save-before-open':()=>{saveFile(true);$('#dialog').close();$('#fileInput').click();},
  'new':()=>modal('新しい文書',`<label class="field">文書タイトル<input id="newTitle" value="新しい要求仕様書"></label><p class="muted" style="font-size:11px;line-height:1.9">${dirty?'現在の変更はファイルに未保存です。必要な場合はキャンセルして保存してください。':'新しい文書は空のカテゴリから始まります。'}</p>`,btn('close-dialog','キャンセル')+btn('confirm-new','新しく作成','plus','primary')),
  'confirm-new':()=>{const title=$('#newTitle').value.trim();if(!title){toast('タイトルを入力してください');return;}$('#dialog').close();const d=hydrate(emptyDocument(title));store=new Store(d);cycleUI.reset();scope=d._key;active=d.categories[0]._key;selected=new Set([active]);tab='explorer';query=labelFilter='';collapsed.clear();fileName='新しい文書';comparison=null;comparisonName='';changed('新しい文書を作成しました');},
  'apply-json':()=>applyJSON(),'apply-json-drop':()=>{$('#dialog').close();applyJSON(true);},
  'reset-json':()=>{rawDirty=false;rawDraft='';render();},
  'add-relation':relationDialog,
  'confirm-relation':()=>{const f=$('#relType').value,req=f==='requirementRelations',a=$('#rel0').value,b=$('#rel1').value,axis=$('#relAxis').value;if(!a||!b){toast('関連元と関連先の要素を作成してください');return;}$('#dialog').close();transact(s=>{const rel=req?{sourceId:a,targetId:b,divisionAxis:axis}:{sourceName:a,targetName:b,divisionAxis:axis};const list=s.doc[f]??=[];if(list.some(x=>JSON.stringify(x)===JSON.stringify(rel)))throw Error('同じ関連がすでにあります。');list.push(rel);},'関連を追加しました');},
  'remove-relation':b=>transact(s=>s.doc[b.dataset.field].splice(Number(b.dataset.index),1),'関連を削除しました'),
  'print':()=>window.print(),
  'restore':()=>{$('#dialog').close();store=new Store(recovery.doc,recovery.labels,recovery.cycles);cycleUI.reset();active=scope=store.doc._key;selected.clear();dirty=true;fileName='復元した文書';recovery=null;render();toast('一時保存を復元しました');},
  'skip-restore':()=>{$('#dialog').close();recovery=null;}
};
Object.assign(actions,cycleUI.actions,{'cycle-jump':b=>selectNode(b.dataset.target)});
const noFlush=new Set(['cycle-discard','cycle-fit','cycle-zoom-in','cycle-zoom-out','cycle-actual','close-dialog','help','apply-json','apply-json-drop','reset-json','restore','skip-restore','discard-form','doc-description','toggle-sidebar','toggle-inspector','cycle-header','layout-settings','layout-reset','layout-maximize','graph-wide']);
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;e.stopPropagation();if(!noFlush.has(b.dataset.action)&&!flush())return;actions[b.dataset.action]?.(b);});
function bind(){
  cycleUI.bind();
  if($('#nodeType'))$('#nodeType').onchange=e=>{const key=active,type=e.target.value;if(!flush()){if($('#nodeType'))$('#nodeType').value=current().type;return;}changeTypeDialog(key,type);};
  if(tab==='graph')bindGraph({
    selected:()=>graphDraggingKeys,
    startDrag:key=>{if(formDirty||rawDirty||cycleUI.dirty()){toast('編集を適用してからドラッグしてください');return false;}graphDraggingKeys=selected.has(key)?[...selected]:[key];return true;},
    canMove:(keys,key,position)=>{if(!keys.length)return false;try{const d=clone(store.doc);moveNodes(d,keys,key,position);return !validate(d).errors.length;}catch{return false;}},
    move:(keys,key,position)=>{if(flush()&&transact(s=>moveNodes(s.doc,keys,key,position),'要素を移動しました')){selected=new Set(keys);active=keys[0];render();}},
    select:(key,e)=>selectNode(key,e),zoomBy:(factor,point)=>setGraphZoom(graph.zoom*factor,point),
    remember:(left,top)=>{graph.left=left;graph.top=top;}
  });
  $('#search').addEventListener('input',e=>{const value=e.target.value,pos=e.target.selectionStart;if(!flush())return;query=value;render();$('#search').focus();$('#search').setSelectionRange(pos,pos);});
  $('#labelFilter').onchange=e=>{if(!flush())return;labelFilter=e.target.value;render();};
  $$('.tree-row,[data-node]:not(.tree-row)').forEach(el=>el.addEventListener('click',e=>{if(e.target.closest('[data-action],[data-collapse]'))return;if(e.target.closest('[data-node]')!==el)return;e.stopPropagation();selectNode(el.dataset.node,{ctrlKey:e.ctrlKey,metaKey:e.metaKey,shiftKey:e.shiftKey,checkbox:!!e.target.closest('[data-select]'),tree:!!el.dataset.tree});}));
  $$('[data-collapse]').forEach(b=>b.onclick=e=>{e.stopPropagation();if(!flush())return;const k=b.dataset.collapse;collapsed.has(k)?collapsed.delete(k):collapsed.add(k);render();});
  $$('.tree-row:not(.cycle-tree-row)').forEach(el=>{
    el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectNode(el.dataset.node,{...e,ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,tree:true});}};
    el.ondragstart=e=>{if(formDirty||rawDirty||cycleUI.dirty()){e.preventDefault();toast('編集を適用してからドラッグしてください');return;}if(!selected.has(el.dataset.node)){selected=new Set([el.dataset.node]);active=el.dataset.node;}setGraphDragKeys(selected);e.dataTransfer.setData('text/plain',JSON.stringify([...selected]));e.dataTransfer.effectAllowed='move';};
    el.ondragend=()=>render();
    el.ondragover=e=>{e.preventDefault();const rect=el.getBoundingClientRect(),ratio=(e.clientY-rect.top)/rect.height;el.dataset.drop=ratio<.25?'before':ratio>.75?'after':'inside';el.classList.remove('drop-before','drop-after','drop-inside');el.classList.add('drop-'+el.dataset.drop);};
    el.ondragleave=()=>el.classList.remove('drop-before','drop-after','drop-inside');
    el.ondrop=e=>{e.preventDefault();e.stopPropagation();el.classList.remove('drop-before','drop-after','drop-inside');try{const keys=JSON.parse(e.dataTransfer.getData('text/plain'));if(!Array.isArray(keys)||keys.some(x=>!get(x)))return;transact(s=>moveNodes(s.doc,keys,el.dataset.node,el.dataset.drop),'要素を移動しました');}catch(err){error(err);}};
  });
  if($('#editForm')){$('#editForm').oninput=e=>{if(e.target.id==='nodeType')return;formDirty=true;dirtyFields.add(e.target.name);$('#editState').textContent='未適用の変更があります';};$('#editForm').onsubmit=e=>{e.preventDefault();if(saveForm())toast('プロパティを更新しました');};}
  if($('#jsonEditor'))$('#jsonEditor').oninput=e=>{rawDirty=true;rawDraft=e.target.value;$('#jsonState').textContent='未適用の変更があります';};
}
$('#fileInput').addEventListener('change',async e=>{const f=e.target.files[0];try{if(f){if(f.size>20*1024*1024){error('20MB以下のJSONファイルを選択してください。');}else importText(await f.text(),f.name);}}catch(err){error(err);}e.target.value='';});
$('#baselineInput').addEventListener('change',async e=>{const f=e.target.files[0];try{if(f){if(f.size>20*1024*1024)throw Error('20MB以下のJSONファイルを選択してください。');const parsed=parseInput(await f.text());comparison=parsed;comparisonName=f.name;diffFilter='all';tab='compare';render();toast('比較基準を読み込みました。編集中の文書は変更していません。');}}catch(err){error(err);}e.target.value='';});
$('#dialog').addEventListener('cancel',()=>{if($('#nodeType'))$('#nodeType').value=current().type;pendingTransform=null;});
window.addEventListener('beforeunload',e=>{if(dirty||formDirty||rawDirty||cycleUI.dirty()){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{
  if($('#dialog').open)return;
  if(cycleUI.keydown(e)){e.preventDefault();return;}
  const editing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(flush())jumpDialog();}
  else if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();if(tab==='json'&&rawDirty)applyJSON();else if(cycleUI.isActive()){if(cycleUI.flush())toast('入力を適用しました');}else if(saveForm())toast('入力を適用しました');}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveFile(true);}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!editing){e.preventDefault();if(flush())actions[e.shiftKey?'redo':'undo']();}
  else if(e.key==='Delete'&&!editing){e.preventDefault();if(flush()){if(cycleUI.isActive())cycleUI.deleteSelected();else actions.delete();}}
});
render();
if(recovery)modal('前回の作業を復元',`<p class="error-detail">このブラウザに「${esc(recovery.doc.title)}」の一時保存があります。続きから編集できます。</p>`,btn('skip-restore','空の文書から開始')+btn('restore','復元する','undo','primary'));
