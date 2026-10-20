import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {getHotelProfile,listHotels,defaultHotelId,stayKey,withOuting,buildHotelProfile} from './lib/hotels.mjs';
import { shanghaiClock,PlanningError } from './lib/planner.mjs';
import {rankDiscoveries} from './lib/discovery.mjs';
import {selectOuting} from './lib/outing.mjs';
import {createHotelDirectory,validateHotelSearch,createHotelSearchCache} from './lib/hotel-directory.mjs';
import {createHotelContentStore} from './lib/hotel-content.mjs';
import {createHotelExperienceStore} from './lib/hotel-experiences.mjs';
import { status,bailian,flyai,ServiceError } from './lib/providers.mjs';
const root=fileURLToPath(new URL('./',import.meta.url)),dist=path.join(root,'dist');
const dbFile=process.env.STAY_DB_PATH||path.join(root,'data','stay.sqlite');
fs.mkdirSync(path.dirname(dbFile),{recursive:true});
const db=new DatabaseSync(dbFile);
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS stays (id TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL)');
const load=db.prepare('SELECT content FROM stays WHERE id=?');
const save=db.prepare('INSERT INTO stays VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at');
const directory=createHotelDirectory(db),contentStore=createHotelContentStore(db),experienceStore=createHotelExperienceStore(db);
const searchHotels=createHotelSearchCache();
const rawProfile=id=>{const sample=getHotelProfile(id);if(sample){const image=directory.imageForDeep(id);return image?buildHotelProfile({hotel:{...sample.hotel,...image},places:sample.places},sample.journey.guideChapters):sample;}const basic=directory.profile(id);return basic?experienceStore.apply(basic):null;};
const port=Number(process.env.PORT||4381),host='127.0.0.1';
const inFlight=new Map(),connectionChecks=new Map();
const send=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
function sid(req,res){const raw=(req.headers.cookie||'').match(/(?:^|; )stay_sid=([a-f\d-]{36})(?:;|$)/i)?.[1];const id=raw||randomUUID();if(!raw)res.setHeader('Set-Cookie',`stay_sid=${id}; HttpOnly; SameSite=Strict; Path=/`);return id;}
function getState(id){try{
  const state=JSON.parse(load.get(id)?.content||'{}');
  // Read-compatible cleanup of the early prototype; preserve all other saved items and times.
  if(state.plan?.items?.some(x=>x.id==='arrival')){
    state.plan.items=state.plan.items.filter(x=>x.id!=='arrival');
    state.plan.preferences.selected=(state.plan.preferences.selected||[]).filter(x=>x!=='arrival');
  }
  return state;
}catch{return {};}}
function setState(id,value){save.run(id,JSON.stringify(value),new Date().toISOString());}
async function body(req){if(!(req.headers['content-type']||'').startsWith('application/json'))throw new ServiceError('CONTENT_TYPE','请使用JSON请求',415);let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>20000)throw new ServiceError('TOO_LARGE','请求内容过长',413);}try{return JSON.parse(raw||'{}');}catch{throw new ServiceError('BAD_JSON','请求格式无效',400);}}
function cleanState(input,profile){
  const {getPlace,planner:{validatePreferences},journey:{guideChapters}}=profile;
  const favorites=Array.isArray(input.favorites)?[...new Set(input.favorites)].filter(x=>!!getPlace(x)).slice(0,20):[];
  const completed=Array.isArray(input.completed)?[...new Set(input.completed)].filter(x=>!!getPlace(x)).slice(0,20):[];
  const location=getPlace(input.location)?input.location:'arrival';
  const journey={chapterId:guideChapters.some(x=>x.id===input.journey?.chapterId)?input.journey.chapterId:guideChapters[0]?.id||'',
    seen:Array.isArray(input.journey?.seen)?[...new Set(input.journey.seen)].filter(id=>guideChapters.some(x=>x.id===id)):[],paused:input.journey?.paused===true,manual:input.journey?.manual===true};
  return {favorites,completed,location,journey,preferences:validatePreferences(input.preferences||{})};
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
  const url=new URL(req.url,'http://127.0.0.1');
  try{
    if(req.headers.host&&!['127.0.0.1','localhost'].includes(req.headers.host.split(':')[0]))throw new ServiceError('HOST','本地服务仅支持本机访问',403);
    if(!['GET','HEAD'].includes(req.method)&&req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))throw new ServiceError('ORIGIN','不接受其他站点的写入请求',403);
    const sessionId=sid(req,res);
    const hotelId=req.headers['x-stay-hotel']||url.searchParams.get('hotel')||defaultHotelId;
    const originalProfile=rawProfile(hotelId);const baseProfile=originalProfile?contentStore.apply(originalProfile):null;if(!baseProfile)throw new ServiceError('UNKNOWN_HOTEL','这家酒店尚未接入',404);
    const id=stayKey(sessionId,hotelId);
    const profile=withOuting(baseProfile,getState(id).outing);
    const {hotel,places,categories,getPlace}=profile;
    const {route,createPlan,validatePreferences,editPlan,alternativesFor}=profile.planner;
    const {guideChapters,participationFor,validateConfirmation,mergeFixedPreferences}=profile.journey;
    const {runAgent}=profile.agent;
    if(url.pathname==='/api/hotel-search'&&req.method==='POST'){
      const search=validateHotelSearch(await body(req));const result=await searchHotels(search);
      return send(res,200,{city:search.city,keyword:search.keyword,queriedAt:result.queriedAt,cache:result.cache,items:directory.ingest(result,search.city).map(x=>({...x,tier:x.tier==='deep'?'deep':experienceStore.get(x.id)?'connected':'basic'}))});
    }
    if(url.pathname==='/api/hotel-enrich'&&req.method==='POST'){
      const input=await body(req);const entry=directory.get(hotelId);if(!entry)throw new ServiceError('NO_DIRECTORY','请选择搜索结果中的酒店',400);
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive'});
      const event=(type,data)=>{if(!res.destroyed)res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);};
      try{const record=await experienceStore.ensure(entry,step=>event('progress',step),{refresh:input.refresh===true});event('result',{hotelId,count:record.experiences.length,engine:'flyai+bailian',createdAt:record.createdAt,timingMs:record.timingMs||null,coverage:record.coverage||null});}
      catch(error){event('error',{error:error instanceof ServiceError?error.message:'酒店体验资料未能整理完成，请重试。',code:error.code||'EXPERIENCE_ERROR'});}
      finally{res.end();}return;
    }
    if(url.pathname==='/api/hotel-evidence'&&req.method==='GET'){
      const record=experienceStore.get(hotelId);if(!record)throw new ServiceError('NO_EVIDENCE','这家酒店尚未取得体验资料',404);
      return send(res,200,{hotelId,providerId:record.providerId,provider:'flyai',query:record.source.query,text:record.source.text,source:record.source.source,queriedAt:record.source.queriedAt,model:record.model,experiences:record.experiences,related:record.related||[],coverage:record.coverage||null,timingMs:record.timingMs||null,notice:'平台AI搜索原文及摘录，不代表酒店人工确认。'});
    }
    if(url.pathname==='/api/content/hotels'&&req.method==='GET'){
      const hotels=[...listHotels().map(h=>({...h,tier:'deep'})),...directory.list().filter(h=>!h.linkedDeepId).map(h=>({id:h.id,name:h.name,city:h.city,tier:experienceStore.get(h.id)?'connected':'basic'}))];return send(res,200,{hotels});
    }
    if(url.pathname==='/api/content'&&req.method==='GET'){
      const p=rawProfile(url.searchParams.get('hotelId')||hotelId);if(!p)throw new ServiceError('UNKNOWN_HOTEL','未找到酒店',404);
      return send(res,200,{hotel:p.hotel,records:contentStore.records(p)});
    }
    if(url.pathname==='/api/content'&&req.method==='POST'){
      const input=await body(req),p=rawProfile(String(input.hotelId||''));if(!p)throw new ServiceError('UNKNOWN_HOTEL','未找到酒店',404);return send(res,200,contentStore.update(p,input));
    }
    if(hotel.tier==='basic'&&['/api/discovery','/api/route','/api/outing','/api/confirmations'].some(p=>url.pathname===p)||hotel.tier==='basic'&&url.pathname.startsWith('/api/plan/'))throw new ServiceError('BASIC_ONLY','这家酒店当前提供基础资料与周边探索，尚未接入内部体验规划',422);
    if(url.pathname==='/api/hotels'&&req.method==='GET')return send(res,200,{hotels:listHotels()});
    if(url.pathname==='/api/boot'&&req.method==='GET'){
      const state=getState(id),clock=shanghaiClock();const preferences={date:clock.date,start:clock.time,...state.preferences};
      if(preferences.date<clock.date){preferences.date=clock.date;preferences.start=clock.time;}
      const discovery=hotel.tier==='basic'?null:rankDiscoveries(profile,preferences,state.completed||[])[0]||null;
      return send(res,200,{hotel,hotels:listHotels(),places,categories,guideChapters,participation:Object.fromEntries(places.filter(p=>p.category!=='outside'&&!['paused','expired'].includes(p.contentState)).map(p=>[p.id,participationFor(p.id)])),clock,connections:status(),state,discovery});
    }
    if(url.pathname==='/api/discovery'&&req.method==='POST'){
      const input=await body(req);return send(res,200,{discovery:rankDiscoveries(profile,input.preferences||{},getState(id).completed||[])[0]||null});
    }
    if(url.pathname==='/api/outing'&&req.method==='POST'){
      if(inFlight.get(id)?.action==='plan')throw new PlanningError('正在生成安排，请完成后再调整外出');
      const input=await body(req),old=getState(id);
      if(old.plan?.items.some(x=>x.id==='outside'&&x.locked))throw new PlanningError('请先解除外出时段保留，再调整地点或预留时间');
      const outing=input.clear===true?null:selectOuting(input,old.nearby,hotelId);
      let plan=old.plan;if(plan?.items.some(x=>x.id==='outside'))plan=editPlan(plan,{operation:'remove',id:'outside'});
      const preferences={...old.preferences,includeOutside:!!outing};
      setState(id,{...old,outing,plan,preferences,favorites:(old.favorites||[]).filter(x=>x!=='outside'),completed:(old.completed||[]).filter(x=>x!=='outside')});
      const updated=withOuting(baseProfile,outing);return send(res,200,{outing,place:updated.getPlace('outside')||null,plan,preferences});
    }
    if(url.pathname==='/api/health'&&req.method==='GET')return send(res,200,{ok:true,connections:status(),now:new Date().toISOString()});
    if(url.pathname==='/api/state'&&req.method==='PUT'){
      const input=cleanState(await body(req),profile);const old=getState(id);setState(id,{...old,...input});return send(res,200,{saved:true});
    }
    if(url.pathname==='/api/route'&&req.method==='POST'){const input=await body(req);return send(res,200,route(input.from,input.to));}
    if(url.pathname==='/api/plan/rules'&&req.method==='POST'){
      const input=await body(req);const plan=createPlan(mergeFixedPreferences(input,getState(id)));setState(id,{...getState(id),plan});return send(res,200,plan);
    }
    if(url.pathname==='/api/plan/alternatives'&&req.method==='GET'){
      const old=getState(id);if(!old.plan)throw new PlanningError('请先生成一份安排');return send(res,200,{items:alternativesFor(old.plan,url.searchParams.get('id'))});
    }
    if(url.pathname==='/api/confirmations'&&req.method==='POST'){
      if(inFlight.get(id)?.action==='plan')throw new ServiceError('BUSY','正在规划，请完成后再修改已确定事项。',409);
      const input=await body(req),record=validateConfirmation(input),old=getState(id),confirmations={...(old.confirmations||{})};
      if(record)confirmations[input.id]=record;else delete confirmations[input.id];
      let plan=old.plan;
      // Removing a self-reported appointment releases only its derived anchor, not other user locks.
      if(plan?.items.some(x=>x.id===input.id&&x.lockOrigin==='user-confirmed')){
        plan=structuredClone(plan);const item=plan.items.find(x=>x.id===input.id);item.locked=false;item.lockOrigin=null;
        plan.preferences.fixedItems=(plan.preferences.fixedItems||[]).filter(x=>x.id!==input.id);
      }
      setState(id,{...old,plan,confirmations});return send(res,200,{confirmations,plan});
    }
    if(url.pathname==='/api/plan/edit'&&req.method==='POST'){
      if(inFlight.get(id)?.action==='plan')throw new ServiceError('BUSY','正在生成安排，请完成后再修改。',409);
      const input=await body(req),old=getState(id);if(!old.plan)throw new ServiceError('NO_PLAN','还没有保存的安排',400);
      if(input.operation==='lock'&&input.locked!==true&&old.plan.items.some(x=>x.id===input.id&&x.lockOrigin==='user-confirmed'))throw new PlanningError('这是你自行记录的确认时间，请在参与记录中修改或清除。');
      const candidate=editPlan(old.plan,input);
      setState(id,{...old,plan:candidate,preferences:{...old.preferences,includeOutside:candidate.preferences.includeOutside}});return send(res,200,candidate);
    }
    if(url.pathname==='/api/agent'&&req.method==='POST'){
      const input=await body(req);if(hotel.tier==='basic'&&!['nearby','hotel','ask'].includes(input.action))throw new ServiceError('BASIC_ONLY','这家酒店尚未接入内部体验',422);if(input.preferences)input.preferences=input.action==='plan'?mergeFixedPreferences(input.preferences,getState(id)):validatePreferences(input.preferences);
      if(String(input.text||'').length>1500)throw new ServiceError('TEXT_TOO_LONG','请把需求控制在1500字以内',400);
      const previous=inFlight.get(id);
      if(previous){if(['discover','guide'].includes(previous.action))previous.controller.abort();else throw new ServiceError('BUSY','上一次整理还在进行，请稍候。',429);}
      const job={action:input.action||'discover',controller:new AbortController()};
      inFlight.set(id,job);res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive'});
      res.on('close',()=>{if(!res.writableEnded)job.controller.abort();});
      const event=(type,data)=>{if(!res.destroyed)res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);};
      try{
        const answer=await runAgent(input,step=>event('progress',step),job.controller.signal);
        if(answer.plan)setState(id,{...getState(id),plan:answer.plan});
        if(answer.liveResult?.kind==='nearby')setState(id,{...getState(id),nearby:{...answer.liveResult,hotelId}});
        event('result',answer);
      }catch(error){event('error',{error:error instanceof ServiceError||error instanceof PlanningError?error.message:'本次整理未完成，请重试。',code:error.code||'AGENT_ERROR'});}
      finally{if(inFlight.get(id)===job)inFlight.delete(id);res.end();}return;
    }
    if(url.pathname==='/api/connections/test'&&req.method==='POST'){
      await body(req);
      if(!connectionChecks.has(hotelId))connectionChecks.set(hotelId,Promise.allSettled([
        bailian([{role:'user',content:'只回复：连接成功'}],{max_tokens:20}),flyai('hotel',hotel.keyword,undefined,{city:hotel.city,matchName:hotel.name})
      ]).then(results=>({connections:status(),results:results.map((r,i)=>({provider:i===0?'bailian':'flyai',ok:r.status==='fulfilled',...(r.status==='fulfilled'?(i===0?{model:r.value.model,ms:r.value.ms}:{count:r.value.items.length,ms:r.value.ms,items:r.value.items}):{error:r.reason.message})}))})).finally(()=>{connectionChecks.delete(hotelId);}));
      return send(res,200,await connectionChecks.get(hotelId));
    }
    if(url.pathname==='/api/flyai'&&req.method==='POST'){const input=await body(req);const result=await flyai(input.kind==='nearby'?'nearby':'hotel',String(input.keyword||(input.kind==='nearby'?hotel.nearbyKeyword:hotel.keyword)),undefined,{city:hotel.city,matchName:hotel.name});if(result.kind==='nearby')setState(id,{...getState(id),nearby:{...result,hotelId}});return send(res,200,result);}
    if(url.pathname==='/api/export'&&req.method==='GET'){
      const state=getState(id);res.setHeader('Content-Disposition','attachment; filename="stay-plan.json"');return send(res,200,{hotel,plan:state.plan||null,favorites:state.favorites||[],journey:state.journey||null,confirmations:state.confirmations||{},preferences:state.preferences||{},outing:state.outing||null,notice:hotel.mapNotice,exportedAt:new Date().toISOString()});
    }
    if(url.pathname.startsWith('/api/'))throw new ServiceError('NOT_FOUND','未找到此功能',404);
    if(!['GET','HEAD'].includes(req.method))throw new ServiceError('METHOD','不支持此操作',405);
    let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{throw new ServiceError('PATH','地址无效',400);}
    const file=path.resolve(dist,'.'+(pathname==='/'?'/index.html':pathname==='/manage'?'/manage.html':pathname));
    if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())throw new ServiceError('NOT_FOUND','页面不存在',404);
    const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');
    if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
  }catch(error){if(!res.headersSent)send(res,error.status||500,{error:error instanceof ServiceError||error instanceof PlanningError?error.message:'本地服务处理失败，请重试。',code:error.code||'SERVER_ERROR'});else res.end();}
});
server.listen(port,host,()=>console.log(`Stay Within is ready: http://${host}:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
