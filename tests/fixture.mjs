export function sample() {
  return {version:'1.1.0',title:'予約管理システム 要求仕様書',metadata:{author:'',description:'予約の作成・変更・通知に関する要求仕様。'},categories:[
    {name:'＜予約管理＞',requirements:[
      {id:'R01',requirement:'利用者は、空き状況を確認して施設を予約できる。',reason:'受付時間に制約されず、希望する施設を確実に利用するため。',explanation:'Webからの予約を対象とする。窓口受付は対象外。',keywords:['予約','利用者'],specificationGroups:[
        {name:'＜空き状況の表示＞',specifications:[{id:'S01-01',specification:'選択した施設の予約可能な時間帯を、日単位のカレンダーに表示する。',verified:[true,true,false]},{id:'S01-02',specification:'予約済みの時間帯は選択できない状態で表示する。',verified:[true,false,false]}]},
        {name:'＜予約の確定＞',specifications:[{id:'S01-03',specification:'予約確定時に空き状況を再確認し、重複予約がある場合はエラーを表示する。',reason:'同時操作による二重予約を防止するため。',verified:[false,false,false]}]}
      ]},
      {id:'R02',requirement:'利用者は、予約内容を変更・取り消しできる。',reason:'予定変更に柔軟に対応するため。',keywords:['予約','変更'],requirementGroups:[{name:'＜予約の変更操作＞',subRequirements:[
        {id:'R02-01',requirement:'利用開始前に予約日時を変更できる。',reason:'予定の調整を可能にするため。',keywords:['変更'],specificationGroups:[{name:'＜日時変更＞',specifications:[{id:'S02-01',specification:'変更先に空きがある場合、予約日時を更新する。',verified:[true,false,false]}]}]},
        {id:'R02-02',requirement:'利用開始前に予約を取り消しできる。',reason:'不要な予約枠を解放するため。',specificationGroups:[{name:'＜取り消し＞',specifications:[{id:'S02-02',specification:'取り消しを確定すると、対象の予約枠を予約可能な状態に戻す。',verified:[false,false,false]}]}]}
      ]}]}
    ]},
    {name:'＜通知＞',requirements:[{id:'R03',requirement:'利用者は、予約の確定をメールで確認できる。',reason:'予約内容を手元に残して確認するため。',keywords:['通知','利用者'],specificationGroups:[{name:'＜予約通知＞',specifications:[{id:'S03-01',specification:'予約確定後、施設名・日時・予約番号を記載したメールを送信する。',verified:[false,false,false]}]}]}]},
    {name:'＜品質要求＞',requirements:[{id:'R04',requirement:'利用者は、待ち時間を意識せず空き状況を確認できる。',reason:'予約操作を円滑に進めるため。',keywords:['性能'],specificationGroups:[{name:'＜表示性能＞',specifications:[{id:'S04-01',specification:'同時利用者100人の条件で、空き状況を2秒以内に表示する。',verified:[false,false,false]}]}]}]}
  ]};
}

export async function loadSample(page) {
  await page.locator('#fileInput').setInputFiles({name:'test-fixture.usdm.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sample()))});
  await page.locator('.requirement-card .card-title').first().click();
}
