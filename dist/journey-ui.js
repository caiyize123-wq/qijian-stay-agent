export function createJourneyUI(ctx){
  const {state,boot,esc,icon,btn,place,card,footer,categoryNav,api,persist,render,openModal,drawModal,closeModal,go,toast,photo}=ctx;
  const chapter=()=>{
    if(state.discovery&&!state.journey.manual&&!state.journey.paused){const p=place(state.discovery.pointId);if(p){const known=boot.guideChapters.find(c=>c.pointId===p.id);return known||{id:'discovery-'+p.id,pointId:p.id,number:'01',title:p.name,image:p.image,hotspot:{x:50,y:45},observation:p.intro,fact:p.story,boundary:'酒店资料与现场参与条件请查看官方说明。',source:p.source,next:boot.places.filter(x=>x.id!==p.id&&x.id!=='arrival'&&x.category!=='outside').slice(0,2).map(x=>x.id)};}}
    return boot.guideChapters.find(c=>c.id===state.journey.chapterId)||boot.guideChapters[0]||{id:'empty',pointId:'arrival',number:'01',title:'浏览酒店',image:boot.hotel.cover||'space',hotspot:{x:50,y:45},observation:'酒店体验资料正在整理。',fact:'你可以先浏览已有资料。',boundary:'当前不提供内部体验安排。',source:boot.hotel.source,next:[]};
  };
  const saved=id=>state.confirmations[id];
  const selfStatus=id=>saved(id)?.status==='self_confirmed';
  const isDone=id=>state.journey.seen.includes(id);
  function picture(c,cls=''){
    const image=c.image==='space'?boot.hotel.image:`/assets/${c.image}.jpg`;
    if(!image)return '<div class="missing-project-image">暂无该项目实景图</div>';
    return `<div class="guide-picture ${cls}"><img src="${esc(image)}" alt="${c.image==='space'?esc(boot.hotel.name)+'酒店整体图':esc(c.title)}">${c.image==='space'?'<span class="guide-picture-label">酒店整体图片 · 非项目实景</span>':`<button class="photo-hotspot" style="left:${c.hotspot.x}%;top:${c.hotspot.y}%" data-action="open-guide" aria-label="查看照片观察点">${c.number}<span>看这里</span></button>`}</div>`;
  }

  function home(){
    const c=chapter(),paused=state.journey.paused,personal=state.discovery&&!state.journey.manual,empty=!state.discovery&&!state.journey.manual&&!paused;
    const party=({solo:'独自',couple:'两人',family:'亲子'})[state.preferences.party||'solo'];
    const titles={'lines':'建筑与光','reflection':'水畔片刻','framing':'一杯茶的时间'};
    const captions={'lines':'从庭院开始，发现藏在空间里的细节。','reflection':'把一段闲暇，留给水边。','framing':'找一个位置，坐下来。'};
    const hasProjectImage=c.image!=='space';
    const actualImage=hasProjectImage?`/assets/${c.id==='lines'?'pool3':c.image}.jpg`:boot.hotel.image||null;
    const visual=actualImage?`<img src="${esc(actualImage)}" alt="${!hasProjectImage?'飞猪平台酒店整体图片，非具体体验位置':esc(boot.hotel.name)+' · '+esc(c.title)}" fetchpriority="high">`:`<div class="home-no-photo">${icon('architecture')}<span>酒店实景图暂缺</span></div>`;
    return `<div class="stay-heading"><h1>此刻，去哪里？</h1><div class="home-context"><button class="hotel-switch" data-action="hotels" aria-label="切换酒店，当前${esc(boot.hotel.name)}">${icon('pin')}<span>${esc(boot.hotel.name)}</span>${icon('down')}</button><button class="profile-control" data-action="profile" aria-label="调整推荐偏好">${party} · ${state.preferences.minutes}分钟 ${icon('down')}</button></div></div>
    <section class="stay-scene spatial-scene" aria-label="主动发现一个细节" data-engine="${esc(state.discovery?.engine||'none')}" data-point-id="${esc(state.discovery?.pointId||'')}" data-party="${esc(state.discovery?.preferences?.party||'')}" data-style="${esc(state.discovery?.preferences?.style||'')}" data-minutes="${state.discovery?.preferences?.minutes||0}" data-generated-at="${esc(state.discovery?.generatedAt||'')}"><div class="stay-visual">${visual}<span class="home-image-note">${actualImage?(hasProjectImage?'体验相关图片':'酒店整体图片 · 非项目实景'):'体验随你的偏好推荐'}</span>${boot.hotel.tier!=='connected'?`<div class="scene-pagination">${boot.guideChapters.map(x=>`<button class="${x.id===c.id?'active':''}" data-action="chapter" data-id="${x.id}" aria-label="探索${esc(x.title)}" aria-pressed="${x.id===c.id}">${esc(x.number)}</button>`).join('')}</div>`:''}</div><div class="stay-scene-copy"><h2>${paused?'随时，继续。':empty?'先看看酒店':esc(personal?state.discovery.title:(titles[c.id]||c.title))}</h2><p>${paused?'你的探索进度已保留。':empty?'这段时间没有合适安排，可以调整偏好或自由探索。':esc(personal?state.discovery.reason:(captions[c.id]||c.observation))}</p><div class="scene-context">${icon('clock')}<span>${personal?`${esc(state.discovery.preferences.start)} · ${state.discovery.preferences.minutes} 分钟`:`${party} · ${state.preferences.minutes} 分钟`}</span><button data-action="profile">调整偏好 ${icon('arrow')}</button></div><div class="scene-actions">${btn(paused?'resume-guide':'open-guide',`${paused?'继续探索':'开始探索'} ${icon('arrow')}`)}${btn('next-guide','换一处','scene-next')}</div></div></section>
    <div class="stay-shortcuts"><button class="assistant-plan" data-action="planner">${icon('calendar')}<span>帮我安排</span>${icon('arrow')}</button><button data-action="view" data-view="experiences">${icon('compass')}<span>酒店体验</span>${icon('arrow')}</button><button data-action="nearby">${icon('map')}<span>酒店周边</span>${icon('arrow')}</button></div>
    ${state.plan?`<button class="stay-resume" data-action="view" data-view="plan"><span>${icon('calendar')}我的安排</span><span>${state.plan.items.length} 项体验 ${icon('arrow')}</span></button>`:''}${footer()}`;
  }

  function decisionCard(p){
    const tags={architecture:'适合慢慢观察',dining:'想坐坐或吃点东西',wellness:p.id==='spa'?'先分清护理与泡池':'给自己一点活动时间',activity:'先取得今日活动表'};
    return `<div class="decision-card">${card(p)}<div class="decision-detail"><span>${esc(tags[p.category])}</span><span>${p.duration?`建议停留 ${p.duration} 分钟`:'具体时长待确认'}</span><p>${p.category==='architecture'?'通行范围待确认':'费用与套餐权益需核对'}</p><div><button data-action="participate" data-id="${p.id}">${selfStatus(p.id)?'你已自行确认条件':'参与前，确认一下'} ${icon('arrow')}</button><button data-action="plan-with" data-id="${p.id}" aria-label="安排${esc(p.name)}">${icon('calendar')}</button></div></div></div>`;
  }
  function guide(){
    const c=chapter();if(boot.hotel.tier==='connected')return ctx.connectedDetail(place(c.pointId));return `${picture(c,'drawer-guide-photo')}<div class="drawer-content"><div class="eyebrow">A DETAIL WORTH NOTICING · ${c.number}</div><h2>${esc(c.title)}</h2><p>${esc(c.observation)}</p><div class="observation"><div class="eyebrow">有依据的背景</div><p>${esc(c.fact)}</p></div><details class="guide-sources"><summary>资料来源</summary><p class="note">${esc(c.boundary)}</p><a class="source-link" href="${esc(c.source)}" target="_blank" rel="noreferrer">酒店官网 ↗</a></details><div class="two-actions">${btn('next-guide',`看过了，继续下一处 ${icon('arrow')}`)}${btn('pause-guide','暂停，保留进度','secondary')}</div><div class="section-head"><h2>也可以换一种过法</h2></div>${c.next.map(id=>{const p=place(id);return `<div class="result-row" data-action="detail" data-id="${id}" role="button" tabindex="0"><img src="${photo(p)}" alt=""><div><h3>${esc(p.name)}</h3><p>${esc(p.intro)}</p></div></div>`;}).join('')}</div>`;
  }
  function participation(id){
    const p=place(id),s=boot.participation[id],record=saved(id),checked=record?.checks||[],a=record?.appointment;
    return `<div class="drawer-content"><div class="eyebrow">FROM DISCOVERY TO EXPERIENCE</div><h2>去体验之前，确认一下。</h2><p>${esc(p.name)} · 把费用、条件与参与方式弄清楚，再出发。</p>${s.tel?`<div class="contact-card"><div><span class="eyebrow">${esc(s.contactName)}</span><h3>${esc(s.phone)}${s.extension?` 转 ${esc(s.extension)}`:''}</h3><p class="note">酒店官网公开电话 · 由你自行联系</p></div><a class="primary small" href="${s.tel}">${icon('arrow')}拨打酒店电话</a></div>`:`<div class="observation"><p>通过酒店详情页联系酒店，核对开放和参与条件。</p><a class="source-link" href="${esc(s.source)}" target="_blank" rel="noreferrer">查看酒店详情 ↗</a></div>`}<form id="participation-form" data-id="${id}"><div class="confirmation-label"><span>${record?'你已自行确认过':'待你向酒店核对'}</span><small>不是酒店系统验证的预约</small></div><div class="participation-checks">${s.questions.map((q,i)=>`<label class="check"><input type="checkbox" name="checks" value="${i}" ${checked.includes(i)?'checked':''}><span>${esc(q)}</span></label>`).join('')}</div><button type="button" class="text-btn" data-action="copy-questions" data-id="${id}">${icon('download')}复制这份询问清单</button>
    ${!['arrival','activities'].includes(id)?`<details class="appointment-fields" ${a?'open':''}><summary>有确定时间？记进我的安排</summary><p class="note">仅填写你实际向酒店确认的时间。重新规划时会保留它；不会自动预订。</p><label class="check"><input type="checkbox" name="hasAppointment" ${a?'checked':''}><span>这项体验已有我自行确认的时间</span></label><div class="form-row"><label class="field"><span class="field-label">日期</span><input name="appointmentDate" type="date" value="${esc(a?.date||state.preferences.date||boot.clock.date)}"></label><label class="field"><span class="field-label">开始时间</span><input name="appointmentStart" type="time" value="${esc(a?.start||state.preferences.start||boot.clock.time)}"></label></div><label class="field"><span class="field-label">已确认的时长（分钟）</span><input class="text-input" type="number" name="appointmentMinutes" min="10" max="240" value="${a?.minutes||p.duration||p.suggestedDuration||60}"></label></details>`:''}
    <label class="field"><span class="field-label">给自己留个备注（可选）</span><textarea name="notes" rows="3" maxlength="400" placeholder="例如：需要提前到场、到店再确认费用">${esc(record?.notes||'')}</textarea></label><label class="check attestation"><input type="checkbox" name="attested" ${record?'checked':''}><span>我已经自行向酒店核对以上事项。这是我的记录，不代表产品替我预约或验证。</span></label><div id="participation-feedback">${state.drawerError?`<div class="error-box" role="alert">${esc(state.drawerError)}</div>`:''}</div><div class="two-actions"><button type="submit" class="primary">${icon('check')}保存我的确认记录</button>${record?btn('clear-confirmation','清除记录','secondary',`type="button" data-id="${id}"`):''}</div></form><a class="source-link" href="${esc(s.source)}" target="_blank" rel="noreferrer">${esc(s.sourceLabel)} ↗ · ${esc(s.sourceCheckedAt)}</a><p class="note">${esc(s.notice)}</p></div>`;
  }
  function replacement(id){
    const p=place(id),options=state.alternatives||[];
    return `<div class="drawer-content"><div class="eyebrow">CHANGE ONE THING, KEEP YOUR PACE</div><h2>只换这一项。</h2><p>替换「${esc(p.name)}」，保留其他项目与时间。下面选项已检查能否放进原时段附近。</p>${state.drawerError?`<div class="error-box">${esc(state.drawerError)}</div>`:''}${options.length?options.map(x=>{const p=place(x.id);return `<div class="alternative-card"><img src="${photo(p)}" alt=""><div><h3>${esc(p.name)}</h3><p>${esc(x.start)}—${esc(x.end)} · ${esc(x.reason)}</p><p class="note">${esc(x.fee)}</p><button class="text-btn" data-action="choose-replacement" data-id="${id}" data-replacement="${x.id}">就换成这一项 ${icon('arrow')}</button></div></div>`;}).join(''):'<div class="observation"><p>目前没有足够时间容纳其他有依据的体验。可以把这段留白，其他安排不动。</p></div>'}${btn('leave-blank',`${icon('leaf')}这段先留白`,'secondary wide',`data-id="${id}"`)}</div>`;
  }
  function itemActions(item){if(['paused','expired'].includes(place(item.id)?.contentState))return `<div class="plan-item-actions">${item.locked?btn('lock-item','解除保留','text-btn',`data-id="${item.id}" data-locked="false"`):btn('replace-item','换一项体验','text-btn',`data-id="${item.id}"`)}</div>`;if(item.kind==='outside')return `<div class="plan-item-actions"><button data-action="lock-item" data-id="outside" data-locked="${!item.locked}" aria-label="${item.locked?'解除保留':'保留时段'}${esc(place(item.id).name)}">${icon('clock')}${item.locked?'时段已保留':'保留时段'}</button><button data-action="replace-item" data-id="outside" ${item.locked?'disabled':''}>${icon('spark')}只换这一项</button></div>`;return `<div class="plan-item-actions"><button data-action="lock-item" data-id="${item.id}" data-locked="${!item.locked}" aria-label="${item.locked?'解除保留':'保留时段'}${esc(place(item.id).name)}">${icon(item.locked?'check':'clock')}${item.locked?'时段已保留':'保留时段'}</button><button data-action="replace-item" data-id="${item.id}" ${item.locked?'disabled':''}>${icon('spark')}只换这一项</button><button data-action="participate" data-id="${item.id}">${icon('info')}${selfStatus(item.id)?'查看我的确认':'参与前确认'}</button></div>`;}
  function summary(plan){
    const locked=plan.items.filter(x=>x.locked).length,pending=plan.items.filter(x=>x.kind!=='outside'&&!selfStatus(x.id)).length;
    return `<div class="plan-summary"><span>${locked?`${locked} 个时段已保留`:'可自由调整时段'}</span><span>${pending} 项参与条件待你确认</span><span>${Math.max(0,plan.unallocatedMinutes??plan.freeMinutes??0)} 分钟可留白${plan.unallocatedMinutes===undefined?'':'（扣除规划缓冲后）'}</span></div>`;
  }
  function fixedNote(){const anchors=state.plan?.items.filter(x=>x.locked)||[];const appointments=Object.values(state.confirmations).filter(x=>x.appointment);if(!anchors.length&&!appointments.length)return '';return `<div class="warning">已确定事项会参与时间检查：${[...new Set([...anchors.map(x=>`${place(x.id).name} ${x.start}—${x.end}`),...appointments.map(x=>`${place(x.id).name} ${x.appointment.date} ${x.appointment.start}—${x.appointment.end}（你自行确认）`)])].map(esc).join('；')}。改变日期或时间范围时，请核对是否仍能容纳。</div>`;}
  function updateJourney(){persist();render();if(state.modal?.type==='guide')drawModal();}
  async function edit(change){try{state.plan=await api('/api/plan/edit',change);if(change.id==='outside'&&['remove','replace'].includes(change.operation))state.preferences.includeOutside=false;closeModal(false);render();toast('已保存修改，其他安排已保留');}catch(e){if(state.modal){state.drawerError=e.message;drawModal();}else toast(e.message);}}
  async function handle(action,el){
    const id=el.dataset.id;
    if(action==='open-guide'){openModal('guide');return true;}
    if(action==='chapter'){state.journey.manual=true;state.journey.chapterId=id;state.journey.paused=false;updateJourney();return true;}
    if(action==='next-guide'){
      const c=chapter();state.journey.manual=true;if(boot.guideChapters.some(x=>x.id===c.id)&&!state.journey.seen.includes(c.id))state.journey.seen.push(c.id);
      const index=boot.guideChapters.findIndex(x=>x.id===c.id);const next=boot.guideChapters[index+1];
      if(next){state.journey.chapterId=next.id;state.journey.paused=false;updateJourney();}
      else{state.journey.paused=true;persist();closeModal(false);render();toast('这些体验已看过，接下来按自己的心情探索');}return true;
    }
    if(action==='pause-guide'||action==='resume-guide'){state.journey.paused=action==='pause-guide';persist();closeModal(false);render();return true;}
    if(action==='mood'){state.preferences.style=el.dataset.style;persist();openModal('planner');return true;}
    if(action==='participate'){openModal('participation',id);return true;}
    if(action==='copy-questions'){
      const s=boot.participation[id],text=`我想体验${place(id).name}，想向酒店确认：\n${s.questions.map((q,i)=>`${i+1}. ${q}`).join('\n')}`;
      try{await navigator.clipboard.writeText(text);toast('询问清单已复制，由你自行发送或询问');}catch{toast('浏览器暂不允许复制，可以直接查看上面的清单');}return true;
    }
    if(action==='clear-confirmation'){
      try{const r=await api('/api/confirmations',{id,status:'clear'});state.confirmations=r.confirmations;state.plan=r.plan||state.plan;drawModal();render();toast('已清除自行记录，未联系酒店或取消预约');}catch(e){toast(e.message);}return true;
    }
    if(action==='lock-item'){await edit({operation:'lock',id,locked:el.dataset.locked==='true'});return true;}
    if(action==='replace-item'){
      try{state.alternatives=(await api('/api/plan/alternatives?id='+encodeURIComponent(id),undefined,'GET')).items;openModal('replacement',id);}catch(e){toast(e.message);}return true;
    }
    if(action==='choose-replacement'){await edit({operation:'replace',id,replacementId:el.dataset.replacement});return true;}
    if(action==='leave-blank'){await edit({operation:'remove',id});return true;}
    if(action==='remove'){await edit({operation:'remove',id});return true;}
    return false;
  }
  async function submitConfirmation(form){
    const data=new FormData(form),id=form.dataset.id,appointment=data.has('hasAppointment')?{date:data.get('appointmentDate'),start:data.get('appointmentStart'),minutes:Number(data.get('appointmentMinutes'))}:null;
    try{const r=await api('/api/confirmations',{id,status:'self_confirmed',attested:data.has('attested'),checks:data.getAll('checks').map(Number),notes:data.get('notes'),appointment});state.confirmations=r.confirmations;state.plan=r.plan||state.plan;state.drawerError=null;drawModal();render();toast(appointment?'已记下；下一次规划会保留你确认的时间':'已保存你的自行确认记录');}
    catch(e){state.drawerError=e.message;const feedback=document.querySelector('#participation-feedback');if(feedback)feedback.innerHTML=`<div class="error-box" role="alert">${esc(e.message)}</div>`;}
  }
  return {home,guide,participation,replacement,itemActions,summary,fixedNote,handle,submitConfirmation,selfStatus};
}
