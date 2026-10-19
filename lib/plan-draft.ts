import {draftCityState} from './city-stays.ts';
import type {TravelMatrix} from './route-matrix.ts';
import {tripCatalog,planMembers,applyAction,type State,type Suggestion} from './model.ts';
import {bestSuggestionSlot} from './suggestion-planning.ts';
import {tripDays,localDateTime} from './trip-time.ts';
import {planCurrency,parseMoney} from './money.ts';

export type DraftEntry={suggestionId:string;start:string;duration:number;reason:string;place:Suggestion;warnings:string[]};
export type PlanDraft={planningDay?:string;id:string;tripId:string;version:number;goal:string;mode:'ai'|'source';travelMode?:'walk'|'drive';routeSourceIds?:string[];entries:DraftEntry[];assumptions:string[];warnings:string[]};
export const draftTopics=[{tag:'Museums',words:/museum|history|art|gallery/i},{tag:'Food',words:/food|eat|restaurant|cafe|coffee/i},{tag:'Outdoors',words:/outdoor|hike|nature|park|walk/i},{tag:'Shopping',words:/shop|market/i},{tag:'Culture',words:/culture|temple|architecture/i},{tag:'Entertainment',words:/entertain|music|nightlife|show/i}];
export function draftGoal(goal:string,state:State,actor:string){
 if(typeof goal!=='string'||goal.trim().length<8||goal.length>1200)throw Error('Describe your goal in 8–1200 characters.');
 const topics=draftTopics.filter(topic=>topic.words.test(goal)).map(topic=>topic.tag),days=Math.min(7,Math.max(1,Number(goal.match(/\b(\d+)\s*days?\b/i)?.[1]??tripDays(state.plan.start,state.plan.end).length))),pace=/relax|slow|easy/i.test(goal)?'relaxed':/busy|packed|lots/i.test(goal)?'busy':state.preferences[actor]?.pace??'balanced';
 const raw=goal.match(/(?:under|budget(?:\s+of)?|up to|less than)\s*(?:[A-Z]{3}\s*)?\$?\s*(\d+(?:\.\d{1,3})?)/i)?.[1];
 let budget:number|undefined;try{if(raw)budget=parseMoney(raw,planCurrency(state.plan));}catch{}
 return {topics,days,pace,preferFree:/free|no spending/i.test(goal),budget};
}
export function draftCandidatePool(state:State,goal:string,actor:string){state=draftCityState(state);const intent=draftGoal(goal,state,actor),existing=new Set(state.items.filter(i=>i.status!=='cancelled').map(i=>i.name.toLowerCase()));return tripCatalog(state).filter(c=>!existing.has(c.name.toLowerCase())&&c.category!=='Preparation'&&c.category!=='Accommodation'&&(!intent.preferFree||c.price===0)).map(c=>({c,score:intent.topics.reduce((n,tag)=>n+(c.tags?.some(t=>t.toLowerCase()===tag.toLowerCase())||draftTopics.find(t=>t.tag===tag)?.words.test(`${c.name} ${c.reason}`)?30:0),0)+(c.price===0?5:0)})).sort((a,b)=>b.score-a.score||a.c.name.localeCompare(b.c.name)).slice(0,60).map(x=>x.c);}
export function createPlanDraft(state:State,goal:string,actor:string,selection?:{suggestionId:string;reason:string}[],matrix?:TravelMatrix):PlanDraft{
 state=draftCityState(state);
 const intent=draftGoal(goal,state,actor),pool=draftCandidatePool(state,goal,actor).filter(c=>!matrix||matrix.points.includes(c.longitude?.toFixed(6)+','+c.latitude?.toFixed(6))),ids=planMembers(state).filter(p=>!['viewer','legacy'].includes(p.role)).map(p=>p.id),days=tripDays(state.plan.start,state.plan.end).slice(0,intent.days),limit=intent.pace==='relaxed'?2:intent.pace==='busy'?4:3;
 const choices=selection?selection.filter(choice=>pool.some(c=>c.id===choice.suggestionId)).slice(0,12):pool.map(c=>({suggestionId:c.id,reason:intent.topics.length?`Chosen for ${intent.topics.join(', ').toLowerCase()}.`:'A local place from your destination catalog.'}));
 let working=structuredClone(state);working.preferences[actor]={...working.preferences[actor],pace:intent.pace,interests:intent.topics.length?intent.topics:working.preferences[actor]?.interests??[]};
 const entries:DraftEntry[]=[],counts=new Map<string,number>(),used=new Set<string>();let knownShare=0;
 for(const choice of choices){if(entries.length>=12||used.has(choice.suggestionId))continue;const c=pool.find(c=>c.id===choice.suggestionId);if(!c)continue;
  for(const day of days){if((counts.get(day)??0)>=limit)continue;const placed=bestSuggestionSlot(working,{...c,suggestedParticipants:ids},actor,day,matrix),e=placed.evaluation;if(localDateTime(e.start,c.timezone??state.plan.timezone).slice(0,10)!==day||e.status==='blocked'||e.overBudget||e.overCash)continue;
   if(intent.budget!==undefined&&e.yourShare!==undefined&&knownShare+e.yourShare>intent.budget)continue;
   try{working=applyAction(working,{type:'add_suggestion',actor,suggestionId:c.id,participants:ids,start:e.start,duration:e.duration,_insertion:e});}catch{continue;}
   entries.push({suggestionId:c.id,start:e.start,duration:e.duration,reason:String(choice.reason).slice(0,250),place:c,warnings:e.issues});knownShare+=e.yourShare??0;counts.set(day,(counts.get(day)??0)+1);used.add(c.id);break;
  }
 }
 const warnings:string[]=[];if(entries.some(e=>e.place.price===null))warnings.push('Some admission, meal and transport costs are unknown. A budget fit cannot be guaranteed.');if(intent.preferFree&&!entries.length)warnings.push('No confirmed free candidates are available. Unknown prices were not treated as free.');if(!entries.length)warnings.push('No suitable places fitted this draft. Browse more places or adjust your dates and preferences.');
 return {planningDay:state.plan.start,id:crypto.randomUUID(),tripId:state.plan.id!,version:state.version,goal:goal.trim(),mode:selection?'ai':'source',travelMode:matrix?.mode??(state.plan.scheduleTravelMode==='drive'?'drive':'walk'),entries,assumptions:[`Uses the existing destination and dates: ${state.plan.destination}, ${state.plan.start}–${state.plan.end}.`,`${intent.pace} pace, up to ${limit} visits per day, first ${days.length} days, at most 12 visits.`,...(intent.budget!==undefined?[`The written budget is interpreted per person in ${planCurrency(state.plan)}; no currency conversion is applied.`]:[]),matrix?'Uses mapped road/path travel times with visit buffers. Check current hours, traffic, cost and availability.':'Uses catalog places and rough travel. Review listed hours, routes, cost and availability.','Adding this draft creates activities for review. Bookings and payments require separate action.'],warnings};
}

export function applyPlanDraft(state:State,actor:string,draftId:string,entries:Pick<DraftEntry,'suggestionId'|'start'|'duration'>[],checks?:Record<string,unknown>):State{
 if(!/^[A-Za-z0-9-]{8,100}$/.test(draftId)||!Array.isArray(entries)||!entries.length||entries.length>12||new Set(entries.map(e=>e.suggestionId)).size!==entries.length)throw Error('Select 1–12 distinct draft activities.');if(state.appliedDrafts?.includes(draftId))throw Error('This draft was already added.');
 let next=state;for(const entry of [...entries].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))){const ids=planMembers(next).filter(p=>!['viewer','legacy'].includes(p.role)).map(p=>p.id);next=applyAction(next,{type:'add_suggestion',actor,suggestionId:entry.suggestionId,start:entry.start,duration:entry.duration,participants:ids,_insertion:checks?.[entry.suggestionId]});}
 next.appliedDrafts=[...(next.appliedDrafts??[]),draftId].slice(-100);return next;
}
