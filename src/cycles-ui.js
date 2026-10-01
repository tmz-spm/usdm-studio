import {CYCLE_OWNERS,CYCLE_KINDS,DETAIL_KINDS,CYCLE_NODE,createCycle,createCycleNode,createDetail,connectCycle,removeCycleNode,findCycle,detailRows,cycleGeometry} from './cycles.js';

export function createCycleUI(ctx){
  const {$,$$,esc,btn,modal,toast,error,state,rows,tab,setTab,render,transact,flush:flushAll,showOwner}=ctx;
  const opened=[],views=new Map();let formDirty=false;
  const isActive=()=>tab().startsWith('cycle:');
  const currentId=()=>isActive()?tab().slice(6):'';
  const found=(id=currentId())=>findCycle(state().cycles,id);
  const all=()=>Object.values(state().cycles).flat();
  const ui=(id=currentId())=>{if(!views.has(id))views.set(id,{selection:{kind:'diagram'},zoom:1,left:0,top:0,connect:false,source:''});return views.get(id);};
  function selection(id=currentId()){
    const d=found(id)?.diagram,v=ui(id);if(!d)return {kind:'diagram'};
    let s=v.selection;
    if(s.kind==='edge'&&!d.edges.some(e=>e.id===s.id))s={kind:'diagram'};
    if(['node','detail'].includes(s.kind)){const n=d.nodes.find(n=>n.id===(s.nodeId||s.id));if(!n)s={kind:'diagram'};else if(s.kind==='detail'&&!detailRows(n.details).some(r=>r.item.id===s.id))s={kind:'node',id:n.id};}
    return v.selection=s;
  }
  function sync(){const ids=new Set(all().map(d=>d.id));for(let i=opened.length-1;i>=0;i--)if(!ids.has(opened[i])){views.delete(opened[i]);opened.splice(i,1);}if(isActive()&&!ids.has(currentId())){setTab('graph');formDirty=false;}else if(isActive())ctx.onOpen?.(found().owner);}
  function reset(){opened.length=0;views.clear();formDirty=false;}
  function open(id){if(!found(id))return;ctx.onOpen?.(found(id).owner);if(!opened.includes(id))opened.push(id);setTab('cycle:'+id);render();}
  function close(id){const i=opened.indexOf(id);if(i>=0)opened.splice(i,1);if(currentId()===id)setTab(opened.length?'cycle:'+opened[Math.min(i,opened.length-1)]:'graph');render();}
  function create(owner){if(!rows().some(r=>r.node._key===owner&&CYCLE_OWNERS.has(r.type))){error('カテゴリ・要求グループ・仕様グループを選択してください。');return;}
    const count=(state().cycles[owner]||[]).length;
    modal('サイクル図を追加',`<label class="field">図の名前<input id="cycleTitle" value="${esc('新しいサイクル図'+(count?' '+(count+1):''))}"></label><p class="field-hint">大まかなゲームの流れを図にし、各ノードの下に詳細仕様・挙動を追加できます。</p>`,btn('close-dialog','キャンセル')+btn('cycle-confirm-create','作成して編集','plus','primary',`data-owner="${owner}"`));
    $('#cycleTitle').select();
  }
  function tabsHTML(){return opened.map(id=>{const d=found(id)?.diagram;return d?`<div class="cycle-tab ${currentId()===id?'active':''}">${btn('tab','↻ '+esc(d.title),null,`tab ${currentId()===id?'active':''}`,`data-tab="cycle:${id}" title="${esc(d.title)}"`)}${btn('cycle-close','×',null,'cycle-tab-close',`data-id="${id}" aria-label="${esc(d.title)}の編集タブを閉じる"`)}</div>`:'';}).join('');}
  function ownerHTML(owner){if(!CYCLE_OWNERS.has(rows().find(r=>r.node._key===owner)?.type))return '';
    const diagrams=state().cycles[owner]||[];
    return `<div class="inspector-section cycle-owner-section"><h3>サイクル図 <span class="muted">${diagrams.length}</span></h3>${diagrams.map(d=>btn('cycle-open','↻ '+esc(d.title),null,'cycle-owner-link',`data-id="${d.id}"`)).join('')}${btn('cycle-create','サイクル図を追加','plus','',`data-owner="${owner}"`)}</div>`;
  }
  const field=(label,name,value,area=false,extra='')=>`<label class="field">${label}${area?`<textarea name="${name}" ${extra}>${esc(value)}</textarea>`:`<input name="${name}" value="${esc(value)}" ${extra}>`}</label>`;
  const options=(obj,value)=>Object.entries(obj).map(([key,label])=>`<option value="${key}" ${key===value?'selected':''}>${label}</option>`).join('');
  function detailOutline(n,s){return detailRows(n.details).map(r=>`<button type="button" data-action="cycle-select-detail" data-node-id="${n.id}" data-id="${r.item.id}" class="cycle-detail-row ${s.kind==='detail'&&s.id===r.item.id?'active':''}" style="padding-left:${8+Math.min(r.depth,12)*13}px"><span class="cycle-detail-kind ${r.item.kind}">${DETAIL_KINDS[r.item.kind]}</span><span>${esc(r.item.text)}</span></button>`).join('');}
  function inspectorHTML(){
    const f=found();if(!f)return '';const d=f.diagram,s=selection(),n=d.nodes.find(n=>n.id===(s.nodeId||s.id));
    let html=`<div class="cycle-property-nav">${btn('cycle-select-diagram','↻ '+esc(d.title),null,'ghost')}${btn('cycle-owner','所属グループへ',null,'ghost')}</div><form id="cycleForm" data-cycle-id="${d.id}" data-kind="${s.kind}"><div class="node-kind"><span class="type-icon cycle">↻</span>${s.kind==='diagram'?'サイクル図':s.kind==='edge'?'遷移・条件':s.kind==='detail'?'ノードの詳細':'フローノード'}</div>`;
    if(s.kind==='diagram')html+=field('図の名前','title',d.title)+field('ゲームの流れ・目的','description',d.description,true,'rows="4"')+`<label class="field">所属グループ<select name="owner">${rows().filter(r=>CYCLE_OWNERS.has(r.type)).map(r=>`<option value="${r.node._key}" ${r.node._key===f.owner?'selected':''}>${esc(rows().filter(a=>a.type!=='document'&&(a.path===r.path||r.path.startsWith(a.path+'/'))).map(a=>a.node.id||a.node.name||a.node.requirement).join(' › '))}</option>`).join('')}</select></label>`;
    else if(s.kind==='edge'){const e=d.edges.find(e=>e.id===s.id);html+=['source','target'].map((key,i)=>`<label class="field">${i?'遷移先':'遷移元'}<select name="${key}">${d.nodes.map(n=>`<option value="${n.id}" ${e[key]===n.id?'selected':''}>${esc(n.text)}</option>`).join('')}</select></label>`).join('')+field('遷移条件・きっかけ','label',e.label,true,'rows="4"');}
    else if(s.kind==='node')html+=`<label class="field">種類<select name="kind">${options(CYCLE_KINDS,n.kind)}</select></label>`+field('大まかな仕様・場面','text',n.text,true,'rows="3"')+field('概要・補足','description',n.description,true,'rows="3"')+`<div class="cycle-coordinates">${field('X','x',n.x,false,'type="number" min="0" max="20000"')}${field('Y','y',n.y,false,'type="number" min="0" max="20000"')}</div>`;
    else {const row=detailRows(n.details).find(r=>r.item.id===s.id),blocked=new Set([row.item.id,...detailRows(row.item.children).map(r=>r.item.id)]);html+=`<p class="cycle-parent-label">${esc(n.text)}</p><label class="field">種類<select name="kind">${options(DETAIL_KINDS,row.item.kind)}</select></label>`+field('詳細の内容','text',row.item.text,true,'rows="6"')+`<label class="field">ぶら下げる先<select name="detailParent"><option value="">フローノード直下</option>${detailRows(n.details).filter(r=>!blocked.has(r.item.id)).map(r=>`<option value="${r.item.id}" ${row.parent?.id===r.item.id?'selected':''}>${esc(r.item.text)}</option>`).join('')}</select></label>`;}
    html+=`<div class="edit-actions"><button type="submit" class="primary">変更を適用</button>${btn('cycle-discard','取り消す')}</div><p id="cycleEditState" class="field-hint">変更は適用または選択切り替え時に反映します。</p></form>`;
    if(n){html+=`<div class="inspector-section"><h3>詳細仕様・挙動</h3><p class="field-hint">${s.kind==='detail'?'選択中の詳細の下に追加します。':'このフローノードの下に追加します。'}</p><div class="cycle-detail-actions">${btn('cycle-add-detail','仕様を追加','plus','',`data-kind="specification"`)}${btn('cycle-add-detail','挙動を追加','plus','',`data-kind="behavior"`)}</div>${detailOutline(n,s)||'<p class="cycle-detail-empty">大まかな流れを決めてから、仕様や挙動を追加できます。</p>'}${s.kind==='detail'?`<div class="flex">${btn('cycle-detail-up','↑ 上へ')}${btn('cycle-detail-down','↓ 下へ')}${btn('cycle-select-node','ノードへ戻る',null,'ghost',`data-id="${n.id}"`)}</div>`:''}</div>`;}
    html+=`<div class="inspector-section">${s.kind==='diagram'?btn('cycle-delete-diagram','この図を削除','trash','danger'):btn('cycle-delete-selection','選択した'+(s.kind==='edge'?'矢印':s.kind==='detail'?'詳細':'ノード')+'を削除','trash','danger')}</div>`;
    return html;
  }
  function flush(){
    if(!formDirty)return true;const form=$('#cycleForm');if(!form)return true;const id=form.dataset.cycleId,f=found(id);if(!f)return false;
    const s={...selection(id)},data=new FormData(form);formDirty=false;
    const ok=transact(store=>{
      const f=findCycle(store.cycles,id),d=f.diagram;
      if(s.kind==='diagram'){d.title=data.get('title').trim();d.description=data.get('description');const owner=data.get('owner');if(owner!==f.owner){store.cycles[f.owner]=store.cycles[f.owner].filter(x=>x.id!==id);(store.cycles[owner]??=[]).push(d);}}
      else if(s.kind==='edge'){const e=d.edges.find(e=>e.id===s.id);e.source=data.get('source');e.target=data.get('target');e.label=data.get('label');}
      else {const n=d.nodes.find(n=>n.id===(s.nodeId||s.id));if(s.kind==='node'){n.kind=data.get('kind');n.text=data.get('text');n.description=data.get('description');n.x=Number(data.get('x'));n.y=Number(data.get('y'));}
        else {const details=detailRows(n.details),row=details.find(r=>r.item.id===s.id),parent=data.get('detailParent');row.item.kind=data.get('kind');row.item.text=data.get('text');if(parent!==(row.parent?.id||'')){const blocked=new Set([row.item.id,...detailRows(row.item.children).map(r=>r.item.id)]);if(blocked.has(parent))throw Error('自分自身や子孫の下には移動できません。');const list=parent?details.find(r=>r.item.id===parent)?.item.children:n.details;if(!list)throw Error('詳細の移動先がありません。');row.list.splice(row.index,1);list.push(row.item);}}
      }
    });
    if(!ok)formDirty=true;return ok;
  }
  function edgeHTML(d,selected){return cycleGeometry(d).edges.map(e=>`<g data-cycle-edge="${e.id}" class="cycle-edge ${selected.kind==='edge'&&selected.id===e.id?'selected':''}" role="button" tabindex="0" aria-label="矢印 ${esc(e.label||'条件なし')}"><title>${esc(e.label||'条件を編集')}</title><path class="cycle-edge-line" d="${e.path}" marker-end="url(#arrow-${d.id})"/><path class="cycle-edge-hit" d="${e.path}"/>${e.label?`<text x="${e.labelX}" y="${e.labelY}" text-anchor="middle">${esc(e.label.length>35?e.label.slice(0,35)+'…':e.label)}</text>`:''}</g>`).join('');}
  function contentHTML(){
    const f=found();if(!f)return '';const d=f.diagram,v=ui(),s=selection(),g=cycleGeometry(d),owner=rows().find(r=>r.node._key===f.owner);
    const nodes=d.nodes.map(n=>{const selected=['node','detail'].includes(s.kind)&&(s.nodeId||s.id)===n.id,count=detailRows(n.details).length;return `<div class="cycle-node ${n.kind} ${selected?'selected':''} ${v.source===n.id?'connecting':''}" data-cycle-node="${n.id}" style="left:${n.x}px;top:${n.y}px;width:${CYCLE_NODE.width}px;height:${CYCLE_NODE.height}px" role="button" tabindex="0" aria-label="${esc(n.text)}" aria-pressed="${selected}"><svg class="cycle-node-shape" viewBox="0 0 200 108" preserveAspectRatio="none" aria-hidden="true">${n.kind==='decision'?'<polygon points="100,3 197,54 100,105 3,54"/>':`<rect x="3" y="3" width="194" height="102" rx="${['start','end'].includes(n.kind)?50:n.kind==='phase'?18:5}"/>`}</svg><span class="cycle-node-kind">${CYCLE_KINDS[n.kind]}</span><span class="cycle-node-text">${esc(n.text)}</span><span class="cycle-node-details">${count?'詳細 '+count+' 件':'詳細を追加'}</span></div>`;}).join('');
    return `<div class="cycle-heading"><div><h2>↻ ${esc(d.title)}</h2><p>${esc(owner?.node.name||'')} <span>· ${d.nodes.length} ノード / ${d.edges.length} 遷移</span></p></div>${btn('cycle-owner','ツリーグラフへ','tree')}</div><div class="cycle-tools">${Object.entries(CYCLE_KINDS).map(([kind,label])=>btn('cycle-add-node',label,'plus','',`data-kind="${kind}"`)).join('')}${btn('cycle-connect',v.connect?'接続を中止':'矢印で接続','link',v.connect?'primary':'',`aria-pressed="${v.connect}"`)}<span class="spacer"></span>${btn('cycle-zoom-out','−',null,'icon','aria-label="図を縮小"')}<span id="cycleZoom">${Math.round(v.zoom*100)}%</span>${btn('cycle-zoom-in','＋',null,'icon','aria-label="図を拡大"')}${btn('cycle-fit','全体表示')}${btn('cycle-actual','100%')}</div>${v.connect?`<div class="cycle-connection-status">${v.source?'遷移先のノードをクリックしてください。同じノードを選ぶと自己ループになります。':'遷移元のノードをクリックし、続けて遷移先をクリックしてください。'}（Escで中止）</div>`:''}<div class="cycle-viewport" data-cycle-id="${d.id}" tabindex="0" aria-label="サイクル図のキャンバス"><div class="cycle-sizer" style="width:${g.width*v.zoom}px;height:${g.height*v.zoom}px"><div class="cycle-stage" style="width:${g.width}px;height:${g.height}px;transform:scale(${v.zoom})"><svg class="cycle-lines" width="${g.width}" height="${g.height}"><defs><marker id="arrow-${d.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0L10 5L0 10z" fill="#7594a7"/></marker></defs><g id="cycleEdges">${edgeHTML(d,s)}</g></svg>${nodes}${!d.nodes.length?'<div class="cycle-empty"><b>ゲームの大まかな流れから始めましょう</b><p>「フェーズ・場面」でノードを追加し、矢印でつなぎます。<br>各ノードの詳細仕様・挙動は、選択後に右側で追加できます。</p></div>':''}</div></div></div><div class="graph-hint">ノードをドラッグして配置 · ノードを選んで詳細仕様・挙動を編集 · 矢印を選んで条件を編集 · 背景をドラッグして移動 / Ctrl＋ホイールで拡大縮小</div>`;
  }
  function remember(){const viewport=$('.cycle-viewport');if(viewport){const v=ui(viewport.dataset.cycleId);v.left=viewport.scrollLeft;v.top=viewport.scrollTop;}}
  function zoom(value,point){const viewport=$('.cycle-viewport');if(!viewport)return;const v=ui(),g=cycleGeometry(found().diagram),old=v.zoom,p=point||{x:viewport.clientWidth/2,y:viewport.clientHeight/2},x=(viewport.scrollLeft+p.x)/old,y=(viewport.scrollTop+p.y)/old;v.zoom=Math.max(.15,Math.min(2,value));$('.cycle-stage').style.transform=`scale(${v.zoom})`;$('.cycle-sizer').style.width=g.width*v.zoom+'px';$('.cycle-sizer').style.height=g.height*v.zoom+'px';$('#cycleZoom').textContent=Math.round(v.zoom*100)+'%';viewport.scrollLeft=x*v.zoom-p.x;viewport.scrollTop=y*v.zoom-p.y;remember();}
  function fit(){const viewport=$('.cycle-viewport');if(!viewport)return;const g=cycleGeometry(found().diagram);zoom(Math.min(1,(viewport.clientWidth-20)/g.width,(viewport.clientHeight-20)/g.height));viewport.scrollLeft=viewport.scrollTop=0;remember();}
  function centerNode(id){const n=found()?.diagram.nodes.find(n=>n.id===id),viewport=$('.cycle-viewport');if(n&&viewport){viewport.scrollLeft=(n.x+100)*ui().zoom-viewport.clientWidth/2;viewport.scrollTop=(n.y+54)*ui().zoom-viewport.clientHeight/2;remember();}}
  function select(s){if(!flushAll())return;ui().selection=s;render();}
  function chooseNode(id){if(!flushAll())return;const v=ui();if(v.connect){if(!v.source){v.source=id;v.selection={kind:'node',id};render();}else {const source=v.source;v.connect=false;v.source='';transact(store=>{const d=findCycle(store.cycles,currentId()).diagram,e=connectCycle(d,source,id);v.selection={kind:'edge',id:e.id};},'矢印を追加しました');}}else{v.selection={kind:'node',id};render();}}
  function deleteSelected(diagram=false){const d=found()?.diagram;if(!d)return;const s=diagram?{kind:'diagram'}:selection();let description='この図とすべてのノード・詳細仕様・挙動・矢印を削除します。';if(s.kind==='node'){const n=d.nodes.find(n=>n.id===s.id),count=d.edges.filter(e=>e.source===s.id||e.target===s.id).length;description=`「${n.text}」と配下の詳細 ${detailRows(n.details).length} 件、接続する矢印 ${count} 件を削除します。`;}else if(s.kind==='detail'){const n=d.nodes.find(n=>n.id===s.nodeId),item=detailRows(n.details).find(r=>r.item.id===s.id).item;description=`「${item.text}」と配下の詳細 ${detailRows(item.children).length} 件を削除します。`;}else if(s.kind==='edge')description='選択した矢印を削除します。';modal('サイクル図の要素を削除',`<p class="error-detail">${esc(description)}\n元に戻す操作が可能です。</p>`,btn('close-dialog','キャンセル')+btn('cycle-confirm-delete','削除する','trash','danger',`data-diagram="${d.id}" data-kind="${s.kind}" data-id="${s.id||''}" data-node-id="${s.nodeId||''}"`));}
  function shiftDetail(delta){const s=selection();if(s.kind!=='detail')return;transact(store=>{const n=findCycle(store.cycles,currentId()).diagram.nodes.find(n=>n.id===s.nodeId),r=detailRows(n.details).find(r=>r.item.id===s.id),to=r.index+delta;if(to<0||to>=r.list.length)return;r.list.splice(r.index,1);r.list.splice(to,0,r.item);});}
  const actions={
    'cycle-create':b=>create(b.dataset.owner),
    'cycle-confirm-create':b=>{const title=$('#cycleTitle').value.trim();if(!title){toast('図の名前を入力してください');return;}const d=createCycle(title),owner=b.dataset.owner;$('#dialog').close();if(transact(s=>(s.cycles[owner]??=[]).push(d),'サイクル図を作成しました'))open(d.id);},
    'cycle-open':b=>open(b.dataset.id),'cycle-close':b=>close(b.dataset.id),
    'cycle-owner':()=>{const f=found();if(f)showOwner(f.owner);},
    'cycle-select-diagram':()=>select({kind:'diagram'}),
    'cycle-select-node':b=>select({kind:'node',id:b.dataset.id}),
    'cycle-select-detail':b=>select({kind:'detail',nodeId:b.dataset.nodeId,id:b.dataset.id}),
    'cycle-discard':()=>{formDirty=false;render();},
    'cycle-add-node':b=>{const d=found().diagram,count=d.nodes.length,n=createCycleNode(b.dataset.kind,80+(count%3)*290,110+Math.floor(count/3)*200);ui().selection={kind:'node',id:n.id};if(transact(s=>findCycle(s.cycles,d.id).diagram.nodes.push(n),'ノードを追加しました'))centerNode(n.id);},
    'cycle-add-detail':b=>{const s=selection(),nodeId=s.nodeId||s.id,item=createDetail(b.dataset.kind),parent=s.kind==='detail'?s.id:null;ui().selection={kind:'detail',nodeId,id:item.id};transact(store=>{const n=findCycle(store.cycles,currentId()).diagram.nodes.find(n=>n.id===nodeId),list=parent?detailRows(n.details).find(r=>r.item.id===parent).item.children:n.details;list.push(item);},'詳細を追加しました');},
    'cycle-detail-up':()=>shiftDetail(-1),'cycle-detail-down':()=>shiftDetail(1),
    'cycle-connect':()=>{const v=ui();v.connect=!v.connect;v.source='';render();},
    'cycle-delete-selection':()=>deleteSelected(),'cycle-delete-diagram':()=>deleteSelected(true),
    'cycle-confirm-delete':b=>{const {diagram:id,kind,id:itemId,nodeId}=b.dataset;$('#dialog').close();transact(store=>{const f=findCycle(store.cycles,id),d=f.diagram;if(kind==='diagram')store.cycles[f.owner]=store.cycles[f.owner].filter(x=>x.id!==id);else if(kind==='node')removeCycleNode(d,itemId);else if(kind==='edge')d.edges=d.edges.filter(e=>e.id!==itemId);else {const n=d.nodes.find(n=>n.id===nodeId),r=detailRows(n.details).find(r=>r.item.id===itemId);r.list.splice(r.index,1);}},'削除しました。元に戻せます');},
    'cycle-zoom-in':()=>zoom(ui().zoom*1.2),'cycle-zoom-out':()=>zoom(ui().zoom/1.2),'cycle-fit':fit,'cycle-actual':()=>zoom(1)
  };
  function redrawCanvas(){remember();$('.cycle-content').innerHTML=contentHTML();bind();}
  function bind(){
    const form=$('#cycleForm');if(form){form.oninput=()=>{formDirty=true;$('#cycleEditState').textContent='未適用の変更があります';};form.onsubmit=e=>{e.preventDefault();if(flush())toast('サイクル図を更新しました');};}
    const viewport=$('.cycle-viewport');if(!viewport)return;const id=viewport.dataset.cycleId,v=ui(id);viewport.scrollLeft=v.left;viewport.scrollTop=v.top;
    viewport.onscroll=remember;
    let gesture=null;
    viewport.onpointerdown=e=>{
      if(e.button!==0)return;const el=e.target.closest('[data-cycle-node]');if(!el&&e.target.closest('[data-cycle-edge],button'))return;
      if(el){if(formDirty){if(!flushAll())return;$('.cycle-viewport')?.onpointerdown(e);return;}const n=found(id).diagram.nodes.find(n=>n.id===el.dataset.cycleNode);gesture={kind:'node',id:n.id,x:n.x,y:n.y,clientX:e.clientX,clientY:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,moved:false,newX:n.x,newY:n.y};}
      else gesture={kind:'pan',clientX:e.clientX,clientY:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
      viewport.setPointerCapture(e.pointerId);e.preventDefault();
    };
    viewport.onpointermove=e=>{if(!gesture)return;const g=gesture,dx=e.clientX-g.clientX,dy=e.clientY-g.clientY;if(g.kind==='pan'){viewport.scrollLeft=g.left-dx;viewport.scrollTop=g.top-dy;return;}if(v.connect)return;if(Math.abs(dx)+Math.abs(dy)>4)g.moved=true;if(!g.moved)return;g.newX=Math.max(20,Math.min(20000,Math.round(g.x+(dx+viewport.scrollLeft-g.left)/v.zoom)));g.newY=Math.max(20,Math.min(20000,Math.round(g.y+(dy+viewport.scrollTop-g.top)/v.zoom)));const el=viewport.querySelector(`[data-cycle-node="${g.id}"]`);el.style.left=g.newX+'px';el.style.top=g.newY+'px';const d=found(id).diagram;$('#cycleEdges').innerHTML=edgeHTML({...d,nodes:d.nodes.map(n=>n.id===g.id?{...n,x:g.newX,y:g.newY}:n)},selection(id));};
    viewport.onpointerup=e=>{if(!gesture)return;const g=gesture;gesture=null;if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);if(g.kind==='pan'){remember();return;}if(g.moved){v.selection={kind:'node',id:g.id};transact(s=>{const n=findCycle(s.cycles,id).diagram.nodes.find(n=>n.id===g.id);n.x=g.newX;n.y=g.newY;});}else chooseNode(g.id);};
    viewport.onpointercancel=()=>{gesture=null;redrawCanvas();};
    viewport.onclick=e=>{const edge=e.target.closest('[data-cycle-edge]');if(edge)select({kind:'edge',id:edge.dataset.cycleEdge});};
    viewport.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){const node=e.target.closest('[data-cycle-node]'),edge=e.target.closest('[data-cycle-edge]');if(node||edge){e.preventDefault();node?chooseNode(node.dataset.cycleNode):select({kind:'edge',id:edge.dataset.cycleEdge});}}};
    viewport.onwheel=e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();const rect=viewport.getBoundingClientRect();zoom(v.zoom*(e.deltaY<0?1.1:1/1.1),{x:e.clientX-rect.left,y:e.clientY-rect.top});};
  }
  function keydown(e){if(!isActive())return false;if(e.key==='Escape'&&ui().connect){ui().connect=false;ui().source='';redrawCanvas();return true;}return false;}
  function documentHTML(){return rows().filter(r=>state().cycles[r.node._key]?.length).map(r=>`<section class="cycle-document"><h2>${esc(r.node.name)} · サイクル図</h2>${state().cycles[r.node._key].map(d=>`<h3>↻ ${esc(d.title)}</h3><p>${esc(d.description)}</p>${d.nodes.map(n=>`<h4>${esc(n.text)} <small>${CYCLE_KINDS[n.kind]}</small></h4><p>${esc(n.description)}</p>${detailRows(n.details).map(r=>`<p style="margin-left:${r.depth*16}px"><b>${DETAIL_KINDS[r.item.kind]}：</b>${esc(r.item.text)}</p>`).join('')}`).join('')}<table><thead><tr><th>遷移元</th><th>条件・きっかけ</th><th>遷移先</th></tr></thead><tbody>${d.edges.map(e=>`<tr><td>${esc(d.nodes.find(n=>n.id===e.source)?.text)}</td><td>${esc(e.label)}</td><td>${esc(d.nodes.find(n=>n.id===e.target)?.text)}</td></tr>`).join('')}</tbody></table>`).join('')}</section>`).join('');}
  return {isActive,currentId,open,create,tabsHTML,ownerHTML,contentHTML,inspectorHTML,flush,remember,sync,reset,actions,bind,keydown,documentHTML,dirty:()=>formDirty,deleteSelected};
}
