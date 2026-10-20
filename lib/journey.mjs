import * as defaultCatalog from './catalog.mjs';
const {hotel}=defaultCatalog;
import {PlanningError,parseTime,createPlanner} from './planner.mjs';

// Observations of official photographs, not invented design intentions or live location claims.
export const guideChapters=[
  {id:'lines',pointId:'garden',number:'01',title:'先看一眼，建筑的线条',subtitle:'把目光从整栋建筑，移到一个细节。',image:'courtyard',hotspot:{x:62,y:37},observation:'照片中，竖向线条与横向楼层边界交织。试着顺着它们看一看，建筑的节奏会更清楚。',fact:'酒店官网介绍了参与空间设计的三个团队，并强调建筑与自然、当地文化的联系。',boundary:'这是对官方照片的观察提示。具体材料、构造及设计用意尚未取得对应说明，不作推断。',source:hotel.source,next:['pool','tea']},
  {id:'reflection',pointId:'pool',number:'02',title:'水面，让画面多了一层',subtitle:'看水，也看看水里的倒影。',image:'pool3',hotspot:{x:46,y:67},observation:'照片中的树与建筑在水面形成倒影。可以先看实体，再看倒影，体会两个画面的对应。',fact:'官网介绍，室外泳池位于一层，长56米。开放时段随季节变化，当天状态仍需确认。',boundary:'观察不等于已获准进入泳池区域。现场访问范围与使用条件需酒店确认。',source:'https://lohkahhotels.com/Wellness-1.html',next:['tea','spa']},
  {id:'framing',pointId:'tea',number:'03',title:'坐下之前，看看窗外',subtitle:'让窗外的绿意，成为片刻停留的一部分。',image:'dining',hotspot:{x:39,y:41},observation:'在这张官方餐饮空间照片中，窗框把绿植分成不同画面。停留时，不妨换个角度看一看。',fact:'官网介绍，大堂 Long Bar 提供饮品、轻食、下午茶与鸡尾酒，邻近的 Library 有茶饮选择。',boundary:'照片为酒店官方餐饮空间图；与具体座位的对应关系、可用座位和消费要求待确认。',source:'https://lohkahhotels.com/dinning-1.html',next:['xia','garden']},
];
export function createJourney(catalog,chapters=guideChapters,planner=createPlanner(catalog)){
const {getPlace,hotel}=catalog;const {validatePreferences}=planner;
const general=['目前是否开放、我能否进入？','是否需要提前预约，在哪里办理？','费用是多少，是否包含在我的已购套餐中？'];
function participationFor(id){
  const p=getPlace(id);if(['paused','expired'].includes(p?.contentState))throw new PlanningError('这项体验资料已暂停或过期，请选择其他体验');if(p?.category==='outside')throw new PlanningError('外出地点请查看飞猪详情，酒店前台不是该地点的预约渠道');if(!p)throw new PlanningError('未找到体验');
  const specifics={tea:['今天的下午茶或饮品菜单是什么？','是否有座位或最低消费要求？'],xia:['用餐时段有位吗，菜单与预算如何？','饮食偏好或过敏信息应向谁说明？'],spa:['我选择的是护理还是泡池，分别需要多久？','需要准备什么，参与条件和更改规则是什么？'],pool:['今天是否开放，是否有临时维护或天气调整？','需要准备哪些物品，是否有年龄或陪同要求？'],gym:['进入方式、器械使用及适用条件是什么？'],activities:['请提供当天课程表、地点和参与条件。','是否另外收费，还有名额吗？'],garden:['哪些公共空间可进入，是否有临时限制？'],arrival:['今天的活动表和酒店地图在哪里取得？']};
  const contact=hotel.contacts?.[id]||{};const phone=contact.phone||hotel.phone;
  return {id,contactName:contact.name||'酒店前台',phone:phone||null,tel:phone?'tel:+86'+phone.replace(/\D/g,'').replace(/^0/,''):null,extension:contact.extension||null,questions:[...general,...(specifics[id.replace(/^live-/, '')]||[])],source:p.source,sourceLabel:p.sourceLabel||'酒店官方说明',sourceCheckedAt:p.sourceCheckedAt||hotel.checkedAt,notice:'由你自行联系酒店；本产品不代拨、不代订、不验证预约。确认状态仅是你的自行记录。'};
}
function validateConfirmation(input){
  if(!getPlace(input.id))throw new PlanningError('未找到体验');if(input.status==='clear')return null;
  if(input.status!=='self_confirmed'||input.attested!==true)throw new PlanningError('请勾选已自行向酒店确认，再保存记录');
  const service=participationFor(input.id),checks=Array.isArray(input.checks)?[...new Set(input.checks)].filter(x=>Number.isInteger(x)&&x>=0&&x<service.questions.length):[];
  if(checks.length!==service.questions.length)throw new PlanningError('请逐项核对清单；未核对完时不要标记为已确认');
  let appointment=null;
  if(input.appointment){
    if(['arrival','activities'].includes(input.id))throw new PlanningError('此体验尚无明确时长，暂不建立固定时间');
    const a=input.appointment;validatePreferences({date:a.date,start:a.start,minutes:60});const minutes=Number(a.minutes);
    if(!Number.isInteger(minutes)||minutes<10||minutes>240)throw new PlanningError('请填写10至240分钟的实际确认时长');
    const end=parseTime(a.start)+minutes;if(end>1440)throw new PlanningError('当前版本暂不支持跨日预约时段');
    appointment={date:a.date,start:a.start,end:`${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`,minutes};
  }
  return {id:input.id,status:'self_confirmed',confirmedBy:'user',confirmedAt:new Date().toISOString(),checks,notes:String(input.notes||'').slice(0,400),appointment};
}
function mergeFixedPreferences(input,state){
  const prefs=validatePreferences(input),old=state.plan,locked=old?.items?.filter(x=>x.locked)||[];
  if(locked.length&&old.preferences.date!==prefs.date)throw new PlanningError('当前安排有保留时段，更改日期前请先解除原保留。');
  const fixed=new Map(locked.map(x=>[x.id,{id:x.id,start:x.start,end:x.end,origin:x.lockOrigin}]));
  for(const c of Object.values(state.confirmations||{}))if(c.status==='self_confirmed'&&c.appointment?.date===prefs.date)fixed.set(c.id,{id:c.id,start:c.appointment.start,end:c.appointment.end,origin:'user-confirmed'});
  return {...prefs,fixedItems:[...fixed.values()]};
}

return {guideChapters:chapters,participationFor,validateConfirmation,mergeFixedPreferences};
}
export const {participationFor,validateConfirmation,mergeFixedPreferences}=createJourney(defaultCatalog);
