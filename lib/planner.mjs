import * as defaultCatalog from './catalog.mjs';
export class PlanningError extends Error { constructor(message){super(message);this.status=400;this.code='PLAN_CONFLICT';} }
export function parseTime(value,allowMidnight=false){
  if(allowMidnight&&value==='24:00')return 1440;
  if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw new PlanningError('请选择有效时间');
  const [h,m]=value.split(':').map(Number);return h*60+m;
}
const stamp=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export function shanghaiClock(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(date).map(x=>[x.type,x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, month: Number(parts.month) };
}
export function windowsFor(p,date) {
  if (p.windows === 'seasonal-pool') { const m=Number(date.slice(5,7)); return m>=5&&m<=10 ? [[420,1260]] : [[540,1080]]; }
  return p.windows;
}
export function createPlanner({places,getPlace,hotel}) {
function validatePreferences(input = {}) {
  const clock=shanghaiClock();
  const date=typeof input.date==='string'?input.date:clock.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date+'T00:00:00+08:00')) || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date) throw new PlanningError('请选择有效日期');
  const start=typeof input.start==='string'?input.start:clock.time;
  parseTime(start);
  const minutes=Number(input.minutes??120);
  if(![30,60,120,180,240].includes(minutes))throw new PlanningError('可用时长请选择30、60、120、180或240分钟');
  const party=['solo','couple','family'].includes(input.party)?input.party:'solo';
  const includeOutside=input.includeOutside===true;if(includeOutside&&!getPlace('outside'))throw new PlanningError('请先选择一个周边地点');
  const style=['explore','relax','food','family'].includes(input.style)?input.style:'explore';
  const selected=Array.isArray(input.selected)?[...new Set(input.selected)].filter(id=>!!getPlace(id)&&id!=='arrival').slice(0,8):[];
  const fixedItems=[];
  if(input.fixedItems!==undefined&&!Array.isArray(input.fixedItems))throw new PlanningError('保留时段格式无效');
  for(const x of (input.fixedItems||[]).slice(0,8)){
    const point=getPlace(x.id);if((!point?.duration&&!(point?.scheduleRequired&&point.contentState!=='expired'&&point.contentState!=='paused'&&x.origin==='user-confirmed'))||x.id==='arrival')throw new PlanningError('此项目不能保留固定时段');
    const s=parseTime(x.start),e=parseTime(x.end,true);
    if(e<=s||e-s>240||fixedItems.some(y=>y.id===x.id))throw new PlanningError('保留时段无效或存在重复项目');
    fixedItems.push({id:x.id,start:x.start,end:x.end,origin:x.origin==='user-confirmed'?'user-confirmed':'user-locked'});
  }
  return {date,start,minutes,style,party,includeOutside,selected,noExtraSpend:input.noExtraSpend===true,fixedItems};
}
function createPlan(input, options = {}) {
  const prefs=validatePreferences(input);const [h,m]=prefs.start.split(':').map(Number);let cursor=h*60+m;
  const deadline=Math.min(1440,cursor+prefs.minutes);
  const orders={explore:['garden','tea','xia','pool','gym','spa'],relax:['spa','garden','tea','pool','gym','xia'],food:['tea','xia','garden','pool','spa','gym'],family:['garden','tea','pool','xia','gym','spa']};
  const dynamic=places.filter(p=>p.id!=='arrival'&&p.category!=='outside').sort((a,b)=>{
    const categoryOrder=prefs.style==='food'?['dining','architecture','wellness','activity']:prefs.style==='relax'?['wellness','architecture','dining','activity']:prefs.party==='family'||prefs.style==='family'?['activity','architecture','dining','wellness']:['architecture','activity','dining','wellness'];
    return categoryOrder.indexOf(a.category)-categoryOrder.indexOf(b.category);
  }).map(p=>p.id);
  const order=(options.selectedOnly?prefs.selected:[...prefs.selected,...orders[prefs.party==='family'?'family':prefs.style],...dynamic]).filter((x,i,a)=>a.indexOf(x)===i&&x!=='outside');
  if(prefs.includeOutside)order.splice(Math.min(1,order.length),0,'outside');
  const items=[],skipped=[],anchors=prefs.fixedItems.map(x=>({...x,start:parseTime(x.start),end:parseTime(x.end,true)})).sort((a,b)=>a.start-b.start);
  for(let i=0;i<anchors.length;i++){
    const a=anchors[i],p=getPlace(a.id),w=windowsFor(p,prefs.date);
    if(a.start<cursor||a.end>deadline)throw new PlanningError(`「${p.name}」保留时段超出可用时间，请扩大范围或解除保留。`);
    if(i&&a.start<anchors[i-1].end+10)throw new PlanningError('保留事项相互冲突，或未留出项目间缓冲。');
    if(w&&!w.some(([s,e])=>a.start>=s&&a.end<=e))throw new PlanningError(`「${p.name}」保留时间不在官网时段内，请核对。`);
    if(prefs.noExtraSpend&&(p.requiresCostConfirmation||['dining','wellness','outside'].includes(p.category)))throw new PlanningError(`「${p.name}」费用未确认，请解除保留或调整不额外消费选项。`);
    items.push(makeItem(p,a.start,a.end,true,a.origin));
  }
  for(const id of order){
    if(id==='arrival'||anchors.some(x=>x.id===id))continue;
    const p=getPlace(id);if(['paused','expired'].includes(p?.contentState)){if(prefs.selected.includes(id))skipped.push({id,reason:'这项体验资料已暂停或过期，请选择其他体验'});continue;}if(!p?.duration){if(prefs.selected.includes(id)||(id==='outside'&&prefs.includeOutside))skipped.push({id,reason:'未取得当日活动表，不能安排具体时段'});continue;}
    if(p.requiresExplicitSelection&&!prefs.selected.includes(id))continue;
    if(prefs.noExtraSpend&&(p.requiresCostConfirmation||['dining','wellness','outside'].includes(p.category))){if(prefs.selected.includes(id)||(id==='outside'&&prefs.includeOutside))skipped.push({id,reason:'费用或套餐包含情况未确认，未纳入不额外消费的安排'});continue;}
    const start=findSlot(p,cursor,deadline,prefs.date,anchors);
    if(start===null){if(prefs.selected.includes(id)||(id==='outside'&&prefs.includeOutside))skipped.push({id,reason:'当前时间窗或保留事项之间没有合适时段'});continue;}
    items.push(makeItem(p,start,start+p.duration));cursor=start+p.duration+10;
    if(items.length>=4)break;
  }
  items.sort((a,b)=>parseTime(a.start)-parseTime(b.start));
  return planMetadata({hotelId:hotel.id,preferences:prefs,items,skipped,title:prefs.style==='relax'?'给自己一段慢时光':prefs.style==='food'?'从风味开始探索':prefs.style==='family'?'一起慢慢发现':'你的酒店时光',
    explanation:items.some(x=>x.kind==='outside')?'已按酒店已知时段和你的时间预算整理。外出含自行预留的往返交通，地点开放、消费和实际交通需另行了解；未预约。':items.length?(hotel.tier==='connected'?'已按平台体验资料和你的时间预算整理。停留时长是产品建议，开放时段与参与条件尚未确认；未预约。':'已按官网时段和你可用的时间整理。停留时长是建议，移动预留为规划缓冲，不是实测路程；所有项目均未预约。'):'这个时间窗内暂无足够依据的安排，可以调整时间，或直接浏览酒店体验。',
    engine:'rules',warnings:['现场开放、费用与参与条件请向酒店确认','地图为示意，不提供已验证的现场导航']});
}
function makeItem(p,s,e,locked=false,origin='user-locked'){return {id:p.id,...(p.outing?{kind:'outside',outing:p.outing}:{}),start:stamp(s),end:stamp(e),minutes:e-s,status:'suggested',needsConfirmation:true,source:p.source,locked,lockOrigin:locked?origin:null,note:'建议安排；现场开放与费用需确认。保留时间不代表预约。'};}
function planMetadata(plan){const start=parseTime(plan.preferences.start),end=Math.min(1440,start+plan.preferences.minutes),last=plan.items.length?Math.max(...plan.items.map(x=>parseTime(x.end,true))):start;return {...plan,createdAt:new Date().toISOString(),freeMinutes:Math.max(0,end-last),unallocatedMinutes:Math.max(0,end-start-plan.items.reduce((n,x)=>n+x.minutes,0)-Math.max(0,plan.items.length-1)*10)};}
function findSlot(p,earliest,deadline,date,anchors=[]){
  for(const [a,b] of windowsFor(p,date)||[[0,1440]]){
    let s=Math.max(a,earliest);
    for(const x of anchors){if(s+p.duration<=x.start-10)break;if(s<x.end+10&&s+p.duration>x.start-10)s=x.end+10;}
    if(s+p.duration<=Math.min(b,deadline))return s;
  }return null;
}
function alternativesFor(plan,id){
  if(plan.hotelId&&plan.hotelId!==hotel.id)throw new PlanningError('这份安排属于另一家酒店');
  const index=plan.items.findIndex(x=>x.id===id),old=plan.items[index];if(!old)throw new PlanningError('未找到待替换体验');if(old.locked)throw new PlanningError('请先解除时段保留，再替换体验');
  const end=index<plan.items.length-1?parseTime(plan.items[index+1].start)-10:Math.min(1440,parseTime(plan.preferences.start)+plan.preferences.minutes);
  return places.filter(p=>p.id!=='arrival'&&p.duration&&!plan.items.some(x=>x.id===p.id)&&!(plan.preferences.noExtraSpend&&(p.requiresCostConfirmation||['dining','wellness','outside'].includes(p.category)))).flatMap(p=>{const s=findSlot(p,parseTime(old.start),end,plan.preferences.date);return s===null?[]:[{...makeItem(p,s,s+p.duration),reason:p.category===getPlace(id).category?'同类体验，可放入原时段附近':'换一种体验，不移动其他安排',fee:p.fee}];});
}
function editPlan(plan,change){
  if(plan.hotelId&&plan.hotelId!==hotel.id)throw new PlanningError('这份安排属于另一家酒店');
  const copy=structuredClone(plan),item=copy.items.find(x=>x.id===change.id);
  if(change.operation==='lock'){
    if(!item)throw new PlanningError('未找到体验');item.locked=change.locked===true;item.lockOrigin=item.locked?'user-locked':null;copy.explanation=item.locked?'已保留此时段，后续围绕它安排。保留不代表预约。':'已解除保留，其他安排保持不变。';
  }else if(change.operation==='remove'){
    if(!item)throw new PlanningError('未找到体验');if(item.locked)throw new PlanningError('请先解除保留，再移除此项');copy.items=copy.items.filter(x=>x.id!==change.id);if(change.id==='outside')copy.preferences.includeOutside=false;copy.explanation='已把这段时间留白，其他项目与时间保持不变。';
  }else if(change.operation==='replace'){
    const next=alternativesFor(plan,change.id).find(x=>x.id===change.replacementId);if(!next)throw new PlanningError('此替代体验无法放入原时段，其他安排未修改。');copy.items[copy.items.findIndex(x=>x.id===change.id)]=next;if(change.id==='outside')copy.preferences.includeOutside=false;if(next.kind==='outside')copy.preferences.includeOutside=true;copy.explanation='只替换了这一项，其他项目与时段保持不变。';
  }else if(Array.isArray(change.ids)){
    const originals=copy.items.map(x=>x.id),ids=change.ids;if(ids.some(x=>!originals.includes(x))||new Set(ids).size!==ids.length)throw new PlanningError('安排中含未知或重复项目');if(copy.items.some(x=>x.locked&&!ids.includes(x.id)))throw new PlanningError('请先解除时段保留，再移除此项');return createPlan({...copy.preferences,selected:ids,fixedItems:copy.items.filter(x=>x.locked).map(x=>({id:x.id,start:x.start,end:x.end,origin:x.lockOrigin}))},{selectedOnly:true});
  }else throw new PlanningError('不支持的安排修改');
  copy.preferences.fixedItems=copy.items.filter(x=>x.locked).map(x=>({id:x.id,start:x.start,end:x.end,origin:x.lockOrigin}));copy.preferences.selected=copy.items.map(x=>x.id);return planMetadata(copy);
}
function route(from,to){
  if(!getPlace(from)||!getPlace(to))throw new PlanningError('未找到点位');
  if(getPlace(from).category==='outside'||getPlace(to).category==='outside')throw new PlanningError('外出地点不属于酒店内部点位，请查看地点详情与实际交通');
  const a=getPlace(from),b=getPlace(to);if([a,b].some(p=>['paused','expired'].includes(p.contentState)))throw new PlanningError('该体验资料已暂停或过期，请选择其他点位');
  if(hotel.tier==='connected'||[a,b].some(p=>p.mapAvailable===false))throw new PlanningError('这家酒店尚未接入内部地图，请查看体验资料或酒店官方指引');
  return {hotelId:hotel.id,from,to,schematic:true,verified:false,notice:hotel.mapNotice,points:from===to?[[a.x,a.y]]:[[a.x,a.y],[a.x,385],[b.x,385],[b.x,b.y]],
    steps:from===to?['你已选择此点位作为当前位置。']:['确认当前所在位置',`查看「${b.name}」的楼层与服务信息`,'真实通道尚未核验，请使用酒店地图或向前台问路'],distance:null,duration:null};
}

return {validatePreferences,createPlan,alternativesFor,editPlan,route};
}
export const {validatePreferences,createPlan,alternativesFor,editPlan,route}=createPlanner(defaultCatalog);
