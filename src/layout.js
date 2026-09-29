const STORAGE='usdm-studio.layout.v1';
const MODES=['normal','compact','hidden'];
const DEFAULTS={sidebar:'normal',inspector:'normal',header:'normal',sidebarOpen:'normal',inspectorOpen:'normal'};
const MODE_NAMES={normal:'標準',compact:'小型',hidden:'非表示'};

export function createLayout({$, $$, btn, modal, toast}) {
  const state={...DEFAULTS};
  try {
    const saved=JSON.parse(localStorage.getItem(STORAGE));
    for(const key of ['sidebar','inspector','header'])if(MODES.includes(saved?.[key]))state[key]=saved[key];
    for(const key of ['sidebarOpen','inspectorOpen'])if(['normal','compact'].includes(saved?.[key]))state[key]=saved[key];
  } catch { /* Layout storage is optional; document storage is independent. */ }
  for(const key of ['sidebar','inspector'])if(state[key]!=='hidden')state[key+'Open']=state[key];

  function classes(){return ['sidebar','inspector','header'].map(key=>`${key}-${state[key]}`).join(' ');}
  function apply(){
    const shell=$('.app-shell');if(!shell)return;
    for(const key of ['sidebar','inspector','header'])for(const mode of MODES)shell.classList.toggle(`${key}-${mode}`,state[key]===mode);
    for(const [key,name] of [['sidebar','エクスプローラー'],['inspector','プロパティ']]) {
      const visible=state[key]!=='hidden',label=`${name}を${visible?'隠す':'表示'}`;
      $$(`[data-action="toggle-${key}"]`).forEach(button=>{
        button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-expanded',String(visible));
        button.setAttribute('aria-pressed',String(visible));
      });
    }
    const next=MODES[(MODES.indexOf(state.header)+1)%MODES.length];
    $$('[data-action="cycle-header"]').forEach(button=>{
      button.title=`上部：${MODE_NAMES[state.header]} → ${MODE_NAMES[next]}`;
      button.setAttribute('aria-label',`上部を${MODE_NAMES[next]}にする`);button.dataset.mode=state.header;
    });
    $$('[data-layout-setting]').forEach(select=>select.value=state[select.dataset.layoutSetting]);
    $$('[data-action="graph-wide"]').forEach(button=>button.textContent=state.sidebar==='hidden'?'ツリーを表示':'表示領域を広げる');
  }
  function set(values){
    const focused=document.activeElement;
    const viewport=$('.graph-viewport');
    const center=viewport?{x:viewport.scrollLeft+viewport.clientWidth/2,y:viewport.scrollTop+viewport.clientHeight/2}:null;
    for(const [key,value] of Object.entries(values)) {
      if(!['sidebar','inspector','header'].includes(key)||!MODES.includes(value))continue;
      if(key!=='header'&&value!=='hidden')state[key+'Open']=value;
      state[key]=value;
    }
    apply();
    if(viewport&&center){viewport.scrollLeft=center.x-viewport.clientWidth/2;viewport.scrollTop=center.y-viewport.clientHeight/2;}
    try{localStorage.setItem(STORAGE,JSON.stringify(state));}catch{toast('表示は変更しました。このブラウザでは表示設定を保存できません。');}
    if(!$('#dialog').open) {
      if(state.sidebar==='hidden'&&focused?.closest('.sidebar'))$('.layout-controls [data-action="toggle-sidebar"]')?.focus();
      else if(state.inspector==='hidden'&&focused?.closest('.inspector'))$('.layout-controls [data-action="toggle-inspector"]')?.focus();
      else if(state.header==='hidden'&&focused?.closest('.topbar,.workspace-info'))$('.layout-controls [data-action="cycle-header"]')?.focus();
    }
  }
  function toggle(key){set({[key]:state[key]==='hidden'?state[key+'Open']:'hidden'});}
  function cycleHeader(){set({header:MODES[(MODES.indexOf(state.header)+1)%MODES.length]});}
  function controls(){return `<div class="layout-controls" role="group" aria-label="表示領域">${btn('toggle-sidebar','','panel-left','icon layout-toggle','aria-controls="explorerPanel"')}${btn('toggle-inspector','','panel-right','icon layout-toggle','aria-controls="propertyPanel"')}${btn('cycle-header','','panel-top','icon','aria-controls="workspaceInfo"')}${btn('layout-settings','表示','layout','layout-settings-button')}</div>`;}
  function settings(){
    const labels={sidebar:'左：エクスプローラー',inspector:'右：プロパティ',header:'上部：アプリ操作・文書情報'};
    const fields=Object.entries(labels).map(([key,label])=>`<label class="field">${label}<select id="${key}Mode" data-layout-setting="${key}">${MODES.map(mode=>`<option value="${mode}" ${state[key]===mode?'selected':''}>${MODE_NAMES[mode]}</option>`).join('')}</select></label>`).join('');
    modal('表示領域の調整',`<p class="layout-settings-note">設定はすぐに反映され、次回も使えます。入力途中の内容は保持します。</p>${fields}<p class="field-hint layout-hint">上部を隠しても、表示切り替え・保存・各表示モードのタブは残ります。</p><div class="layout-presets">${btn('layout-maximize','編集領域を最大化','layout')}${btn('layout-reset','標準に戻す',null)}</div>`);
    $$('[data-layout-setting]').forEach(select=>select.onchange=()=>set({[select.dataset.layoutSetting]:select.value}));
  }
  return {state,classes,apply,set,toggle,cycleHeader,controls,settings,
    reset:()=>set({sidebar:'normal',inspector:'normal',header:'normal'}),
    maximize:()=>set({sidebar:'hidden',inspector:'hidden',header:'hidden'})};
}
