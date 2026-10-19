import {draftCityState} from './city-stays.ts';
import type {TravelMatrix} from './route-matrix.ts';
import {tripCatalog,type State} from './model.ts';
import {createPlanDraft} from './plan-draft.ts';
import {sortDiscovery} from './place-popularity.ts';
import {validPoint} from './itinerary-map.ts';
import {tripDays} from './trip-time.ts';
export const starterInterests=[{tag:'Culture',label:'Landmarks & culture'},{tag:'Food',label:'Local food'},{tag:'Museums',label:'Museums & art'},{tag:'Outdoors',label:'Parks & outdoors'},{tag:'Shopping',label:'Shops & markets'},{tag:'Entertainment',label:'Fun & entertainment'}];
export type StarterPace='relaxed'|'balanced'|'busy';
export function starterPlaces(state:State,interests:string[],day=state.plan.start){
 state=draftCityState(state,day);
 const existing=new Set(state.items.filter(i=>i.status!=='cancelled').map(i=>i.name.toLowerCase()));
 const places=sortDiscovery(tripCatalog(state).filter(p=>!existing.has(p.name.toLowerCase())&&!['Preparation','Accommodation','Transport'].includes(p.category)&&validPoint(p)),'popular',state.plan.city);
 const score=(tags:string[]|undefined)=>interests.filter(tag=>tags?.includes(tag)).length;
 return places.map((p,i)=>({p,i,score:score(p.tags)})).sort((a,b)=>b.score-a.score||a.i-b.i).map(row=>row.p);
}
export function starterDraft(state:State,actor:string,ids:string[],interests:string[],pace:StarterPace,matrix?:TravelMatrix,day=state.plan.start){
 state=draftCityState(state,day);
 if(!Array.isArray(ids)||!ids.length||ids.length>12||new Set(ids).size!==ids.length)throw Error('Choose between 1 and 12 different places.');
 const available=starterPlaces(state,interests);if(ids.some(id=>!available.some(p=>p.id===id)))throw Error('A chosen place changed. Choose your places again.');
 const working=structuredClone(state);
 if(working.recommendations)working.recommendations.entries=working.recommendations.entries.filter(p=>ids.includes(p.id));
 const days=Math.min(7,tripDays(state.plan.start,state.plan.end).length),goal='A '+pace+' '+days+' day plan with '+(interests.length?interests.join(', '):'local places')+'.';
 const draft=createPlanDraft(working,goal,actor,ids.map(suggestionId=>({suggestionId,reason:'Selected by you from places in '+state.plan.destination+'.'})),matrix);
 draft.mode='source';return draft;
}
