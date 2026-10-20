import {PlanningError} from './planner.mjs';
import {safeUrl} from './providers.mjs';
export function selectOuting(input,nearby,hotelId){
 if(nearby?.provider!=='flyai'||nearby.kind!=='nearby'||nearby.hotelId!==hotelId)throw new PlanningError('请先查询当前酒店的周边地点');
 const poi=nearby.items.find(x=>String(x.id)===String(input.poiId));if(!poi||!poi.id)throw new PlanningError('请从本次飞猪结果中选择地点');
 const visitMinutes=Number(input.visitMinutes),travelMinutes=Number(input.travelMinutes);
 if(![30,45,60,90].includes(visitMinutes)||![15,30,45,60].includes(travelMinutes))throw new PlanningError('请选择停留时间和单程交通预留');
 if(visitMinutes+travelMinutes*2>180)throw new PlanningError('外出预留最多3小时，请缩短停留或交通预留');
 if(input.acknowledged!==true)throw new PlanningError('请确认这是你的时间预留，开放与交通尚需自行了解');
 return {hotelId,poi:{id:poi.id,name:String(poi.name).slice(0,120),address:String(poi.address||'').slice(0,300),description:String(poi.description||'').slice(0,500),link:safeUrl(poi.link)},visitMinutes,travelMinutes,totalMinutes:visitMinutes+travelMinutes*2,queriedAt:nearby.queriedAt,createdAt:new Date().toISOString(),timingSource:'user-budget',openingHours:null,availability:null};
}
export function outingPlace(outing,hotelId){
 if(!outing||outing.hotelId!==hotelId)return null;
 return {id:'outside',name:outing.poi.name,english:'OUTSIDE THE HOTEL',category:'outside',tag:'外出预留',image:'space',intro:`从酒店出发，前往${outing.poi.name}，再返回酒店。`,story:outing.poi.description||'地点来自飞猪查询。',prompt:'出发前了解当地开放、交通与费用。',duration:outing.totalMinutes,windows:null,fee:'地点消费与交通费用需另行了解',booking:'当前仅为时间预留，未预约',location:outing.poi.address||'具体地址请查看地点详情',source:outing.poi.link||'https://www.fliggy.com/',outing,sourceType:'flyai',x:null,y:null};
}
