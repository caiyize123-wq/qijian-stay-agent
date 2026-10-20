import * as lohkah from './catalog.mjs';
import * as andaz from './andaz.mjs';
import {guideChapters,createJourney} from './journey.mjs';
import {createPlanner} from './planner.mjs';
import {createAgent} from './agent.mjs';
import {outingPlace} from './outing.mjs';
export const defaultHotelId=lohkah.hotel.id;
export function buildHotelProfile(data,chapters){
 const {places}=data,hotel={tier:'deep',...data.hotel};
 const catalog={hotel,places,categories:lohkah.categories.filter(c=>c.id==='all'||places.some(p=>p.category===c.id)),getPlace:id=>places.find(p=>p.id===id),facts:(ids=[])=>places.filter(p=>!['paused','expired'].includes(p.contentState)&&(!ids.length||ids.includes(p.id))).map(p=>({...p,checkedAt:p.sourceCheckedAt||hotel.checkedAt}))};
 const planner=createPlanner(catalog),journey=createJourney(catalog,chapters,planner),agent=createAgent(catalog,journey,planner);
 return Object.freeze({...catalog,planner,journey,agent});
}
const profiles=new Map([[lohkah.hotel.id,buildHotelProfile(lohkah,guideChapters)],[andaz.hotel.id,buildHotelProfile(andaz,andaz.guideChapters)]]);
export function getHotelProfile(id=defaultHotelId){return profiles.get(id);}
export function withOuting(profile,outing){const point=outingPlace(outing,profile.hotel.id);return point?buildHotelProfile({hotel:profile.hotel,places:[...profile.places,point]},profile.journey.guideChapters):profile;}
export function listHotels(){return [...profiles.values()].map(({hotel,places})=>({id:hotel.id,name:hotel.name,english:hotel.english,city:hotel.city,mood:hotel.mood,cover:hotel.cover,experienceCount:places.filter(p=>p.id!=='arrival').length}));}
// Retain the original key for existing Seven Shang stays, scope every other pack.
export function stayKey(sessionId,hotelId){if(!profiles.has(hotelId)&&!/^flyai-[a-f0-9]{24}$/.test(hotelId))throw new Error('Unknown hotel');return hotelId===defaultHotelId?sessionId:`${sessionId}:${hotelId}`;}
