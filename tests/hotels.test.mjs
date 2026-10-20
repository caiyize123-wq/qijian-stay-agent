import test from 'node:test';
import assert from 'node:assert/strict';
import {getHotelProfile,listHotels,defaultHotelId,stayKey} from '../lib/hotels.mjs';
const lohkah=getHotelProfile(),andaz=getHotelProfile('andaz-xiamen');
const prefs={date:'2026-10-24',start:'15:00',minutes:120,selected:['garden','tea']};
test('hotel packs have distinct source-backed facts with a shared capability interface',()=>{
 assert.equal(listHotels().length,2);assert.equal(lohkah.hotel.id,defaultHotelId);assert.equal(getHotelProfile('missing'),undefined);
 for(const p of [lohkah,andaz]){assert.ok(p.hotel.source.startsWith('https://'));assert.ok(p.journey.guideChapters.every(c=>p.getPlace(c.pointId)&&c.next.every(id=>p.getPlace(id))));assert.ok(p.places.every(x=>x.source.startsWith('https://')));}
 assert.equal(lohkah.getPlace('spa').name,'水疗与泡池');assert.equal(andaz.getPlace('spa'),undefined);
 assert.equal(andaz.getPlace('tea').name,'安达仕酒廊');assert.notEqual(lohkah.getPlace('tea').source,andaz.getPlace('tea').source);
});
test('same point identifiers resolve against each property in concurrent agent tool requests',async()=>{
 const results=await Promise.all(Array.from({length:8},(_,i)=>(i%2?lohkah:andaz).agent.executeTool('get_hotel_facts',{ids:['tea']})));
 for(let i=0;i<results.length;i++){assert.equal(results[i].hotel.id,i%2?lohkah.hotel.id:andaz.hotel.id);assert.equal(results[i].places[0].name,i%2?'Long Bar · 茶与小坐':'安达仕酒廊');}
});
test('plans and replacement options stay inside the active property',()=>{
 const a=andaz.planner.createPlan(prefs,{selectedOnly:true}),l=lohkah.planner.createPlan(prefs,{selectedOnly:true});
 assert.equal(a.hotelId,andaz.hotel.id);assert.equal(l.hotelId,lohkah.hotel.id);
 assert.ok(a.items.every(x=>x.source.startsWith('https://www.hyatt.com/')));assert.ok(l.items.every(x=>!x.source.includes('hyatt')));
 assert.ok(andaz.planner.alternativesFor(a,'tea').every(x=>x.id!=='spa'));
 assert.throws(()=>andaz.planner.editPlan(l,{operation:'remove',id:'tea'}),/另一家/);
});
test('contacts and schematic routes do not leak between properties',()=>{
 const a=andaz.journey.participationFor('tea'),l=lohkah.journey.participationFor('tea');
 assert.equal(a.tel,'tel:+865923681234');assert.equal(a.extension,null);assert.equal(l.extension,'8283');assert.notEqual(a.tel,l.tel);
 assert.throws(()=>andaz.journey.participationFor('spa'));assert.throws(()=>andaz.planner.route('arrival','spa'));
 assert.equal(andaz.planner.route('arrival','pool').hotelId,andaz.hotel.id);
});
test('state keys preserve legacy stays and isolate every hotel within a browser session',()=>{
 assert.equal(stayKey('session',defaultHotelId),'session');assert.notEqual(stayKey('session',defaultHotelId),stayKey('session',andaz.hotel.id));assert.throws(()=>stayKey('session','missing'));
});
