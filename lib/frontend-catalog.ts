import type {State,Suggestion} from './model.ts';
import {cityContexts,cityRecommendations} from './city-stays.ts';
import {cityKey,cityProfile} from './cities.ts';
import {placeInfo} from './place-info.ts';
import {zonedStart} from './trip-time.ts';
/** Add per-city/route source entries while retaining the canonical demo catalog. */
export function enrichCatalog(state:State,canonical:Suggestion[]):Suggestion[]{
 const result=[...canonical],seen=new Set(result.map(s=>s.id));
 const contexts=cityContexts(state).filter((context,index,all)=>all.findIndex(c=>cityKey(c.destination)===cityKey(context.destination))===index);
 for(const context of contexts){
  const curated=cityProfile(context.destination,context.city),stored=cityRecommendations(state,context.destination)?.entries??[],places=[...(curated?.places??[]).map(p=>({...p,...stored.find(s=>s.id===p.id)})),...stored.filter(p=>!curated?.places.some(c=>c.id===p.id))];
  for(const place of places){
   const suggestion:Suggestion={...place,...placeInfo(place),cityKey:cityKey(context.destination),stayId:context.id,timezone:context.timezone,id:place.id,name:place.name,category:place.category,start:zonedStart(`${context.start}T10:00`,context.timezone),duration:60,travelIn:0,travelOut:0,buffer:0,price:null,reason:place.description,policy:'Check current hours, costs and reservations with the source. This is a planning choice; no booking has been made.',location:place.area,tag:'City recommendation',flexible:true};
   const existing=result.findIndex(s=>s.id===place.id);if(existing>=0){if(result[existing].flexible)result[existing]={...result[existing],...suggestion};continue;}
   seen.add(place.id);result.push(suggestion);
  }
 }
 for(const place of state.routeCatalog??[])if(!seen.has(place.id)){seen.add(place.id);result.push({...place,...placeInfo(place),routeLegId:place.routeLegId,timezone:place.timezone,start:zonedStart(state.plan.start+'T10:00',place.timezone),duration:60,travelIn:0,travelOut:0,buffer:15,price:null,reason:place.description,policy:'Mapped stop along a city transfer. Check current hours, access and cost.',location:place.area,tag:'Along your route',flexible:true});}
 return result;
}
