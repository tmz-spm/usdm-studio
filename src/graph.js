import {TYPES,walk,titleOf} from './model.js';
const GRAPH_TYPES={...TYPES,cycle:{label:'サイクル図'}};

export const GRAPH_NODE={width:188,height:94,column:282,row:126,margin:38};
export function layoutGraph(doc,{rootKey=doc._key,collapsed=new Set(),include=()=>true,extraRows=[]}={}) {
  const all=[...walk(doc),...extraRows],root=all.find(r=>r.node._key===rootKey)||all[0];
  const children=new Map(all.map(r=>[r.node._key,[]]));
  for(const r of all)if(r.parent)children.get(r.parent._key).push(r);
  const keep=new Set();
  for(const r of all)if(include(r))for(let p=r;p;p=all.find(a=>a.node===p.parent))keep.add(p.node._key);
  const nodes=[],edges=[];let leaf=0;
  function visit(r,depth){
    const kids=collapsed.has(r.node._key)?[]:children.get(r.node._key).filter(c=>keep.has(c.node._key));
    const item={...r,x:GRAPH_NODE.margin+depth*GRAPH_NODE.column,y:0,children:children.get(r.node._key).length};
    nodes.push(item);const placed=kids.map(c=>visit(c,depth+1));
    item.y=placed.length?(placed[0].y+placed.at(-1).y)/2:GRAPH_NODE.margin+leaf++*GRAPH_NODE.row;
    for(const child of placed)edges.push({from:item,to:child});return item;
  }
  visit(root,0);
  return {nodes,edges,width:Math.max(...nodes.map(n=>n.x))+GRAPH_NODE.width+GRAPH_NODE.margin,height:Math.max(...nodes.map(n=>n.y))+GRAPH_NODE.height+GRAPH_NODE.margin};
}
export function renderGraph(layout,{esc,selected,active,collapsed,labels,zoom,wide,btn}) {
  const TYPES=GRAPH_TYPES;
  const {width:W,height:H}=GRAPH_NODE;
  const paths=layout.edges.map(({from,to})=>{
    const x=from.x+W,y=from.y+H/2,tx=to.x,ty=to.y+H/2,m=x+38;
    const d=`M${x},${y} C${m},${y} ${m},${ty} ${tx-12},${ty} L${tx},${ty}`;
    return `<g class="graph-edge" data-edge="${to.node._key}"><path class="graph-wire" d="${d}"/><path class="graph-edge-hit" d="${d}" ${to.type==='cycle'?'':`data-graph-drop="${to.node._key}" data-position="before"`}><title>${to.type==='cycle'?'所属グループのサイクル図':esc(TYPES[to.type].label)+'をこの位置へ移動'}</title></path></g>`;
  }).join('');
  const plus=layout.edges.filter(({to})=>to.type!=='cycle').map(({to})=>`<button class="graph-edge-plus" data-action="graph-insert" data-target="${to.node._key}" data-graph-drop="${to.node._key}" data-position="before" style="left:${to.x-57}px;top:${to.y+H/2-13}px" title="この枝に要素を挿入" aria-label="${esc(to.node.id||titleOf(to.node))}の枝に挿入">+</button>`).join('');
  const nodes=layout.nodes.map(r=>{
    const n=r.node,key=n._key,ls=[...(n.keywords||[]),...(labels[key]||[])];
    return `<div class="graph-node ${r.type} ${selected.has(key)?'selected':''} ${active===key?'active':''}" data-node="${key}" data-graph-node="${key}" ${r.type==='cycle'?'':`data-graph-drop="${key}" data-position="inside"`} data-type="${r.type}" data-id="${esc(n.id||'')}" style="left:${r.x}px;top:${r.y}px;width:${W}px;height:${H}px" draggable="${!['document','cycle'].includes(r.type)}" role="treeitem" aria-label="${esc(TYPES[r.type].label+' '+(n.id||'')+' '+titleOf(n))}" aria-selected="${selected.has(key)}" ${r.children?`aria-expanded="${!collapsed.has(key)}"`:''} tabindex="0" title="${esc(titleOf(n))}"><div class="graph-node-head"><span class="graph-kind">${TYPES[r.type].label}</span>${n.id&&r.type!=='category'?`<span class="graph-id">${esc(n.id)}</span>`:''}${r.children?`<button class="graph-collapse" data-action="graph-collapse" data-target="${key}" title="${collapsed.has(key)?'展開':'折りたたむ'}" aria-label="${esc(n.id||titleOf(n))}の子を${collapsed.has(key)?'展開':'折りたたむ'}">${collapsed.has(key)?'+':'−'}</button>`:''}</div><div class="graph-node-text">${esc(titleOf(n).replace(/^＜|＞$/g,''))}</div><div class="graph-node-foot">${r.type==='cycle'?'<span>↻ クリックして専用タブで編集</span>':''}${r.type==='specification'?`<span class="graph-verified" title="レビュー・実装・テスト">${(n.verified||[false,false,false]).map(x=>x?'■':'□').join(' ')}</span>`:''}${ls.length?`<span class="graph-label" title="${esc(ls.join(' / '))}">${esc(ls[0])}${ls.length>1?' +'+(ls.length-1):''}</span>`:''}${collapsed.has(key)&&r.children?`<span>${r.children} 件を折りたたみ</span>`:''}</div></div>`;
  }).join('');
  return `<div class="graph-tools"><div class="flex">${btn('graph-zoom-out','−',null,'icon','aria-label="グラフを縮小"')}<span id="graphZoom">${Math.round(zoom*100)}%</span>${btn('graph-zoom-in','+',null,'icon','aria-label="グラフを拡大"')}${btn('graph-fit','全体を収める',null)}${btn('graph-actual','100%',null)}</div><span class="spacer"></span>${btn('locate','選択を中央へ',null)}${btn('graph-focus','選択範囲',null)}${btn('graph-all','文書全体',null)}${btn('graph-wide',wide?'ツリーを表示':'表示領域を広げる',null)}</div><div class="graph-legend">${Object.entries(TYPES).map(([t,v])=>`<span><i class="graph-swatch ${t}"></i>${v.label}</span>`).join('')}</div><div class="graph-viewport" tabindex="0" aria-label="ツリーグラフのキャンバス"><div class="graph-sizer" style="width:${layout.width*zoom}px;height:${layout.height*zoom}px"><div class="graph-stage" style="width:${layout.width}px;height:${layout.height}px;transform:scale(${zoom})"><svg class="graph-lines" style="width:${layout.width}px;height:${layout.height}px" aria-hidden="true">${paths}</svg>${plus}<div role="tree" aria-label="USDMツリーグラフ" aria-multiselectable="true">${nodes}</div></div></div></div><div class="graph-hint" id="graphHint">ノードをクリックして編集 · 枝へドラッグで直前に移動 · ＋で挿入 · 背景ドラッグで移動 / Ctrl＋ホイールで拡大縮小</div>`;
}
let dragKeys=[];
export function setGraphDragKeys(keys){dragKeys=[...keys];}
export function bindGraph({selected,startDrag,canMove,move,select,zoomBy,remember}) {
  const viewport=document.querySelector('.graph-viewport');if(!viewport)return;
  const targets=[...viewport.querySelectorAll('[data-graph-drop]')],hint=document.querySelector('#graphHint'),normalHint=hint.textContent;
  const clear=()=>{viewport.querySelectorAll('.graph-drop-valid,.graph-drop-invalid').forEach(el=>el.classList.remove('graph-drop-valid','graph-drop-invalid'));hint.textContent=normalHint;};
  const paint=(el,valid)=>{clear();const edge=el.classList.contains('graph-edge-hit')?el.closest('.graph-edge'):el;edge.classList.add(valid?'graph-drop-valid':'graph-drop-invalid');hint.textContent=valid?(el.dataset.position==='before'?'この枝の要素の直前へ移動':'このノードの子として末尾へ移動'):'ここには移動できません（要素の種類・必須の子要素を確認）';};
  viewport.querySelectorAll('[data-graph-node]').forEach(el=>{
    el.onkeydown=e=>{if(e.target!==el)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();select(el.dataset.node,e);}};
    el.ondragstart=e=>{if(e.target.closest('button')||!startDrag(el.dataset.node)){e.preventDefault();return;}dragKeys=selected();e.dataTransfer.setData('text/plain',JSON.stringify(dragKeys));e.dataTransfer.effectAllowed='move';viewport.classList.add('graph-dragging');};
    el.ondragend=()=>{dragKeys=[];clear();viewport.classList.remove('graph-dragging');};
  });
  targets.forEach(el=>{
    let cached='';let valid=false;
    el.ondragover=e=>{e.stopPropagation();const signature=dragKeys.join('|');if(signature!==cached||!cached){cached=signature;valid=canMove(dragKeys,el.dataset.graphDrop,el.dataset.position);}e.preventDefault();e.dataTransfer.dropEffect=valid?'move':'none';paint(el,valid);};
    el.ondragleave=e=>{if(el.contains(e.relatedTarget))return;clear();};
    el.ondrop=e=>{e.preventDefault();e.stopPropagation();clear();viewport.classList.remove('graph-dragging');try{const keys=JSON.parse(e.dataTransfer.getData('text/plain'));if(!Array.isArray(keys)||!keys.length)return;move(keys,el.dataset.graphDrop,el.dataset.position);}catch{}dragKeys=[];};
  });
  let pan=null;
  viewport.onpointerdown=e=>{if(e.button!==0||e.target.closest('.graph-node,button,.graph-edge-hit'))return;pan={x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(e.pointerId);viewport.classList.add('panning');};
  viewport.onpointermove=e=>{if(!pan)return;viewport.scrollLeft=pan.left+pan.x-e.clientX;viewport.scrollTop=pan.top+pan.y-e.clientY;};
  viewport.onpointerup=viewport.onpointercancel=e=>{pan=null;viewport.classList.remove('panning');if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);};
  viewport.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();zoomBy(e.deltaY<0?1.12:1/1.12,{x:e.clientX-viewport.getBoundingClientRect().left,y:e.clientY-viewport.getBoundingClientRect().top});},{passive:false});
  viewport.onscroll=()=>remember(viewport.scrollLeft,viewport.scrollTop);
  viewport.addEventListener('dragover',e=>{const r=viewport.getBoundingClientRect();if(e.clientX<r.left+35)viewport.scrollLeft-=20;if(e.clientX>r.right-35)viewport.scrollLeft+=20;if(e.clientY<r.top+35)viewport.scrollTop-=20;if(e.clientY>r.bottom-35)viewport.scrollTop+=20;},true);
}
