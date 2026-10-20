import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {normalizeFlyaiExperience,normalizeFlyai} from '../lib/providers.mjs';
import {createHotelDirectory,createHotelSearchCache} from '../lib/hotel-directory.mjs';
import {createHotelExperienceStore,applyHotelExperiences,validateExperienceExtraction,indexedExperienceSource} from '../lib/hotel-experiences.mjs';
import {createHotelContentStore} from '../lib/hotel-content.mjs';
import {rankDiscoveries} from '../lib/discovery.mjs';
import {createAgent} from '../lib/agent.mjs';
function fixture(){
 const db=new DatabaseSync(':memory:'),directory=createHotelDirectory(db);
 const [hotel]=directory.ingest({provider:'flyai',kind:'hotel',queriedAt:'2026-10-20T03:00:00Z',items:[{id:'test-live-hotel',name:'测试海湾酒店',address:'测试路9号',brand:'测试品牌',star:'豪华型',rating:'4.8',landmark:'测试地标',image:'https://example.com/hotel.jpg',link:'https://example.com/hotel'}]},'测试市');
 const source={hotelId:hotel.id,providerId:hotel.providerId,provider:'flyai',kind:'hotel-experience',source:hotel.link,queriedAt:'2026-10-20T03:00:00Z',text:'测试海湾酒店。酒店设有中餐厅，提供本地风味。室内泳池适合游泳。健身房供住客运动。没有水疗中心。'};
 const extraction={introQuote:'酒店设有中餐厅，提供本地风味。',experiences:[{kind:'restaurant',name:'中餐厅',evidence:'酒店设有中餐厅，提供本地风味。'},{kind:'pool',name:'室内泳池',evidence:'室内泳池适合游泳。'},{kind:'gym',name:'健身房',evidence:'健身房供住客运动。'}]};
 return {db,directory,hotel,source,extraction};
}
test('FlyAI semantic response is text, not an empty hotel search result; failures reject',()=>{
 assert.equal(normalizeFlyaiExperience({status:0,data:' 酒店设施原文 '}),'酒店设施原文');
 for(const value of [{status:401,data:'x'},{status:0,data:[]},{status:0,data:'',systemMessage:null},{status:0,data:'x',systemMessage:'failed'}])assert.throws(()=>normalizeFlyaiExperience(value));
 const [h]=normalizeFlyai({status:0,data:{itemList:[{name:'测试',brandName:'品牌',star:'豪华型',rate:'4.8',interestsPoi:'海湾'}]}});assert.equal(h.brand,'品牌');assert.equal(h.rating,'4.8');assert.equal(h.star,'豪华型');assert.equal(h.landmark,'海湾');
});
test('extractor rejects wrong hotel, invented and negated evidence and deduplicates types',()=>{
 const {db,hotel,source,extraction}=fixture();assert.throws(()=>validateExperienceExtraction({...source,hotelId:'another'},extraction,hotel));
 const clean=validateExperienceExtraction(source,{...extraction,introQuote:'虚构简介',experiences:[...extraction.experiences,{kind:'spa',name:'水疗中心',evidence:'没有水疗中心。'},{kind:'space',name:'观景台',evidence:'有观景台。'},{kind:'pool',name:'室内泳池',evidence:'室内泳池适合游泳。'}]},hotel);assert.equal(clean.intro,'');assert.equal(clean.experiences.length,3);assert.ok(clean.experiences.every(x=>source.text.includes(x.evidence)));assert.throws(()=>validateExperienceExtraction(source,{experiences:[]},hotel));db.close();
});
test('live profile supports actual planning and preferences without borrowing sample facts or maps',()=>{
 const {db,directory,hotel,source,extraction}=fixture(),data=validateExperienceExtraction(source,extraction,hotel),p=applyHotelExperiences(directory.profile(hotel.id),{hotelId:hotel.id,providerId:hotel.providerId,...data,source,model:'fixture',createdAt:source.queriedAt});
 assert.equal(p.hotel.tier,'connected');assert.equal(p.hotel.brand,'测试品牌');assert.equal(p.hotel.image,'https://example.com/hotel.jpg');assert.equal(p.places.length,3);assert.equal(p.places.some(x=>x.kind==='spa'),false);const ids=Object.fromEntries(p.places.map(x=>[x.kind,x.id]));
 for(const place of p.places){assert.equal(place.windows,null);assert.equal(place.x,null);assert.equal(place.location,'具体楼层与入口尚未取得');assert.equal(place.contentVerification,'platform-ai');assert.equal(place.durationSource,'product-suggestion');}
 const prefs={date:'2026-10-24',start:'15:00',minutes:120,style:'food'};
 const plan=p.planner.createPlan(prefs);assert.ok(plan.items.length>=2);assert.ok(plan.items.every(x=>p.getPlace(x.id)));assert.equal(plan.items[0].id,ids.restaurant);assert.match(plan.explanation,/平台/);
 assert.equal(rankDiscoveries(p,prefs)[0].pointId,ids.restaurant);assert.equal(rankDiscoveries(p,{...prefs,style:'relax'})[0].pointId,ids.pool);assert.equal(p.planner.createPlan({...prefs,noExtraSpend:true}).items.length,0);
 assert.throws(()=>p.planner.route(ids.pool,ids.gym));assert.equal(p.journey.participationFor(ids.pool).tel,null);assert.equal(p.journey.participationFor(ids.pool).phone,null);
 const without=p.planner.editPlan(plan,{operation:'remove',id:plan.items[0].id});assert.deepEqual(without.items,plan.items.slice(1));db.close();
});
test('same hotel shares in-flight calls and persisted results; another hotel cannot reuse the record',async()=>{
 const {db,hotel,source,extraction,directory}=fixture();let searches=0,models=0;const steps=[];
 const store=createHotelExperienceStore(db,{search:async()=>{searches++;await new Promise(r=>setTimeout(r,10));return source;},model:async()=>{models++;return {model:'fixture',message:{content:JSON.stringify(extraction)}};}});
 const [a,b]=await Promise.all([store.ensure(hotel,s=>steps.push(s.stage)),store.ensure(hotel)]);assert.deepEqual(a,b);assert.equal(searches,1);assert.equal(models,1);assert.deepEqual(steps,['search','organize','validate']);await store.ensure(hotel);assert.equal(searches,1);
 const reopened=createHotelExperienceStore(db);assert.deepEqual(reopened.get(hotel.id),a);const other={...directory.profile(hotel.id),hotel:{...hotel,id:'other'}};assert.strictEqual(applyHotelExperiences(other,a),other);db.close();
});
test('upstream failure does not cache fake success; retry works and content withdrawal still applies',async()=>{
 const {db,hotel,source,extraction,directory}=fixture();let failure=true;
 const store=createHotelExperienceStore(db,{search:async()=>{if(failure)throw new Error('fixture failure');return source;},model:async()=>({model:'fixture',message:{content:JSON.stringify(extraction)}})});
 await assert.rejects(store.ensure(hotel));assert.equal(store.get(hotel.id),null);failure=false;await store.ensure(hotel);
 const p=store.apply(directory.profile(hotel.id)),content=createHotelContentStore(db),ids=Object.fromEntries(p.places.map(x=>[x.kind,x.id]));content.update(p,{entityId:ids.pool,expectedRevision:0,action:'pause'});const active=content.apply(p);assert.ok(!active.facts().some(x=>x.id===ids.pool));assert.equal(active.getPlace(ids.gym).contentVerification,'platform-ai');assert.ok(!active.planner.createPlan({date:'2026-10-24',start:'15:00',minutes:120}).items.some(x=>x.id===ids.pool));db.close();
});
test('multiple projects per type survive, with resort opt-in and nearby kept outside the hotel plan',()=>{
 const {db,hotel,directory,source}=fixture();source.text='测试海湾酒店。酒店内设有中餐厅、西餐厅、儿童俱乐部、室内泳池和室外泳池。所属度假区设有水上乐园和潜水。附近有海洋馆。';
 const items=[['restaurant','中餐厅','hotel'],['restaurant','西餐厅','hotel'],['family','儿童俱乐部','hotel'],['pool','室内泳池','hotel'],['pool','室外泳池','hotel'],['activity','水上乐园','resort'],['sport','潜水','resort'],['activity','海洋馆','nearby']].map(([kind,name,scope])=>({kind,name,scope,evidence:scope==='hotel'?'酒店内设有中餐厅、西餐厅、儿童俱乐部、室内泳池和室外泳池。':scope==='resort'?'所属度假区设有水上乐园和潜水。':'附近有海洋馆。'}));
 const data=validateExperienceExtraction(source,{experiences:items},hotel);assert.equal(data.experiences.length,7);assert.equal(data.related.length,1);assert.equal(new Set(data.experiences.map(x=>x.id)).size,7);assert.ok(data.coverage.groups.some(x=>x.id==='family'&&x.represented));assert.ok(data.coverage.groups.some(x=>x.id==='marine'&&!x.represented));
 const p=applyHotelExperiences(directory.profile(hotel.id),{hotelId:hotel.id,providerId:hotel.providerId,...data,source,model:'fixture'}),prefs={date:'2026-10-24',start:'14:00',minutes:120,party:'family'};
 assert.equal(p.places.some(x=>x.name==='海洋馆'),false);assert.equal(p.planner.createPlan(prefs).items.some(x=>p.getPlace(x.id).scope==='resort'),false);
 const park=p.places.find(x=>x.name==='水上乐园');assert.ok(p.planner.createPlan({...prefs,selected:[park.id]}).items.some(x=>x.id===park.id));assert.equal(p.planner.createPlan({...prefs,noExtraSpend:true,selected:[park.id]}).items.length,0);assert.equal(rankDiscoveries(p,prefs)[0].pointId,p.places.find(x=>x.kind==='family').id);db.close();
});
test('connected hotel plan uses one model call and cannot inject a new facility or move a fixed slot',async()=>{
 const {db,hotel,source,extraction,directory}=fixture(),data=validateExperienceExtraction(source,extraction,hotel),p=applyHotelExperiences(directory.profile(hotel.id),{hotelId:hotel.id,providerId:hotel.providerId,...data,source,model:'fixture'});let calls=0;
 const pool=p.places.find(x=>x.kind==='pool'),agent=createAgent(p,p.journey,p.planner,{model:async(messages,options)=>{calls++;assert.ok(messages[1].content.includes(pool.name));assert.equal(options.tools,undefined);return {model:'fixture',message:{content:JSON.stringify({intro:'按你的偏好安排，现场条件需确认。',pointIds:['invented-spa',pool.id]})}};}});
 const answer=await agent.runAgent({action:'plan',preferences:{date:'2026-10-24',start:'14:00',minutes:120,fixedItems:[{id:pool.id,start:'14:00',end:'14:45'}]}});
 assert.equal(calls,1);assert.equal(answer.modelCalls,1);assert.equal(answer.pointIds.includes('invented-spa'),false);assert.equal(answer.plan.items.find(x=>x.id===pool.id).start,'14:00');assert.equal(answer.plan.items.find(x=>x.id===pool.id).end,'14:45');assert.ok(answer.plan.items.every(x=>p.getPlace(x.id)));db.close();
});
test('different hotels respect a shared concurrency limit; duplicate readers share one task',async()=>{
 const {db,hotel,source,extraction}=fixture();let active=0,peak=0,searches=0;
 const store=createHotelExperienceStore(db,{maxActive:1,search:async h=>{searches++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,15));active--;return {...source,hotelId:h.id,providerId:h.providerId};},model:async()=>({model:'fixture',message:{content:JSON.stringify(extraction)}})});
 await Promise.all([store.ensure(hotel),store.ensure(hotel),store.ensure({...hotel,id:'other',providerId:'other'})]);assert.equal(peak,1);assert.equal(searches,2);db.close();
});
test('refresh preserves matching identities, retires removed facts and keeps historical plan data',async()=>{
 const {db,hotel,source,extraction,directory}=fixture();let next=extraction;
 const store=createHotelExperienceStore(db,{search:async()=>source,model:async()=>({model:'fixture',message:{content:JSON.stringify(next)}})});await store.ensure(hotel);const p=store.apply(directory.profile(hotel.id)),old=p.planner.createPlan({date:'2026-10-24',start:'14:00',minutes:120}),gym=p.places.find(x=>x.kind==='gym');
 next={...extraction,experiences:extraction.experiences.filter(x=>x.kind!=='gym')};const refreshed=await store.ensure(hotel,()=>{},{refresh:true}),current=createHotelContentStore(db).apply(store.apply(directory.profile(hotel.id)));
 assert.ok(refreshed.retired.some(x=>x.id===gym.id));assert.equal(current.getPlace(gym.id).duration,null);assert.ok(!current.facts().some(x=>x.id===gym.id));assert.ok(old.items.every(x=>current.getPlace(x.id)));assert.equal(current.places.find(x=>x.kind==='pool').id,p.places.find(x=>x.kind==='pool').id);db.close();
});
test('search cache reuses matching queries but expires, preserves source time and never caches errors',async()=>{
 let time=1000,calls=0,fail=false;const lookup=createHotelSearchCache({now:()=>time,ttlMs:100,maxEntries:1,search:async()=>{calls++;if(fail)throw new Error('fixture offline');await new Promise(r=>setTimeout(r,5));return {queriedAt:'source-time',items:[{id:'fixture'}]};}});
 await Promise.all([lookup({city:'厦门市',keyword:'酒店'}),lookup({city:'厦门',keyword:'酒店'})]);assert.equal(calls,1);const cached=await lookup({city:'厦门市',keyword:'酒店'});assert.equal(cached.cache.hit,true);assert.equal(cached.queriedAt,'source-time');cached.items[0].id='changed';assert.equal((await lookup({city:'厦门市',keyword:'酒店'})).items[0].id,'fixture');time=1200;await lookup({city:'厦门市',keyword:'酒店'});assert.equal(calls,2);
 fail=true;await assert.rejects(lookup({city:'上海市',keyword:'酒店'}));fail=false;await lookup({city:'上海市',keyword:'酒店'});const previous=await lookup({city:'厦门市',keyword:'酒店'});assert.equal(previous.cache.hit,false);
});
test('model failure retains upstream source; retry uses numbered evidence without querying FlyAI again',async()=>{
 const {db,hotel,source}=fixture();let searches=0,models=0;const store=createHotelExperienceStore(db,{search:async()=>{searches++;return source;},model:async messages=>{models++;if(models===1)throw new Error('fixture timeout');const {segments}=JSON.parse(messages[1].content),segment=segments.find(x=>x.text.includes('室内泳池'));return {model:'fixture',message:{content:JSON.stringify({experiences:[{kind:'pool',name:'室内泳池',segmentId:segment.id,scope:'hotel'},{kind:'spa',name:'虚构项目',segmentId:99999}]})}};}});
 await assert.rejects(store.ensure(hotel));assert.equal(store.get(hotel.id),null);const record=await store.ensure(hotel);assert.equal(searches,1);assert.equal(models,2);assert.equal(record.timingMs.sourceCacheHit,true);assert.equal(record.experiences.length,1);assert.ok(source.text.includes(record.experiences[0].evidence));db.close();
});
test('bounded import queue rejects overflow and times out without blocking the active hotel',async()=>{
 const {db,hotel,source,extraction}=fixture();let unblock;const blocked=new Promise(r=>unblock=r),store=createHotelExperienceStore(db,{maxActive:1,maxQueued:1,queueTimeoutMs:10,search:async h=>{await blocked;return {...source,hotelId:h.id,providerId:h.providerId};},model:async()=>({model:'fixture',message:{content:JSON.stringify(extraction)}})});
 const first=store.ensure(hotel),second=assert.rejects(store.ensure({...hotel,id:'queued',providerId:'queued'}),e=>e.code==='EXPERIENCE_QUEUE_TIMEOUT');await assert.rejects(store.ensure({...hotel,id:'overflow',providerId:'overflow'}),e=>e.code==='EXPERIENCE_BUSY');await second;unblock();await first;assert.ok(store.get(hotel.id));assert.equal(store.get('queued'),null);db.close();
});
test('long nearby descriptions are removed from hotel-model input and retained as separate source clues',()=>{
 const source='## 酒店内\n- 餐厅、儿童俱乐部。\n## 度假区内（酒店周边POI，非酒店设施）\n**[附近主题乐园](https://example.com/park)**\n- 这里有很多周边游乐设施。\n**[夜行馆](https://example.com/closed)**（暂停开放）\n## 未查到或未列\n泳池未返回。';
 const result=indexedExperienceSource(source);assert.ok(result.segments.some(s=>s.text.includes('儿童俱乐部')));assert.equal(result.segments.some(s=>s.text.includes('周边游乐设施')),false);assert.equal(result.related.length,1);assert.equal(result.related[0].name,'附近主题乐园');assert.ok(source.includes(result.related[0].evidence));assert.equal(result.segments.some(s=>s.text.includes('泳池未返回')),false);
});
test('a show without a schedule is visible but only enters planning after a self-reported confirmed time',()=>{
 const {db,hotel,source,directory}=fixture();source.text='测试海湾酒店设有综合演艺表演。';const data=validateExperienceExtraction(source,{experiences:[{name:'综合演艺表演',kind:'culture',evidence:source.text,scope:'hotel'}]},hotel),p=applyHotelExperiences(directory.profile(hotel.id),{hotelId:hotel.id,providerId:hotel.providerId,...data,source,model:'fixture'}),show=p.places[0],prefs={date:'2026-10-24',start:'14:00',minutes:120,selected:[show.id]};
 assert.equal(show.scheduleRequired,true);assert.equal(p.planner.createPlan(prefs).items.length,0);const questions=p.journey.participationFor(show.id).questions;
 const confirmed=p.journey.validateConfirmation({id:show.id,status:'self_confirmed',attested:true,checks:questions.map((_,i)=>i),appointment:{date:prefs.date,start:'14:30',minutes:45}});
 const plan=p.planner.createPlan(p.journey.mergeFixedPreferences(prefs,{confirmations:{[show.id]:confirmed}}));assert.equal(plan.items[0].start,'14:30');assert.equal(plan.items[0].end,'15:15');assert.equal(plan.items[0].lockOrigin,'user-confirmed');db.close();
});
test('explicit hotel section overrides model resort guesses, including reading an older cached result',async()=>{
 const {db,hotel,source,directory}=fixture();source.text='测试海湾酒店\n**酒店内休闲设施与项目清单**\n- 儿童俱乐部';
 const store=createHotelExperienceStore(db,{search:async()=>source,model:async messages=>{const {segments}=JSON.parse(messages[1].content),item=segments.find(x=>x.text.includes('儿童俱乐部'));return {model:'fixture',message:{content:JSON.stringify({items:[['儿童俱乐部','family',item.id,'resort']]})}};}});
 const record=await store.ensure(hotel);assert.equal(record.experiences[0].scope,'hotel');record.experiences[0].scope='resort';db.prepare('UPDATE hotel_experiences SET content=? WHERE hotel_id=?').run(JSON.stringify(record),hotel.id);assert.equal(store.get(hotel.id).experiences[0].scope,'hotel');const p=store.apply(directory.profile(hotel.id));assert.equal(p.planner.createPlan({date:'2026-10-24',start:'14:00',minutes:120,party:'family'}).items[0].id,p.places[0].id);db.close();
});
