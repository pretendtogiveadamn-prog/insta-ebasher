export const esc=value=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));

export function button(label,{tone="quiet",action="",disabled=false,type="button",extra=""}={}){
  return `<button class="ui-button ui-button--${tone}" type="${type}" ${action?`data-action="${esc(action)}"`:""} ${disabled?"disabled":""} ${extra}>${esc(label)}</button>`;
}

export function badge(label,tone="neutral"){
  return `<span class="ui-badge ui-badge--${tone}">${esc(label)}</span>`;
}

export function panel(title,body,{eyebrow="",side=""}={}){
  return `<section class="ui-panel"><div class="ui-panel__head"><div>${eyebrow?`<p class="ui-eyebrow">${esc(eyebrow)}</p>`:""}<h2>${esc(title)}</h2></div>${side}</div>${body}</section>`;
}

export function metric(label,value,detail=""){
  return `<div class="ui-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${detail?`<small>${esc(detail)}</small>`:""}</div>`;
}

export function emptyState(title,description){
  return `<div class="ui-empty"><strong>${esc(title)}</strong><p>${esc(description)}</p></div>`;
}

export function field(label,control,hint=""){
  return `<label class="ui-field"><span class="ui-field__label">${esc(label)}</span>${control}${hint?`<small>${esc(hint)}</small>`:""}</label>`;
}
