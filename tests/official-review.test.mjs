import test from 'node:test';
import assert from 'node:assert/strict';
import {getHotelProfile} from '../lib/hotels.mjs';
import {rankDiscoveries} from '../lib/discovery.mjs';
const lohkah=getHotelProfile(),andaz=getHotelProfile('andaz-xiamen');
test('reviewed Lohkah dining stays in its own published meal windows, with no invented coordinates',()=>{
 const p=lohkah.getPlace('oli-fish');assert.ok(p);assert.deepEqual(p.windows,[[420,660],[720,870],[1050,1290]]);assert.equal(p.mapAvailable,false);
 assert.throws(()=>lohkah.planner.route('arrival',p.id),/地图/);
 const plan=lohkah.planner.createPlan({date:'2026-10-24',start:'14:00',minutes:120,selected:[p.id]},{selectedOnly:true});assert.equal(plan.items.length,0);
});
test('combined Lohkah spa and hydrotherapy uses the overlap, not the later treatment closing hour',()=>{
 assert.deepEqual(lohkah.getPlace('spa').windows,[[600,1290]]);
 const plan=lohkah.planner.createPlan({date:'2026-10-24',start:'21:00',minutes:120,selected:['spa']},{selectedOnly:true});assert.equal(plan.items.length,0);
});
test('Andaz official spa has independent evidence, unknown hours, no route and no automatic family recommendation',()=>{
 const p=andaz.getPlace('andaz-spa');assert.ok(p.source.endsWith('/faqs'));assert.equal(p.windows,null);assert.equal(p.mapAvailable,false);assert.notEqual(p.id,'spa');
 assert.throws(()=>andaz.planner.route('arrival',p.id),/地图/);
 const prefs={date:'2026-10-24',start:'15:00',minutes:120,party:'family',style:'relax'};
 assert.ok(rankDiscoveries(andaz,prefs).every(x=>x.pointId!==p.id));
 const plan=andaz.planner.createPlan({...prefs,noExtraSpend:true,selected:[p.id]},{selectedOnly:true});assert.equal(plan.items.length,0);
});
