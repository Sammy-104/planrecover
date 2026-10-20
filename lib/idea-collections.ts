import {validCitySelection,type CitySelection} from './city-search.ts';
import {tripDays} from './trip-time.ts';
export const IDEAS_PER_PLAN_DAY=24;
export function planningIdeaCapacity(start:string,end:string){return tripDays(start,end).length*IDEAS_PER_PLAN_DAY;}
export type PlanningIdea={id:string;name:string;note:string;url?:string;done?:boolean};
export type IdeaCollection={id:string;name:string;destination:string;city?:CitySelection;timeframe:string;notes:string;ideas:PlanningIdea[];updatedAt:string};
export type IdeaLibrary={version:number;collections:IdeaCollection[]};
export function ideaUrl(value:unknown){if(value===undefined||value==='')return undefined;if(typeof value!=='string'||value.length>2000)throw Error('Use a shorter place link.');try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw Error();return url.href;}catch{throw Error('Use a complete https:// place or venue link.');}}
const text=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';
export function validatePlanningIdeas(value:unknown):PlanningIdea[]{if(!Array.isArray(value)||value.length>100)throw Error('Keep up to 100 ideas in a collection.');const result=value.map(i=>{if(!i||typeof i.id!=='string'||!i.id||i.id.length>100||!text(i.name,180))throw Error('Give each idea a name.');return {id:i.id,name:text(i.name,180),note:text(i.note,1000),url:ideaUrl(i.url),done:i.done===true};});if(new Set(result.map(i=>i.id)).size!==result.length)throw Error('Use distinct ideas.');return result;}
export function updateIdeaLibrary(input:IdeaLibrary,action:{operation:string;collection?:IdeaCollection;id?:string},now=new Date().toISOString()):IdeaLibrary{
 const next=structuredClone(input);if(action.operation==='delete'){if(!next.collections.some(c=>c.id===action.id))throw Error('This collection is no longer available. Refresh and try again.');next.collections=next.collections.filter(c=>c.id!==action.id);}
 else if(action.operation==='save'){const c=action.collection;if(!c||typeof c.id!=='string'||!c.id||c.id.length>100||!text(c.name,100))throw Error('Name your idea collection.');const city=validCitySelection(c.city,text(c.destination,120)),collection:IdeaCollection={id:c.id,name:text(c.name,100),destination:text(c.destination,120),city,timeframe:text(c.timeframe,100),notes:text(c.notes,2000),ideas:validatePlanningIdeas(c.ideas),updatedAt:now};const index=next.collections.findIndex(old=>old.id===collection.id);if(index<0){if(next.collections.length>=30)throw Error('Keep up to 30 idea collections.');next.collections.unshift(collection);}else next.collections[index]=collection;}
 else throw Error('Choose a collection action.');next.version=input.version+1;return next;
}
