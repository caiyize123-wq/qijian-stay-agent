import {createHash} from 'node:crypto';
import {buildHotelProfile,getHotelProfile,listHotels} from './hotels.mjs';
import {ServiceError,safeUrl,flyai} from './providers.mjs';
const canonical=s=>String(s||'').normalize('NFKC').replace(/[\s·•，,。]/g,'').toLowerCase();
const cityKey=s=>canonical(s).replace(/市$/,'');
export function validateHotelSearch(input={}){
 const city=String(input.city||'').trim(),keyword=String(input.keyword||'').trim();
 if(!city||city.length>40||!keyword||keyword.length>80)throw new ServiceError('SEARCH_INPUT','请填写城市和酒店名称',400);
 return {city,keyword};
}
export function createHotelSearchCache({search=flyai,ttlMs=300000,maxEntries=128,now=Date.now}={}){
 const saved=new Map(),pending=new Map();
 return async function lookup({city,keyword}){
  const key=JSON.stringify([cityKey(city),canonical(keyword)]),cached=saved.get(key),age=cached?now()-cached.savedAt:0;
  if(cached&&age<ttlMs)return {...structuredClone(cached.result),cache:{hit:true,ageMs:age}};
  if(pending.has(key))return structuredClone(await pending.get(key));
  if(pending.size>=32)throw new ServiceError('SEARCH_BUSY','当前酒店搜索较多，请稍后重试。',503);
  const promise=(async()=>{const result=await search('hotel',keyword,undefined,{city});saved.delete(key);saved.set(key,{savedAt:now(),result:structuredClone(result)});while(saved.size>maxEntries)saved.delete(saved.keys().next().value);return {...result,cache:{hit:false,ageMs:0}};})();pending.set(key,promise);
  try{return await promise;}finally{pending.delete(key);}
 };
}
export function matchDeepHotel(item,city,hotels){
 return hotels.find(h=>{
  const street=String(h.address||'').split(/[市区县]/).at(-1);
  return cityKey(city)===cityKey(h.city)&&canonical(item.name)===canonical(h.name)&&street?.length>=5&&/\d/.test(street)&&canonical(item.address).includes(canonical(street));
 })?.id||null;
}
export function createHotelDirectory(db){
 db.exec('CREATE TABLE IF NOT EXISTS hotel_directory (id TEXT PRIMARY KEY, provider_id TEXT UNIQUE NOT NULL, content TEXT NOT NULL)');
 const read=db.prepare('SELECT content FROM hotel_directory WHERE id=?'),save=db.prepare('INSERT INTO hotel_directory VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content');
 const deepHotels=()=>listHotels().map(h=>getHotelProfile(h.id).hotel);
 function get(id){const r=read.get(id);return r?JSON.parse(r.content):null;}
 function list(){return db.prepare('SELECT content FROM hotel_directory ORDER BY rowid DESC LIMIT 100').all().map(x=>JSON.parse(x.content));}
 function ingest(result,city){
  if(result?.provider!=='flyai'||result.kind!=='hotel')throw new ServiceError('DIRECTORY_SOURCE','酒店结果来源无效',400);
  const seen=new Set();
  return result.items.filter(x=>x.id&&x.name&&!seen.has(x.id)&&seen.add(x.id)).map(x=>{
   const id='flyai-'+createHash('sha256').update('flyai-hotel:'+x.id).digest('hex').slice(0,24),old=get(id);
   const conflict=old&&(canonical(old.name)!==canonical(x.name)||cityKey(old.city)!==cityKey(city)||(old.address&&x.address&&canonical(old.address)!==canonical(x.address)));
   if(conflict)return {id:null,providerId:x.id,name:x.name,city,address:x.address,link:safeUrl(x.link),tier:'basic',identityConflict:true};
   const linkedDeepId=matchDeepHotel(x,city,deepHotels());
   const entry={id,providerId:x.id,name:String(x.name).slice(0,160),city,address:String(x.address||'').slice(0,400),description:String(x.description||'').slice(0,1200),brand:String(x.brand||''),star:String(x.star||''),rating:String(x.rating||''),landmark:String(x.landmark||''),link:safeUrl(x.link),image:safeUrl(x.image)||old?.image||null,latitude:x.latitude,longitude:x.longitude,queriedAt:result.queriedAt,linkedDeepId,identityMatch:linkedDeepId?'name-city-address':'platform-id'};
   save.run(id,x.id,JSON.stringify(entry));return {...entry,openHotelId:linkedDeepId||id,tier:linkedDeepId?'deep':'basic'};
  });
 }
 function profile(id){const e=get(id);if(!e)return null;
  return buildHotelProfile({hotel:{id:e.id,name:e.name,shortName:e.name,english:'YOUR STAY',city:e.city,address:e.address,phone:null,source:e.link||'https://www.fliggy.com/',checkedAt:e.queriedAt?.slice(0,10),keyword:e.name,nearbyKeyword:e.name,cover:'space',mood:'酒店基础资料',tier:'basic',providerId:e.providerId,description:e.description,platformLink:e.link,queriedAt:e.queriedAt,image:e.image,brand:e.brand,star:e.star,rating:e.rating,landmark:e.landmark,notice:'酒店基础资料来自飞猪查询。',mapNotice:'尚未接入酒店内部地图。'},places:[]},[]);
 }
 function imageForDeep(id){const row=db.prepare("SELECT content FROM hotel_directory WHERE json_extract(content,'$.linkedDeepId')=? AND json_extract(content,'$.image') IS NOT NULL ORDER BY rowid DESC LIMIT 1").get(id);if(!row)return null;const e=JSON.parse(row.content);return {image:e.image,imageSource:e.link,imageQueriedAt:e.queriedAt};}
 return {get,list,ingest,profile,imageForDeep};
}
