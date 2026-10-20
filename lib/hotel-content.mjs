import {ServiceError,safeUrl} from './providers.mjs';
import {shanghaiClock,parseTime} from './planner.mjs';
import {buildHotelProfile} from './hotels.mjs';
const fail=(message,code='CONTENT_INPUT',status=400)=>{throw new ServiceError(code,message,status);};
const isDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function parseContentHours(text){
 if(!String(text||'').trim())fail('请填写营业时段，或选择尚无具体时段');
 return String(text).split(/[;,；，]/).map(part=>{const m=part.trim().match(/^(\d{2}:\d{2})\s*[-—~～]\s*(\d{2}:\d{2})$/);if(!m)fail('时段格式如 10:00-22:00，多段用分号分隔');const a=parseTime(m[1]),b=parseTime(m[2],true);if(b<=a)fail('结束时间须晚于开始时间');return [a,b];}).slice(0,6);
}
function cleanDraft(input={}){
 const out={};for(const key of ['intro','story','location','fee','booking','sourceUrl','evidenceText','checkedAt','validUntil','hoursText'])out[key]=String(input[key]||'').trim();
 for(const [k,v] of Object.entries(out))if(v.length>(['story','evidenceText'].includes(k)?4000:1200))fail('资料过长，请精简后保存');
 out.hoursMode=['keep','unknown','set'].includes(input.hoursMode)?input.hoursMode:'keep';
 if(out.sourceUrl){const u=safeUrl(out.sourceUrl);if(!u||new URL(u).username||new URL(u).password)fail('来源请填写不含凭据的 HTTPS 链接');out.sourceUrl=u;}
 return out;
}
export function validatePublication(draft,base,attested,today=shanghaiClock().date){
 const d=cleanDraft(draft);if(attested!==true)fail('请确认已阅读来源并核对本条资料');
 if(!d.sourceUrl||!d.evidenceText||!d.intro)fail('发布需要简介、来源链接和原文依据');
 if(!isDate(d.checkedAt)||d.checkedAt>today)fail('核对日期须为有效日期，且不能晚于今天');
 if(d.validUntil&&(!isDate(d.validUntil)||d.validUntil<d.checkedAt||d.validUntil<today))fail('适用截止日期不能早于今天或核对日期');
 const windows=d.hoursMode==='set'?parseContentHours(d.hoursText):d.hoursMode==='unknown'?null:base.windows;
 if(windows&&!d.validUntil)fail('含营业时段的资料，请填写适用截止日期');
 return {...d,windows:windows??null,reviewedAt:new Date().toISOString(),reviewType:'operator-attested'};
}
export function createHotelContentStore(db){
 db.exec('CREATE TABLE IF NOT EXISTS hotel_content (hotel_id TEXT, entity_id TEXT, content TEXT NOT NULL, PRIMARY KEY(hotel_id,entity_id)); CREATE TABLE IF NOT EXISTS hotel_content_history (id INTEGER PRIMARY KEY AUTOINCREMENT, hotel_id TEXT, entity_id TEXT, revision INTEGER, action TEXT, content TEXT, created_at TEXT)');
 const read=db.prepare('SELECT content FROM hotel_content WHERE hotel_id=? AND entity_id=?');
 function get(hotelId,entityId){const r=read.get(hotelId,entityId);return r?JSON.parse(r.content):{hotelId,entityId,revision:0,visibility:'visible',published:null,draft:null};}
 function baseFor(profile,entityId){
  if(entityId==='hotel')return {id:'hotel',name:profile.hotel.name,intro:profile.hotel.description||'',story:'',location:profile.hotel.address||'',fee:'',booking:'',source:profile.hotel.source,windows:null,checkedAt:profile.hotel.checkedAt};
  const p=profile.getPlace(entityId);if(!p||p.id==='arrival'||p.category==='outside')fail('此资料条目不存在');return {...p,checkedAt:p.sourceCheckedAt||profile.hotel.checkedAt};
 }
 function describe(profile,entityId){const base=baseFor(profile,entityId),r=get(profile.hotel.id,entityId),today=shanghaiClock().date;
  return {...r,base,presentation:r.visibility==='paused'?'paused':r.published?.validUntil&&r.published.validUntil<today?'expired':'visible',verification:r.published?'operator-attested':base.contentVerification||'source-linked',history:db.prepare('SELECT revision,action,created_at FROM hotel_content_history WHERE hotel_id=? AND entity_id=? ORDER BY id DESC LIMIT 12').all(profile.hotel.id,entityId)};
 }
 function update(profile,input){
  const entityId=String(input.entityId||''),base=baseFor(profile,entityId),old=get(profile.hotel.id,entityId);
  if(!Number.isInteger(input.expectedRevision)||input.expectedRevision!==old.revision)fail('资料已被其他窗口更新，请重新载入后编辑','CONTENT_CONFLICT',409);
  const next=structuredClone(old),action=input.action;
  if(action==='save-draft')next.draft=cleanDraft(input.draft);
  else if(action==='discard-draft')next.draft=null;
  else if(action==='publish'){if(!old.draft)fail('请先保存资料草稿');next.published=validatePublication(old.draft,base,input.attested);next.draft=null;next.visibility='visible';}
  else if(action==='pause')next.visibility='paused';
  else if(action==='resume'){if(old.published?.validUntil&&old.published.validUntil<shanghaiClock().date)fail('资料已过期，请核对并重新发布后展示');next.visibility='visible';}
  else fail('不支持的资料操作');
  next.revision++;next.updatedAt=new Date().toISOString();
  db.exec('BEGIN');try{db.prepare('INSERT INTO hotel_content VALUES(?,?,?) ON CONFLICT(hotel_id,entity_id) DO UPDATE SET content=excluded.content').run(profile.hotel.id,entityId,JSON.stringify(next));db.prepare('INSERT INTO hotel_content_history(hotel_id,entity_id,revision,action,content,created_at) VALUES(?,?,?,?,?,?)').run(profile.hotel.id,entityId,next.revision,action,JSON.stringify(next),next.updatedAt);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  return describe(profile,entityId);
 }
 function records(profile){return [describe(profile,'hotel'),...profile.places.filter(p=>p.id!=='arrival'&&p.category!=='outside').map(p=>describe(profile,p.id))];}
 function apply(profile){
  const hotelRecord=describe(profile,'hotel'),hotel={...profile.hotel,contentRevision:hotelRecord.revision};
  if(hotelRecord.presentation==='visible'&&hotelRecord.published){hotel.description=hotelRecord.published.intro;hotel.descriptionSource=hotelRecord.published.sourceUrl;hotel.descriptionCheckedAt=hotelRecord.published.checkedAt;hotel.descriptionEvidence=hotelRecord.published.evidenceText;}
  const places=profile.places.map(p=>{if(p.id==='arrival')return p;const r=describe(profile,p.id);if(r.presentation!=='visible')return {...p,contentState:r.presentation,duration:null,windows:null,intro:'这项体验暂不展示。',story:'',prompt:'',location:'',fee:'',booking:''};
   if(!r.published)return {...p,contentState:p.contentState||'visible',contentVerification:p.contentVerification||'source-linked'};
   const d=r.published;return {...p,intro:d.intro,story:d.story,location:d.location,fee:d.fee,booking:d.booking,windows:d.windows,source:d.sourceUrl,sourceLabel:'人工核对资料',sourceCheckedAt:d.checkedAt,sourceEvidence:d.evidenceText,validUntil:d.validUntil,contentState:'visible',contentVerification:'operator-attested'};
  });
  const chapters=profile.journey.guideChapters.filter(c=>places.some(p=>p.id===c.pointId&&p.contentState!=='paused'&&p.contentState!=='expired')).map(c=>{const p=places.find(p=>p.id===c.pointId);return {...c,...(p.contentVerification==='operator-attested'?{fact:p.story||p.intro,source:p.source}:{}),next:c.next.filter(id=>places.some(p=>p.id===id&&!['paused','expired'].includes(p.contentState)))};});
  return buildHotelProfile({hotel,places},chapters);
 }
 return {get,describe,update,records,apply};
}
