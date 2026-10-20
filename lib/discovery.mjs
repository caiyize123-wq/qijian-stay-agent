import {parseTime,windowsFor,shanghaiClock} from './planner.mjs';
const orders={explore:['garden','pool','tea','xia','gym','spa'],relax:['spa','tea','garden','pool','gym','xia'],food:['tea','xia','garden','pool','spa','gym'],family:['garden','pool','tea','xia','gym']};
export function rankDiscoveries(catalog,input={},completed=[]){
 const prefs=catalog.planner.validatePreferences(input),start=parseTime(prefs.start),end=Math.min(1440,start+prefs.minutes);
 const order=prefs.party==='family'?orders.family:orders[prefs.style];
 return catalog.places.filter(p=>p.id!=='arrival'&&p.category!=='outside'&&p.duration&&p.duration<=prefs.minutes&&!(p.requiresExplicitSelection&&!prefs.selected.includes(p.id))&&!(prefs.noExtraSpend&&(p.requiresCostConfirmation||['dining','wellness'].includes(p.category)))&&!(prefs.party==='family'&&(['spa','live-spa'].includes(p.id)||['spa','sport'].includes(p.kind)))).flatMap(p=>{
  const windows=windowsFor(p,prefs.date),fits=!windows?start+p.duration<=end:windows.some(([a,b])=>Math.max(a,start)+p.duration<=Math.min(b,end));if(!fits)return [];
  const index=order.indexOf(p.id),score=(index<0?({food:{dining:100,architecture:60,wellness:30,activity:40},relax:{wellness:100,dining:70,architecture:60,activity:40},explore:{architecture:100,activity:90,dining:70,wellness:60},family:{activity:110,architecture:100,wellness:80,dining:70}})[prefs.party==='family'?'family':prefs.style][p.category]||0:100-index*12)-(completed.includes(p.id)?60:0)+(prefs.party==='couple'&&p.id==='tea'?6:0);
  const intent=prefs.party==='family'?'一起发现':prefs.style==='relax'?'放松':prefs.style==='food'?'品尝风味':'探索空间';
  const reason=prefs.minutes<=30?`有${prefs.minutes}分钟，可以先看看${p.name}。`:p.id==='spa'?'想放松，可以先了解护理与泡池的选择。':p.id==='tea'?'想坐下来，一杯茶或轻食适合作为开始。':p.id==='pool'?'想换个节奏，可以先了解水边的体验。':p.id==='garden'?`${intent==='一起发现'?'一起从':'从'}${p.name}开始，留一点时间慢慢逛。`:`按你想${intent}的偏好，先认识${p.name}。`;
  return [{pointId:p.id,title:p.name,reason,score,hoursKnown:!!windows,preferences:prefs,engine:'rules',generatedAt:new Date().toISOString()}];
 }).sort((a,b)=>b.score-a.score);
}
export function chooseDiscovery(candidates,pointIds=[],intro=''){
 // The model chooses among eligible high-ranking options; rules own time/fee constraints.
 const shortlist=candidates.slice(0,3),chosen=pointIds.map(id=>shortlist.find(x=>x.pointId===id)).find(Boolean)||shortlist[0];
 if(!chosen)return null;
 return {...chosen,engine:'bailian+rules',modelReason:String(intro).slice(0,160)};
}
