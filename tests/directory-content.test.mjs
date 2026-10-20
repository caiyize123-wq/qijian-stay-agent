import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHotelDirectory,validateHotelSearch,matchDeepHotel} from '../lib/hotel-directory.mjs';
import {createHotelContentStore,validatePublication,parseContentHours} from '../lib/hotel-content.mjs';
import {getHotelProfile} from '../lib/hotels.mjs';
import {shanghaiClock} from '../lib/planner.mjs';
const profile=getHotelProfile(),today=shanghaiClock().date,tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const draft={intro:'仅供测试的已核对简介',story:'仅供测试的内容，不能作为酒店运营信息。',location:'测试位置',fee:'请咨询酒店',booking:'请咨询酒店',sourceUrl:'https://lohkahhotels.com/about-1.html',evidenceText:'自动化测试原文依据，不用于生产发布。',checkedAt:today,validUntil:tomorrow,hoursMode:'keep'};
const result=items=>({provider:'flyai',kind:'hotel',queriedAt:new Date().toISOString(),items});
function setup(){const db=new DatabaseSync(':memory:');return {db,directory:createHotelDirectory(db),store:createHotelContentStore(db)};}
test('search requires city and keyword; command-like text is still passed as data',()=>{assert.throws(()=>validateHotelSearch({city:'',keyword:'hotel'}));assert.deepEqual(validateHotelSearch({city:'上海市',keyword:' a;$(b) '}),{city:'上海市',keyword:'a;$(b)'});});
test('a deep hotel keeps its matched platform overview image across an image-less refresh without lending it to a branch',()=>{
 const {db,directory}=setup(),h=getHotelProfile('andaz-xiamen').hotel;
 const item={id:'andaz-image-fixture',name:h.name,address:h.address,image:'https://example.com/andaz-overview.jpg',link:'https://example.com/hotel'};
 const [first]=directory.ingest(result([item]),h.city);assert.equal(first.openHotelId,h.id);assert.equal(directory.imageForDeep(h.id).image,item.image);
 const [next]=directory.ingest(result([{...item,image:null}]),h.city);assert.equal(next.image,item.image);assert.equal(directory.imageForDeep('lohkah-xiamen'),null);
 const [branch]=directory.ingest(result([{...item,id:'andaz-branch',name:h.name+'分店',address:'另一条路9号',image:'https://example.com/other.jpg'}]),h.city);assert.notEqual(branch.openHotelId,h.id);assert.equal(directory.imageForDeep(h.id).image,item.image);db.close();
});
test('deep match requires exact name, city and street address',()=>{
 const h=profile.hotel;assert.equal(matchDeepHotel({name:h.name,address:'中国福建省'+h.address},'厦门',[h]),h.id);
 for(const change of [{name:'鼓浪屿七尚榕舍'},{address:''},{address:'槟城道999号'}])assert.equal(matchDeepHotel({name:h.name,address:h.address,...change},'厦门市',[h]),null);
 assert.equal(matchDeepHotel({name:h.name,address:h.address},'上海市',[h]),null);
});
test('directory preserves platform ID and source; basic profile has no invented facilities',()=>{
 const {db,directory}=setup();const [entry]=directory.ingest(result([{id:'fixture-1',name:'测试酒店',address:'测试路1号',description:'平台测试简介',link:'https://www.fliggy.com/'}]),'上海市');
 const p=directory.profile(entry.id);assert.equal(p.hotel.tier,'basic');assert.equal(p.hotel.providerId,'fixture-1');assert.equal(p.hotel.city,'上海市');assert.deepEqual(p.places,[]);assert.deepEqual(p.journey.guideChapters,[]);assert.equal(p.hotel.phone,null);assert.ok(p.hotel.source.startsWith('https://'));db.close();
});
test('same provider ID with changed identity cannot silently replace a hotel',()=>{
 const {db,directory}=setup();const [first]=directory.ingest(result([{id:'same-id',name:'甲酒店',address:'甲路1号'}]),'厦门市');const [other]=directory.ingest(result([{id:'same-id',name:'乙酒店',address:'乙路2号'}]),'上海市');assert.equal(other.identityConflict,true);assert.equal(other.id,null);assert.equal(directory.get(first.id).name,'甲酒店');db.close();
});
test('matching deep sample does not merge same-brand branch hotel',()=>{
 const {db,directory}=setup();const results=directory.ingest(result([{id:'a',name:profile.hotel.name,address:profile.hotel.address},{id:'b',name:'鼓浪屿七尚榕舍',address:'兴化路9号'}]),'厦门市');assert.equal(results[0].openHotelId,profile.hotel.id);assert.equal(results[0].tier,'deep');assert.equal(results[1].tier,'basic');assert.notEqual(results[1].openHotelId,profile.hotel.id);db.close();
});
test('draft does not alter public data; publication requires proof and attestation',()=>{
 const {db,store}=setup(),old=profile.getPlace('tea').intro;let r=store.update(profile,{entityId:'tea',expectedRevision:0,action:'save-draft',draft});assert.equal(store.apply(profile).getPlace('tea').intro,old);
 assert.throws(()=>store.update(profile,{entityId:'tea',expectedRevision:r.revision,action:'publish',attested:false}));r=store.update(profile,{entityId:'tea',expectedRevision:r.revision,action:'publish',attested:true});assert.equal(store.apply(profile).getPlace('tea').intro,draft.intro);assert.equal(store.apply(profile).getPlace('tea').sourceCheckedAt,today);assert.equal(r.verification,'operator-attested');assert.equal(profile.getPlace('tea').intro,old);assert.equal(r.history.length,2);db.close();
});
test('invalid sources, missing evidence, future checking dates and missing hours validity fail',()=>{
 const base=profile.getPlace('tea');for(const change of [{sourceUrl:'javascript:alert(1)'},{sourceUrl:'https://user:pass@example.com'},{evidenceText:''},{checkedAt:'2999-01-01'},{validUntil:''},{validUntil:'2000-01-01'}])assert.throws(()=>validatePublication({...draft,...change},base,true));
 assert.deepEqual(parseContentHours('10:00-14:00;17:00-22:00'),[[600,840],[1020,1320]]);assert.throws(()=>parseContentHours('22:00-10:00'));
});
test('revisions prevent stale editor writes',()=>{
 const {db,store}=setup();store.update(profile,{entityId:'tea',expectedRevision:0,action:'save-draft',draft});assert.throws(()=>store.update(profile,{entityId:'tea',expectedRevision:0,action:'pause'}),e=>e.status===409);db.close();
});
test('pause removes a place from recommendations, facts, chapters and new plans without mutating saved plans',()=>{
 const {db,store}=setup(),saved=profile.planner.createPlan({date:today,start:'15:00',minutes:120,selected:['garden']},{selectedOnly:true}),snapshot=structuredClone(saved);
 store.update(profile,{entityId:'garden',expectedRevision:0,action:'pause'});const p=store.apply(profile);assert.equal(p.getPlace('garden').duration,null);assert.ok(!p.facts().some(x=>x.id==='garden'));assert.ok(!p.journey.guideChapters.some(x=>x.pointId==='garden'));assert.equal(p.planner.createPlan({date:today,start:'15:00',minutes:120,selected:['garden']},{selectedOnly:true}).items.length,0);assert.deepEqual(saved,snapshot);assert.throws(()=>p.planner.route('arrival','garden'));db.close();
});
test('expired reviewed content is withdrawn and cannot be resumed without re-publication',()=>{
 const {db,store}=setup();const expired={hotelId:profile.hotel.id,entityId:'tea',revision:1,visibility:'visible',draft:null,published:{...draft,validUntil:'2000-01-01'}};db.prepare('INSERT INTO hotel_content VALUES(?,?,?)').run(profile.hotel.id,'tea',JSON.stringify(expired));assert.equal(store.describe(profile,'tea').presentation,'expired');assert.equal(store.apply(profile).getPlace('tea').duration,null);assert.throws(()=>store.update(profile,{entityId:'tea',expectedRevision:1,action:'resume'}));db.close();
});
test('basic hotel reviewed introduction publishes without promoting internal capabilities',()=>{
 const {db,directory,store}=setup();const [h]=directory.ingest(result([{id:'basic-note',name:'测试酒店',address:'测试路9号',description:'原始平台介绍'}]),'厦门市'),p=directory.profile(h.id);let r=store.update(p,{entityId:'hotel',expectedRevision:0,action:'save-draft',draft:{...draft,validUntil:''}});r=store.update(p,{entityId:'hotel',expectedRevision:r.revision,action:'publish',attested:true});const effective=store.apply(p);assert.equal(effective.hotel.description,draft.intro);assert.equal(effective.hotel.tier,'basic');assert.equal(effective.places.length,0);db.close();
});
