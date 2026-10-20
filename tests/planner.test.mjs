import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlan,validatePreferences,windowsFor,shanghaiClock,route} from '../lib/planner.mjs';
import {getPlace} from '../lib/catalog.mjs';
import {normalizeFlyai,safeUrl} from '../lib/providers.mjs';
const base={date:'2026-10-24',start:'15:00',minutes:120,style:'explore'};
const minute=s=>{const [h,m]=s.split(':').map(Number);return h*60+m;};
test('seasonal pool hours change across October/November',()=>{
  assert.deepEqual(windowsFor(getPlace('pool'),'2026-10-31'),[[420,1260]]);
  assert.deepEqual(windowsFor(getPlace('pool'),'2026-11-01'),[[540,1080]]);
});
test('timezone follows Shanghai even across UTC midnight',()=>{
  assert.deepEqual(shanghaiClock(new Date('2026-10-18T18:30:00Z')),{date:'2026-10-19',time:'02:30',month:10});
});
test('all plans fit requested windows and respect known opening hours',()=>{
  for(const start of ['06:00','10:00','13:30','17:00','20:00','23:30'])for(const minutes of [30,60,120,180,240])for(const style of ['explore','relax','food','family']){
    const p=createPlan({...base,start,minutes,style});let end=minute(start);
    for(const item of p.items){const s=minute(item.start),e=minute(item.end);assert.ok(s>=end);assert.ok(e<=Math.min(1440,minute(start)+minutes));assert.equal(e-s,item.minutes);const w=windowsFor(getPlace(item.id),base.date);if(w)assert.ok(w.some(([a,b])=>s>=a&&e<=b));end=e;}
  }
});
test('no extra spend excludes services with unconfirmed price/entitlement',()=>{
  const p=createPlan({...base,noExtraSpend:true,selected:['tea','spa']});assert.ok(p.items.every(x=>getPlace(x.id).category==='architecture'));assert.ok(p.skipped.some(x=>x.id==='tea'));assert.ok(p.skipped.some(x=>x.id==='spa'));
});
test('unknown daily activity is not scheduled; chosen IDs deduplicate',()=>{
  const p=createPlan({...base,selected:['activities','garden','garden','not-a-place']});assert.equal(p.items.filter(x=>x.id==='garden').length,1);assert.ok(!p.items.some(x=>x.id==='activities'));assert.ok(p.skipped.some(x=>x.id==='activities'));
});
test('editing does not resurrect removed entries',()=>{
  const p=createPlan({...base,selected:['tea']},{selectedOnly:true});assert.deepEqual(p.items.map(x=>x.id),['tea']);
  assert.deepEqual(createPlan({...base,selected:[]},{selectedOnly:true}).items,[]);
});
test('invalid dates/time/duration are rejected',()=>{
  for(const input of [{date:'2026-02-31'},{date:'bad'},{start:'24:60'},{minutes:999}])assert.throws(()=>validatePreferences({...base,...input}));
});
test('schematic route never claims verified distance or walk duration',()=>{
  const r=route('arrival','spa');assert.equal(r.verified,false);assert.equal(r.duration,null);assert.equal(r.distance,null);assert.equal(r.schematic,true);assert.throws(()=>route('unknown','spa'));
});
test('FlyAI missing price/hours/inventory stay unknown; unsafe links rejected',()=>{
  const out=normalizeFlyai({status:0,data:{itemList:[{name:'sample',jumpUrl:'javascript:alert(1)'}]}});assert.equal(out[0].price,null);assert.equal(out[0].availability,null);assert.equal(out[0].openingHours,null);assert.equal(out[0].link,null);assert.equal(safeUrl('https://example.com/'),'https://example.com/');
});
test('FlyAI business error is not recorded as an empty success',()=>{assert.throws(()=>normalizeFlyai({status:401,data:{itemList:[]}}));assert.throws(()=>normalizeFlyai({status:0,systemMessage:'service error',data:{itemList:[]}}));});
