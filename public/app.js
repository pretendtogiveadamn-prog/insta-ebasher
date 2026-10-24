import { esc, button, badge, panel, metric, emptyState, field } from "./components.js";

const $=selector=>document.querySelector(selector);
const state={snapshot:null,mailer:null,tab:(location.hash||"#outreach").slice(1),selectedLeads:new Set(),excludedLeads:new Set(),allReadySelected:false,leadQuery:"",researchQuery:"",planName:"",planBody:"",selectedPlanId:null,selectedAccountId:null,planLeads:[],hasPreview:false,max:35,editBody:"",busy:false};
const titles={home:"ОБЗОР",research:"ЛИДЫ",outreach:"РАССЫЛКА",inbox:"ВХОДЯЩИЕ"};
let toastTimer;

async function api(path,options={}){
  const response=await fetch(`/api${path}`,options);
  const data=await response.json().catch(()=>({error:"Сервер вернул неожиданный ответ"}));
  if(!response.ok)throw Error(data.error||`Ошибка ${response.status}`);
  return data;
}
const post=(path,body)=>api(path,{method:"POST",headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
const patch=(path,body)=>api(path,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
const ig=handle=>`<a href="https://www.instagram.com/${esc(handle)}/" target="_blank" rel="noopener noreferrer">@${esc(handle)}</a>`;
const dateTime=value=>value?new Date(value).toLocaleString("ru-RU",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
const currentPlan=()=>state.snapshot?.campaigns.find(x=>x.id===state.selectedPlanId)||null;
const activeRun=()=>["running","stopping"].includes(state.mailer?.run?.state);
const readyLeads=()=>state.snapshot?.research.leads.filter(x=>x.state==="ready")||[];
const renderMessage=(body,handle)=>String(body||"").replace(/@?{{\s*handle\s*}}/g,`@${handle}`).replace(/{{\s*[^}]+\s*}}/g,"");

function toast(message,error=false){
  const el=$("#toast");el.textContent=message;el.dataset.tone=error?"error":"success";el.hidden=false;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true},5000);
}

function header(){
  $("#current-page").textContent=titles[state.tab]||"РАССЫЛКА";
  const connected=Boolean(state.mailer?.chromeReady);
  $("#connection").innerHTML=badge(connected?"Chrome готов":"Chrome не открыт",connected?"success":"warning");
  const live=state.snapshot?.state.mode!=="dry_run";
  $("#mode").innerHTML=badge(live?"Отправка разрешена":"Режим проверки",live?"success":"neutral");
  document.querySelectorAll("[data-tab]").forEach(el=>el.setAttribute("aria-current",el.dataset.tab===state.tab?"page":"false"));
  document.querySelectorAll(".view").forEach(el=>el.classList.toggle("active",el.id===state.tab));
}

function renderHome(){
  const s=state.snapshot;
  const recent=s.campaigns.slice(0,4).map(c=>`<div class="table-row"><div><strong>${esc(c.name)}</strong><small>${esc(c.status)} · ${c.stats.ready||0} ожидают · ${c.stats.contacted||0} отправлено</small></div>${button("Открыть",{tone:"text",action:"open-plan",extra:`data-id="${esc(c.id)}"`})}</div>`).join("");
  $("#home").innerHTML=`<div class="page-intro"><div><p class="ui-eyebrow">Рабочее пространство</p><h1 id="home-title">Всё под контролем.</h1><p>Лиды, отправка и ответы — в одной локальной панели.</p></div>${button("Открыть рассылку",{tone:"primary",action:"go-outreach"})}</div>
    <div class="metric-strip">${metric("Готовы к отправке",s.research.counts.ready)}${metric("Осталось за 24 часа",s.state.quota.firstDmRemaining)}${metric("Новых ответов",s.inbox.length)}</div>
    <div class="simple-grid">${panel("Следующее действие",`<p class="ui-help">Выберите одобренных артистов, проверьте текст и запустите пробный прогон в разделе «Рассылка».</p>${button("Настроить рассылку",{tone:"primary",action:"go-outreach"})}`,{eyebrow:"01 / процесс"})}
    ${panel("Последние кампании",recent||emptyState("Кампаний пока нет","Создайте первую кампанию в разделе «Рассылка»."),{eyebrow:"02 / история"})}</div>`;
}

function researchRow(lead){
  const controls=lead.state==="review"?`${button("Одобрить",{tone:"soft",action:"approve-lead",extra:`data-id="${esc(lead.id)}"`})}${button("Отклонить",{tone:"quiet",action:"reject-lead",extra:`data-id="${esc(lead.id)}"`})}`:lead.state==="ready"?button("Не писать",{tone:"danger",action:"dnc-lead",extra:`data-id="${esc(lead.id)}"` }):"";
  const evidence=(lead.evidence||[]).slice(0,2).map(x=>esc(x.note||"")).filter(Boolean).join(" · ");
  return `<div class="table-row"><div><strong>${ig(lead.handle)}</strong><small>${esc(lead.state)} · ${esc(lead.verdict)} · ${lead.confidence}%${lead.followers!=null?` · ${lead.followers} подписчиков`:""}</small>${evidence?`<p>${evidence}</p>`:""}</div><div class="table-row__actions">${controls}</div></div>`;
}

function renderResearch(){
  const s=state.snapshot;
  const leads=s.research.leads.filter(x=>!state.researchQuery||x.handle.includes(state.researchQuery));
  $("#research").innerHTML=`<div class="page-intro"><div><p class="ui-eyebrow">CRM / артисты</p><h1 id="research-title">Лиды.</h1><p>Проверьте найденные профили. Для рассылки доступны только одобренные.</p></div></div>
    <div class="metric-strip">${metric("Всего в CRM",s.research.counts.total)}${metric("На проверке",s.research.counts.review)}${metric("Готовы",s.research.counts.ready)}</div>
    <div class="simple-grid"><div>${panel("Список лидов",`${field("Поиск по @имени",`<input id="research-search" type="search" value="${esc(state.researchQuery)}" placeholder="Введите username">`)}<div id="research-list" class="table-list">${leads.slice(0,100).map(researchRow).join("")||emptyState("Ничего не найдено","Измените запрос или дождитесь новых лидов.")}</div>${leads.length>100?`<p class="ui-help">Показано 100 из ${leads.length} записей.</p>`:""}`,{eyebrow:"01 / проверка"})}</div>
    <div>${panel("Задания поиска",`${s.research.jobs.slice(0,8).map(j=>`<div class="table-row"><div><strong>${esc(j.name)}</strong><small>${esc(j.status)} · ${j.found}/${j.target}</small></div></div>`).join("")||emptyState("Заданий пока нет","Когда агент начнёт поиск, прогресс появится здесь.")}<hr class="ui-divider"><form id="job-form" class="form-stack">${field("Название",`<input name="name" required maxlength="100" placeholder="Например, артисты из Нью-Йорка">`)}${field("Источники поиска",`<input name="seeds" required placeholder="producer_a, producer_b">`,"Укажите исходные аккаунты через запятую.")}${field("Тип источника",`<select name="source"><option value="follower">Подписчики</option><option value="tagged">Отметки</option><option value="search">Поиск</option></select>`)}${field("Цель",`<input name="targetCount" type="number" min="1" max="500" value="20" required>`)}${button("Создать задание",{tone:"quiet",type:"submit"})}</form>`,{eyebrow:"02 / ресёрч"})}</div></div>`;
}

function leadChoices(){
  const items=readyLeads().filter(x=>!state.leadQuery||x.handle.includes(state.leadQuery));
  const html=items.slice(0,300).map(x=>`<label class="ui-lead"><input type="checkbox" data-lead-id="${esc(x.id)}" ${(state.allReadySelected?!state.excludedLeads.has(x.id):state.selectedLeads.has(x.id))?"checked":""}><span class="ui-lead__copy"><strong>@${esc(x.handle)}</strong><small>${esc(x.genre||"Артист")} · ${x.followers!=null?`${x.followers} подписчиков · `:""}${esc(x.source?.seed||"CRM")}</small></span></label>`).join("");
  return html||emptyState("Нет подходящих лидов","Проверьте поиск или одобрите профили в CRM.");
}

function planCreator(){
  const allReady=readyLeads();
  const sample=allReady.find(x=>state.selectedLeads.has(x.id))?.handle||"artist";
  return panel("Новая кампания",`<form id="plan-form" class="form-stack">
    ${field("Название кампании",`<input id="plan-name" name="name" value="${esc(state.planName)}" maxlength="120" required placeholder="Например, осень / новые артисты">`)}
    ${field("Текст первого сообщения",`<textarea id="plan-body" name="body" maxlength="2000" required placeholder="Напишите сообщение, которое получит артист.">${esc(state.planBody)}</textarea>`,"Используйте {{handle}}, чтобы подставить @имя. Текст можно изменить до запуска.")}
    <div class="preview"><div class="preview__head"><strong>Так увидит получатель</strong>${badge(`@${sample}`)}</div><p id="draft-preview">${esc(renderMessage(state.planBody,sample)||"Здесь появится пример сообщения.")}</p></div>
    <hr class="ui-divider">
    <div class="ui-panel__head"><div><h3>Кому отправить</h3><p class="section-caption">Все готовые лиды — одним нажатием. При желании снимите галочку с отдельных.</p></div><span id="selection-count">${badge(`${state.allReadySelected?state.snapshot.research.counts.ready-state.excludedLeads.size:state.selectedLeads.size} выбрано`)}</span></div>
    <div class="lead-toolbar">${field("Найти получателя",`<input id="lead-search" type="search" value="${esc(state.leadQuery)}" placeholder="Поиск по @имени">`)}${button(state.allReadySelected?"Все готовые выбраны":"Выбрать всех готовых",{tone:"soft",action:"select-all-ready",disabled:state.allReadySelected||!state.snapshot.research.counts.ready})}</div>
    <div id="lead-choices" class="lead-list">${leadChoices()}</div>
    <div class="selection-summary"><span>${state.allReadySelected?"В кампанию попадут все ready из CRM, включая записи вне экрана.":`Доступно: ${allReady.length}${state.snapshot.research.counts.ready>allReady.length?` из ${state.snapshot.research.counts.ready} — показаны последние`:""}`}</span>${button("Снять выбор",{tone:"text",action:"clear-leads"})}</div>
    <div class="form-actions"><span class="ui-help">${state.mailer.chromeReady&&state.selectedAccountId?"Сохраним список и проверим один DM без отправки.":"Подключите Chrome и аккаунт для проверки."}</span>${button(state.mailer.chromeReady&&state.selectedAccountId?"Сохранить и проверить":"Сохранить кампанию",{tone:"primary",type:"submit",disabled:!(state.allReadySelected||state.selectedLeads.size)||state.busy,extra:'id="continue-button"'})}</div>
  </form>`,{eyebrow:"01 / сообщение и получатели"});
}

function accountsPanel(){
  const accounts=state.mailer.accounts||[];
  const rows=accounts.map(a=>`<div class="account-item"><input type="radio" name="mailer-account" id="account-${esc(a.id)}" value="${esc(a.id)}" ${state.selectedAccountId===a.id?"checked":""} ${!a.enabled?"disabled":""}><label for="account-${esc(a.id)}">${esc(a.username||"Аккаунт")}<small>${a.enabled?`Лимит ${a.dailyCap} / 24 часа${a.cooldownUntil&&Date.parse(a.cooldownUntil)>Date.now()?` · пауза до ${dateTime(a.cooldownUntil)}`:""}`:"Выключен"}</small></label></div>`).join("");
  const chrome=state.mailer.chromeReady?`<div class="ui-inline-note">Chrome подключён. Проверьте, что вы вошли в нужный Instagram-аккаунт в рабочем окне.</div>`:`<div class="ui-inline-note ui-inline-note--warning">Откройте <strong>mailer/start-chrome.bat</strong>, затем войдите в Instagram в этом окне.</div>`;
  const add=accounts.some(a=>a.enabled&&a.profile?.startsWith("local-chrome"))?"":`<hr class="ui-divider"><form id="account-form" class="form-stack">${field("Добавить свой Instagram",`<input name="username" required maxlength="30" autocomplete="off" placeholder="@your_account">`)}${button("Добавить аккаунт",{tone:"quiet",type:"submit"})}</form>`;
  return panel("Ваш аккаунт",`${rows||emptyState("Аккаунт не добавлен","Введите @имя аккаунта, с которого клиент будет отправлять сообщения.")}${chrome}${add}`,{eyebrow:"02 / отправитель"});
}

function planChooser(){
  const plans=state.snapshot.campaigns;
  const selected=currentPlan();
  const options=plans.map(c=>`<button type="button" class="ui-campaign" data-action="select-plan" data-id="${esc(c.id)}" aria-current="${c.id===state.selectedPlanId}"><strong>${esc(c.name)}</strong><small>${esc(c.status)} · ${c.stats.ready||0} ожидают · ${c.stats.contacted||0} отправлено</small></button>`).join("");
  let detail=emptyState("Выберите кампанию","Сохраните новую кампанию слева или откройте существующую.");
  if(selected){
    const recipient=state.planLeads.filter(x=>x.state==="ready");
    detail=`<div class="run-details">${badge(selected.status==="running"?"В работе":selected.status==="approved"?"Готова":selected.status==="stopped"?"На паузе":"Черновик",selected.status==="running"?"success":"neutral")}${badge(`${recipient.length} готовы`)}${badge(state.hasPreview?"Проверка пройдена":"Нужна проверка",state.hasPreview?"success":"warning")}</div>
      <p class="run-summary">Получатели: <b>${recipient.slice(0,5).map(x=>`@${esc(x.handle)}`).join(", ")}${recipient.length>5?` и ещё ${recipient.length-5}`:""}</b></p>
      <div class="campaign-message">${esc(selected.template.body)}</div>
      ${selected.status!=="running"?`<form id="message-form" class="form-stack">${field("Изменить сообщение",`<textarea name="body" maxlength="2000" required>${esc(state.editBody||selected.template.body)}</textarea>`,"После изменения потребуется новая проверка.")}${button("Сохранить новый текст",{tone:"quiet",type:"submit"})}</form>`:`<p class="ui-help">Чтобы изменить текст, сначала остановите кампанию.</p>`}`;
  }
  return panel("Кампания",`${options||emptyState("Кампаний пока нет","Создайте первую слева.")}<hr class="ui-divider">${detail}`,{eyebrow:"03 / готовый список"});
}

function runPanel(){
  const plan=currentPlan(),run=state.mailer.run||{state:"idle",lines:[]};
  const count=state.planLeads.filter(x=>x.state==="ready").length;
  const remaining=state.snapshot.state.quota.firstDmRemaining;
  const maxAllowed=Math.min(35,count||1,remaining||1);
  const canRun=Boolean(plan&&state.selectedAccountId&&state.mailer.chromeReady&&count&&remaining&&!activeRun());
  const liveAllowed=canRun&&state.hasPreview&&state.snapshot.state.mode!=="dry_run";
  const runLabel={idle:"Не запущена",running:"Идёт отправка",stopping:"Останавливается",finished:"Завершена",failed:"Нужна проверка"}[run.state]||run.state;
  const statusTone=run.state==="running"?"success":run.state==="failed"?"danger":run.state==="stopping"?"warning":"neutral";
  const status=`<div class="run-details">${badge(runLabel,statusTone)}${run.startedAt?badge(`Старт ${dateTime(run.startedAt)}`):""}</div>`;
  const controls=`${field("Сообщений в этой партии",`<input id="batch-size" type="number" min="1" max="${maxAllowed}" value="${Math.min(state.max,maxAllowed)}" ${activeRun()?"disabled":""}>`,"Проверка — один получатель. Реальная партия — до текущего лимита.")}
    <div class="run-controls">${button("Проверить без отправки",{tone:"soft",action:"run-dry",disabled:!canRun||state.busy})}${button("Начать отправку",{tone:"primary",action:"run-live",disabled:!liveAllowed||state.busy})}${activeRun()?button("Остановить",{tone:"danger",action:"stop-run"}):""}</div>`;
  const gate=state.snapshot.state.mode!=="dry_run"?`<div class="ui-inline-note">Отправка разрешена для этого запуска. После завершения режим вернётся к проверке. ${activeRun()?"Для прекращения партии используйте «Остановить».":button("Выключить сейчас",{tone:"text",action:"disable-live"})}</div>`:`<form id="enable-form" class="form-stack">${field("Разрешение на реальные сообщения",`<input name="confirmation" autocomplete="off" placeholder="SEND_REAL_MESSAGES" required>`,"После успешной проверки введите фразу SEND_REAL_MESSAGES. Это разрешит отправку из панели.")}${button("Разрешить отправку",{tone:"quiet",type:"submit",disabled:!state.hasPreview})}</form>`;
  const logs=(run.lines||[]).slice(-12).join("\n");
  return panel("Запуск",`${status}${!plan?`<p class="ui-help">Сначала сохраните и выберите кампанию.</p>`:""}${controls}<hr class="ui-divider">${gate}${activeRun()?`<p class="ui-help">Остановка мягкая: текущий шаг завершится, следующий получатель не начнётся.</p>`:""}${logs?`<hr class="ui-divider"><p class="ui-eyebrow">Ход выполнения</p><pre class="ui-log">${esc(logs)}</pre>`:""}`,{eyebrow:"04 / проверка и отправка"});
}

function renderOutreach(){
  const s=state.snapshot;
  const run=state.mailer.run;
  $("#outreach").innerHTML=`<div class="page-intro"><div><p class="ui-eyebrow">Управление сообщениями</p><h1 id="outreach-title">Рассылка.</h1><p>Выберите артистов из CRM, проверьте текст и запускайте отправку со своего аккаунта.</p></div><div class="page-intro__side">${badge(run.state==="running"?"Партия выполняется":run.state==="stopping"?"Остановка запрошена":"Клиентский режим",run.state==="running"?"success":"neutral")}</div></div>
    <div class="metric-strip">${metric("Готовы в CRM",s.research.counts.ready,"Только одобренные")}${metric("Осталось за 24 часа",s.state.quota.firstDmRemaining,s.state.quota.windowEndsAt?`Окно до ${dateTime(s.state.quota.windowEndsAt)}`:"На текущий момент")}${metric("В текущей кампании",currentPlan()?.stats.ready||0,currentPlan()?.name||"Выберите кампанию")}</div>
    <div class="outreach-grid"><div class="outreach-main">${planCreator()}${planChooser()}</div><div class="outreach-side">${accountsPanel()}${runPanel()}</div></div>`;
}

function renderInbox(){
  const s=state.snapshot;
  const rows=s.inbox.slice(0,80).map(item=>`<div class="table-row"><div><strong>${ig(item.handle)}</strong><small>${esc(item.kind)} · ${dateTime(item.received)}</small><p>${esc(item.body)}</p></div></div>`).join("");
  const notes=s.notifications.filter(x=>x.status!=="sent").slice(0,10).map(x=>`<div class="table-row"><div><strong>${esc(x.kind)}</strong><small>${esc(x.status)}</small><p>${esc(x.text)}</p></div>${button("Повторить",{tone:"quiet",action:"retry-note",extra:`data-id="${esc(x.id)}"`})}</div>`).join("");
  $("#inbox").innerHTML=`<div class="page-intro"><div><p class="ui-eyebrow">Ответы и контакты</p><h1 id="inbox-title">Входящие.</h1><p>Ответы артистов и уведомления после отправки.</p></div></div><div class="simple-grid">${panel("Сообщения",rows||emptyState("Пока нет ответов","Когда артист ответит, событие появится здесь."),{eyebrow:"01 / direct"})}${panel("Уведомления",notes||emptyState("Всё обработано","Новых уведомлений нет."),{eyebrow:"02 / сигналы"})}</div>`;
}

function render(){
  if(!state.snapshot||!state.mailer)return;
  header();renderHome();renderResearch();renderOutreach();renderInbox();
}

async function load(force=false){
  try{
    const [snapshot,mailer]=await Promise.all([api("/panel/snapshot"),api("/operator/mailer")]);
    state.snapshot=snapshot;state.mailer=mailer;
    if(!state.selectedAccountId&&mailer.accounts.length)state.selectedAccountId=mailer.accounts.find(a=>a.enabled)?.id||null;
    if(!state.selectedPlanId&&snapshot.campaigns.length)state.selectedPlanId=snapshot.campaigns.find(c=>c.status==="running")?.id||snapshot.campaigns[0].id;
    if(state.selectedPlanId){const details=await api(`/operator/plans/${encodeURIComponent(state.selectedPlanId)}/leads?accountId=${encodeURIComponent(state.selectedAccountId||"")}`);state.planLeads=details.leads;state.hasPreview=details.hasPreview}
    const focused=document.activeElement;
    if(!force&&focused&&/^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName)&&focused.closest(".view.active")){header();return}
    render();
  }catch(error){toast(error.message,true)}
}

function openTab(tab){state.tab=titles[tab]?tab:"outreach";location.hash=state.tab;header();window.scrollTo({top:0,behavior:"smooth"})}
async function act(promise,success){
  if(state.busy)return;state.busy=true;
  try{await promise();state.busy=false;toast(success);await load(true)}catch(error){state.busy=false;toast(error.message,true);render()}
}

document.addEventListener("click",async event=>{
  const tab=event.target.closest("[data-tab]");if(tab){openTab(tab.dataset.tab);return}
  const trigger=event.target.closest("[data-action]");if(!trigger)return;
  const action=trigger.dataset.action,id=trigger.dataset.id;
  if(action==="go-outreach"){openTab("outreach");return}
  if(action==="open-plan"){state.selectedPlanId=id;state.editBody="";openTab("outreach");await load(true);return}
  if(action==="select-plan"){state.selectedPlanId=id;state.editBody="";await load(true);return}
  if(action==="clear-leads"){state.selectedLeads.clear();state.excludedLeads.clear();state.allReadySelected=false;renderOutreach();return}
  if(action==="select-all-ready"){state.allReadySelected=true;state.selectedLeads.clear();state.excludedLeads.clear();renderOutreach();return}
  if(action==="select-visible"){
    readyLeads().filter(x=>!state.leadQuery||x.handle.includes(state.leadQuery)).slice(0,300).forEach(x=>state.selectedLeads.add(x.id));renderOutreach();return;
  }
  if(action==="run-dry"||action==="run-live"){
    const plan=currentPlan();if(!plan)return toast("Сначала выберите кампанию",true);
    const dryRun=action==="run-dry";
    const max=dryRun?1:Math.min(Number(state.max),state.planLeads.filter(x=>x.state==="ready").length,state.snapshot.state.quota.firstDmRemaining);
    await act(()=>post("/operator/mailer/start",{campaignId:plan.id,accountId:state.selectedAccountId,max,dryRun}),dryRun?"Проверочный прогон запущен":"Отправка запущена");return;
  }
  if(action==="stop-run"){await act(()=>post("/operator/mailer/stop"),"Остановка запрошена. Текущий шаг завершится безопасно.");return}
  if(action==="disable-live"){await act(()=>post("/runtime/disable-real-sending"),"Отправка выключена");return}
  if(action==="approve-lead"||action==="reject-lead"||action==="dnc-lead"){
    const decision=action==="approve-lead"?"approve":action==="reject-lead"?"reject":"dnc";
    await act(()=>post(`/research/leads/${encodeURIComponent(id)}/${decision}`),"Статус лида обновлён");return;
  }
  if(action==="retry-note"){await act(()=>post(`/notifications/${encodeURIComponent(id)}/retry`),"Уведомление повторно отправлено")}
});

document.addEventListener("input",event=>{
  const el=event.target;
  if(el.id==="plan-name")state.planName=el.value;
  if(el.id==="plan-body"){
    state.planBody=el.value;
    const sample=readyLeads().find(x=>state.selectedLeads.has(x.id))?.handle||"artist";
    const preview=$("#draft-preview");if(preview)preview.textContent=renderMessage(el.value,sample)||"Здесь появится пример сообщения.";
  }
  if(el.id==="lead-search"){
    state.leadQuery=el.value.trim().toLowerCase();const list=$("#lead-choices");if(list)list.innerHTML=leadChoices();
  }
  if(el.id==="research-search"){
    state.researchQuery=el.value.trim().toLowerCase();const list=$("#research-list");if(list)list.innerHTML=state.snapshot.research.leads.filter(x=>!state.researchQuery||x.handle.includes(state.researchQuery)).slice(0,100).map(researchRow).join("")||emptyState("Ничего не найдено","Измените запрос.");
  }
  if(el.id==="batch-size")state.max=Number(el.value);
});

document.addEventListener("change",event=>{
  const el=event.target;
  if(el.matches("[data-lead-id]")){if(state.allReadySelected){el.checked?state.excludedLeads.delete(el.dataset.leadId):state.excludedLeads.add(el.dataset.leadId)}else{el.checked?state.selectedLeads.add(el.dataset.leadId):state.selectedLeads.delete(el.dataset.leadId)}const count=$("#selection-count");const total=state.allReadySelected?state.snapshot.research.counts.ready-state.excludedLeads.size:state.selectedLeads.size;if(count)count.innerHTML=badge(`${total} выбрано`);const submit=$("#continue-button");if(submit)submit.disabled=!total}
  if(el.name==="mailer-account"){state.selectedAccountId=el.value;state.hasPreview=false;load(true)}
});

document.addEventListener("submit",async event=>{
  const form=event.target;if(!form.id)return;event.preventDefault();
  const data=Object.fromEntries(new FormData(form));
  if(form.id==="plan-form"){
    if(!state.allReadySelected&&!state.selectedLeads.size)return toast("Выберите хотя бы одного получателя",true);
    const autoPreview=Boolean(state.mailer.chromeReady&&state.selectedAccountId);
    await act(async()=>{const plan=await post("/operator/plans",{name:state.planName,body:state.planBody,leadIds:[...state.selectedLeads],allReady:state.allReadySelected,excludedIds:[...state.excludedLeads]});state.selectedPlanId=plan.id;state.selectedLeads.clear();state.excludedLeads.clear();state.allReadySelected=false;state.planName="";state.planBody="";state.editBody="";state.max=35;if(autoPreview)await post("/operator/mailer/start",{campaignId:plan.id,accountId:state.selectedAccountId,max:1,dryRun:true})},autoPreview?"Кампания сохранена. Проверка одного DM запущена.":"Кампания сохранена. Подключите Chrome для проверки.");
  }
  if(form.id==="account-form")await act(()=>post("/operator/mailer/accounts",{username:data.username}),"Аккаунт добавлен. Откройте рабочий Chrome и войдите в Instagram.");
  if(form.id==="message-form"){
    const plan=currentPlan();if(plan)await act(()=>patch(`/operator/plans/${encodeURIComponent(plan.id)}/message`,{body:data.body}),"Текст обновлён. Нужен новый проверочный прогон.");
  }
  if(form.id==="enable-form")await act(()=>post("/runtime/enable-real-sending",{confirmation:data.confirmation}),"Реальная отправка разрешена для запуска");
  if(form.id==="job-form")await act(()=>post("/research/jobs",{name:data.name,seeds:String(data.seeds).split(",").map(x=>x.trim()).filter(Boolean),sources:[data.source],targetCount:Number(data.targetCount)}),"Задание поиска создано");
});

window.addEventListener("hashchange",()=>{const tab=location.hash.slice(1);if(titles[tab]){state.tab=tab;header()}});
new EventSource("/api/panel/events").addEventListener("state",()=>load());
setInterval(()=>load(),5000);
load(true);
