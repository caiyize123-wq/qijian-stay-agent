import test from 'node:test';
import assert from 'node:assert/strict';
import {getHotelProfile,withOuting} from '../lib/hotels.mjs';
import {rankDiscoveries,chooseDiscovery} from '../lib/discovery.mjs';
import {selectOuting} from '../lib/outing.mjs';
import {parseTime} from '../lib/planner.mjs';
const hotel=getHotelProfile(),base={date:'2026-10-24',start:'15:00',minutes:120,style:'explore',party:'solo'};
const query={provider:'flyai',kind:'nearby',hotelId:hotel.hotel.id,queriedAt:'2026-10-20T00:00:00Z',items:[{id:'test-poi',name:'测试地点（非真实推荐）',address:'仅用于规则测试',description:'Test fixture',link:'https://www.fliggy.com/'}]};
const input={poiId:'test-poi',visitMinutes:30,travelMinutes:30,acknowledged:true};
const outing=selectOuting(input,query,hotel.hotel.id),profile=withOuting(hotel,outing);
test('discovery differs for food, relaxation, family and short available time',()=>{
 assert.equal(rankDiscoveries(hotel,{...base,style:'relax'})[0].pointId,'spa');
 assert.equal(rankDiscoveries(hotel,{...base,style:'food',party:'couple'})[0].pointId,'tea');
 assert.equal(rankDiscoveries(hotel,{...base,style:'relax',party:'family'})[0].pointId,'garden');
 assert.equal(rankDiscoveries(hotel,{...base,style:'relax',minutes:30})[0].pointId,'garden');
});
test('discovery excludes closed windows, unconfirmed extra spend and completed priorities',()=>{
 const early=rankDiscoveries(hotel,{...base,start:'07:00',minutes:60,style:'food'});assert.ok(!early.some(x=>['tea','spa','xia'].includes(x.pointId)));
 assert.deepEqual(rankDiscoveries(hotel,{...base,start:'23:55'}),[]);
 const late=rankDiscoveries(hotel,{...base,start:'23:30',minutes:30});assert.ok(!late.some(x=>['tea','pool','spa'].includes(x.pointId)));
 assert.ok(rankDiscoveries(hotel,{...base,noExtraSpend:true}).every(x=>hotel.getPlace(x.pointId).category==='architecture'));
 assert.notEqual(rankDiscoveries(hotel,base,['garden'])[0].pointId,'garden');
});
test('model cannot choose a point outside the rule shortlist or invent one',()=>{
 const list=rankDiscoveries(hotel,{...base,minutes:30});const chosen=chooseDiscovery(list,['spa','made-up']);assert.equal(chosen.pointId,'garden');assert.equal(chooseDiscovery([],['garden']),null);
});
test('second hotel discovery cannot borrow the first hotel spa',()=>{const other=getHotelProfile('andaz-xiamen');assert.ok(rankDiscoveries(other,{...base,style:'relax'}).every(x=>x.pointId!=='spa'));assert.ok(rankDiscoveries(other,base).find(x=>x.pointId==='garden').reason.includes('南洋空间'));});
test('outing requires the current hotel actual search results and explicit budget acknowledgement',()=>{
 assert.throws(()=>selectOuting({...input,poiId:'invented'},query,hotel.hotel.id));assert.throws(()=>selectOuting(input,query,'andaz-xiamen'));assert.throws(()=>selectOuting({...input,acknowledged:false},query,hotel.hotel.id));
 for(const change of [{travelMinutes:0},{visitMinutes:999},{visitMinutes:90,travelMinutes:60}])assert.throws(()=>selectOuting({...input,...change},query,hotel.hotel.id));
 assert.equal(outing.totalMinutes,90);assert.equal(outing.timingSource,'user-budget');assert.equal(outing.openingHours,null);
});
test('hotel, outside round-trip, hotel fit in one timeline with user budget preserved',()=>{
 const plan=profile.planner.createPlan({...base,minutes:180,selected:['garden','tea'],includeOutside:true},{selectedOnly:true});
 assert.deepEqual(plan.items.map(x=>x.id),['garden','outside','tea']);const x=plan.items[1];assert.equal(x.minutes,90);assert.equal(x.outing.travelMinutes,30);assert.equal(x.kind,'outside');assert.ok(parseTime(plan.items[2].end)<=1080);
});
test('outside never bypasses a locked hotel appointment or silently disappears',()=>{
 const plan=profile.planner.createPlan({...base,minutes:120,includeOutside:true,fixedItems:[{id:'tea',start:'15:30',end:'16:15'}]});assert.equal(plan.items.find(x=>x.id==='tea').start,'15:30');assert.ok(!plan.items.some(x=>x.id==='outside'));assert.ok(plan.skipped.some(x=>x.id==='outside'));
});
test('unknown outside costs obey no-extra-spend; missing outing cannot be scheduled',()=>{
 const plan=profile.planner.createPlan({...base,minutes:180,includeOutside:true,noExtraSpend:true});assert.ok(!plan.items.some(x=>x.id==='outside'));assert.ok(plan.skipped.some(x=>x.id==='outside'));assert.throws(()=>hotel.planner.createPlan({...base,includeOutside:true}),/周边地点/);
});
test('removing outside preserves remaining times and disables automatic reinsertion',()=>{
 const plan=profile.planner.createPlan({...base,minutes:180,selected:['garden','tea'],includeOutside:true},{selectedOnly:true}),next=profile.planner.editPlan(plan,{operation:'remove',id:'outside'});assert.deepEqual(next.items,plan.items.filter(x=>x.id!=='outside'));assert.equal(next.preferences.includeOutside,false);
});
test('outside has no fabricated indoor route, map coordinates or hotel booking contact',()=>{
 assert.equal(profile.getPlace('outside').x,null);assert.throws(()=>profile.planner.route('arrival','outside'),/内部点位/);assert.throws(()=>profile.journey.participationFor('outside'),/预约渠道/);
});
