import {draftCityState} from './city-stays';
import {tripCatalog,isDemoTrip,type State,type Action} from './model';
import {previewMove,scheduleDay,type TravelMode} from './schedule';
import {optimizeDay,orderFingerprint} from './schedule-optimizer';
import {cachedTravelMatrix} from './routed-travel';
import {matrixFingerprint,type TravelMatrix} from './route-matrix';
import {starterDraft,starterInterests,type StarterPace} from './plan-starter';
import {tripDays} from './trip-time';
import {validPoint} from './itinerary-map';
import {visibleWorkspace} from './privacy';

const active=(state:State,days:string[])=>state.items.filter(i=>!i.financialOnly&&i.status!=='cancelled'&&i.category!=='Preparation'&&days.includes(scheduleDay(i,state.plan.timezone)));
export function moveFingerprint(state:State,itemId:string,day:string,beforeId:string|null,mode:TravelMode,actor:string,matrix?:TravelMatrix){const item=state.items.find(i=>i.id===itemId);return JSON.stringify([itemId,day,beforeId,mode,orderFingerprint(state,day,actor),item?orderFingerprint(state,scheduleDay(item,state.plan.timezone),actor):null])+(matrix?matrixFingerprint(matrix):'');}
export async function draftTravelMatrix(state:State,ids:string[],days:string[],mode:'walk'|'drive',origin:string){
 const catalog=tripCatalog(state),places=ids.map(id=>catalog.find(c=>c.id===id));if(places.some(p=>!p))throw Error('A selected place changed. Choose your places again.');
 const inputs=[...active(state,days),...places.filter((p):p is NonNullable<typeof p>=>!!p)];if(inputs.some(i=>!validPoint(i)))throw Error('Some activity locations are still unconfirmed. Wait for location lookup or choose mapped places before building routed times.');
 return cachedTravelMatrix(inputs,mode,origin);
}
export async function schedulePreview(state:State,body:Record<string,unknown>,actor:string,origin:string){
 const mode=String(body.travelMode??state.plan.scheduleTravelMode??'walk');if(!['walk','drive'].includes(mode))throw Error('Choose walking or driving. Transit timetables need checking separately.');
 const visible=visibleWorkspace(state,actor),demo=isDemoTrip(state),operation=String(body.operation??'order');if(!['order','move','starter'].includes(operation))throw Error('Choose a supported schedule preview.');let data:{matrix?:TravelMatrix;pending?:boolean;unavailable?:boolean}={};
 if(operation==='starter'){
  const scoped=draftCityState(state,body.day===undefined?state.plan.start:String(body.day)),scopedVisible=visibleWorkspace(scoped,actor);
  const ids=body.selectedIds;if(!Array.isArray(ids)||!ids.length||ids.length>12||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw Error('Choose 1–12 distinct places.');
  const interests=Array.isArray(body.interests)?body.interests.filter((tag):tag is string=>typeof tag==='string'&&starterInterests.some(i=>i.tag===tag)):[],pace=String(body.pace??'balanced');if(!['relaxed','balanced','busy'].includes(pace))throw Error('Choose a valid pace.');
  if(!demo)data=await draftTravelMatrix(scoped,ids,tripDays(scoped.plan.start,scoped.plan.end).slice(0,7),mode as 'walk'|'drive',origin);if(!demo&&!data.matrix)return {...data,version:state.version};
  return {draft:{...starterDraft(scopedVisible,actor,ids,interests,pace as StarterPace,data.matrix),routeSourceIds:ids},...data,version:state.version};
 }
 const day=String(body.day??'');if(!tripDays(state.plan.start,state.plan.end).includes(day))throw Error('Choose a day within this plan.');
 const moving=operation==='move'?state.items.find(i=>i.id===body.itemId):undefined;if(operation==='move'&&!moving)throw Error('Activity not found.');
 const inputs=[...active(state,[day]),...(moving?[moving]:[])];if(inputs.some(i=>!validPoint(i))&&!demo)throw Error('Some activity locations are still unconfirmed. Wait for location lookup or choose mapped places before routed scheduling.');
 if(!demo)data=await cachedTravelMatrix(inputs,mode as 'walk'|'drive',origin);if(!demo&&!data.matrix)return {...data,version:state.version};
 if(operation==='order')return {preview:optimizeDay(visible,day,mode as TravelMode,actor,data.matrix),...data,version:state.version};
 if(operation!=='move')throw Error('Choose a supported schedule preview.');const beforeId=body.beforeId==null?null:String(body.beforeId),changes=previewMove(visible,moving!.id,day,beforeId,mode as TravelMode,data.matrix,actor);
 return {preview:{changes,day,mode,fingerprint:moveFingerprint(visible,moving!.id,day,beforeId,mode as TravelMode,actor,data.matrix),basis:demo?'estimate':'route',bufferMinutes:data.matrix?10:0},...data,version:state.version};
}
export async function prepareScheduleAction(state:State,action:Action,origin:string){
 const result=await schedulePreview(state,{...action,operation:action.type==='move_item'?'move':'order'},action.actor,origin);
 if(result.pending)throw Error('Routes are busy. Try the preview again in a moment.');if(result.unavailable)throw Error('Mapped routes could not load. Retry before applying an automatic schedule change.');
 if(!('preview' in result)||!result.preview||(!(isDemoTrip(state)&&action.type==='move_item'&&action.fingerprint==null)&&action.fingerprint!==result.preview.fingerprint))throw Error('The itinerary or route times changed. Review a fresh preview.');
 action._travelMatrix=result.matrix;return result;
}
