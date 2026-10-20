import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlan,editPlan,alternativesFor,parseTime,windowsFor} from '../lib/planner.mjs';
import {getPlace} from '../lib/catalog.mjs';
import {guideChapters,participationFor,validateConfirmation,mergeFixedPreferences} from '../lib/journey.mjs';
const base={date:'2026-10-24',start:'15:00',minutes:120,style:'explore',selected:['garden','tea']};
test('arrival is a guide stage and never scheduled as an experience',()=>{
  for(const style of ['explore','relax','food','family'])assert.ok(!createPlan({...base,style,selected:['arrival']}).items.some(x=>x.id==='arrival'));
});
test('fixed experience survives regeneration at exactly the same time',()=>{
  const fixedItems=[{id:'tea',start:'16:00',end:'16:45'}];
  for(const style of ['explore','relax','food','family']){
    const p=createPlan({...base,style,fixedItems});const tea=p.items.find(x=>x.id==='tea');assert.equal(tea.start,'16:00');assert.equal(tea.end,'16:45');assert.equal(tea.locked,true);
    for(const x of p.items.filter(x=>x.id!=='tea'))assert.ok(parseTime(x.end,true)<=950||parseTime(x.start)>=1015);
  }
});
test('conflicting or out-of-window anchors reject rather than disappear',()=>{
  assert.throws(()=>createPlan({...base,fixedItems:[{id:'tea',start:'14:00',end:'14:45'}]}),/超出/);
  assert.throws(()=>createPlan({...base,fixedItems:[{id:'tea',start:'15:00',end:'15:45'},{id:'spa',start:'15:30',end:'16:30'}]}),/冲突/);
});
test('removing an unlocked item leaves other times intact and creates empty time',()=>{
  const p=createPlan(base,{selectedOnly:true}),first=p.items[0];const next=editPlan(p,{operation:'remove',id:first.id});
  assert.deepEqual(next.items,p.items.slice(1));assert.ok(next.unallocatedMinutes>p.unallocatedMinutes);
});
test('locked items cannot be removed or replaced without explicit unlock',()=>{
  const p=createPlan(base,{selectedOnly:true}),locked=editPlan(p,{operation:'lock',id:'garden',locked:true});
  assert.throws(()=>editPlan(locked,{operation:'remove',id:'garden'}),/解除/);
  assert.throws(()=>alternativesFor(locked,'garden'),/解除/);
  assert.equal(editPlan(locked,{operation:'lock',id:'garden',locked:false}).items[0].locked,false);
});
test('single replacement changes neither other items nor their locked times',()=>{
  const p=editPlan(createPlan(base,{selectedOnly:true}),{operation:'lock',id:'garden',locked:true});
  const candidates=alternativesFor(p,'tea');assert.ok(candidates.some(x=>x.id==='spa'));
  const next=editPlan(p,{operation:'replace',id:'tea',replacementId:'spa'});assert.deepEqual(next.items[0],p.items[0]);assert.equal(next.items[1].id,'spa');assert.ok(next.items.every(x=>x.id!=='arrival'));
  for(const c of candidates){const w=windowsFor(getPlace(c.id),base.date);if(w)assert.ok(w.some(([a,b])=>parseTime(c.start)>=a&&parseTime(c.end,true)<=b));}
});
test('no extra spend also restricts replacement suggestions',()=>{
  const p=createPlan({...base,noExtraSpend:true},{selectedOnly:true});assert.ok(alternativesFor(p,'garden').every(x=>getPlace(x.id).category==='architecture'));
});
test('confirmation requires both complete checklist and explicit user attestation',()=>{
  assert.throws(()=>validateConfirmation({id:'spa',status:'self_confirmed',checks:[]}),/勾选/);
  assert.throws(()=>validateConfirmation({id:'spa',status:'self_confirmed',attested:true,checks:[0]}),/逐项/);
  const checks=participationFor('spa').questions.map((_,i)=>i),r=validateConfirmation({id:'spa',status:'self_confirmed',attested:true,checks,notes:'test only'});
  assert.equal(r.confirmedBy,'user');assert.equal(r.status,'self_confirmed');assert.equal(r.appointment,null);assert.ok(!('hotelVerified' in r));
});
test('self-reported appointment becomes a fixed planning anchor, not an external booking',()=>{
  const checks=participationFor('pool').questions.map((_,i)=>i),r=validateConfirmation({id:'pool',status:'self_confirmed',attested:true,checks,appointment:{date:base.date,start:'16:00',minutes:45}});
  const prefs=mergeFixedPreferences(base,{confirmations:{pool:r}}),p=createPlan(prefs);assert.equal(p.items.find(x=>x.id==='pool').start,'16:00');assert.equal(p.items.find(x=>x.id==='pool').lockOrigin,'user-confirmed');
});
test('clearing a confirmation does not create cancellation claims',()=>{assert.equal(validateConfirmation({id:'spa',status:'clear'}),null);});
test('phone link is public base number, extension separate; no auto dial tool',()=>{
  const p=participationFor('spa');assert.equal(p.tel,'tel:+865927997777');assert.equal(p.extension,'8153');assert.ok(p.notice.includes('不代拨'));assert.throws(()=>participationFor('invented'));
});
test('guide observations are sourced and separate from unverified design intent',()=>{
  assert.equal(guideChapters.length,3);assert.ok(guideChapters.every(x=>x.source.startsWith('https://')&&x.boundary&&x.observation&&x.hotspot));
});
