import type {TravelMatrix} from './route-matrix';
import {tripCatalog,cents,type State,type Action,type Item} from './model';
import {visibleWorkspace} from './privacy';
import {evaluateInsertion,adjacentStops,type PlanningOptions} from './suggestion-planning';
import {cachedTravelRoute} from './routed-travel';
import {validPoint} from './itinerary-map';
import {localDateTime} from './trip-time';
import {mappedVenueInfo,mappedVenueId} from './mapped-place-info';
import {freshPlaceInfo,mergePlaceInfo,placeInfo} from './place-info';

export async function suggestionPreview(state:State,body:Record<string,unknown>,actor:string,origin:string,matrix?:TravelMatrix,sourceOptions:{request?:typeof fetch}={}){
 const suggestion=tripCatalog(state).find(c=>c.id===body.suggestionId);if(!suggestion)throw Error('This place is no longer available in the plan.');
 const ids=body.participants as string[];if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!Object.keys(state.preferences).includes(id)))throw Error('Choose valid participants.');
 let c={...suggestion};if(c.flexible&&!freshPlaceInfo(c)&&mappedVenueId(c)){const details=await mappedVenueInfo(c,sourceOptions.request??fetch);c=mergePlaceInfo(c,'detailsCheckedAt' in details?details:{detailsSnapshotComplete:true,detailsExpiresAt:new Date().toISOString()});}
 const start=c.flexible?String(body.start??c.start):c.start,duration=c.flexible?Number(body.duration??c.duration):c.duration,buffer=c.flexible?Number(body.buffer??15):c.buffer,mode=String(body.travelMode??state.plan.scheduleTravelMode??'walk');
 if(!['walk','drive','transit'].includes(mode))throw Error('Choose walking, driving or transit.');
 const options:PlanningOptions={actor,participants:ids,day:localDateTime(start,c.timezone??state.plan.timezone).slice(0,10),start,duration,buffer,mode:mode as PlanningOptions['mode'],price:c.flexible&&body.priceEstimate!==undefined?body.priceEstimate===null?null:cents(body.priceEstimate):c.price,extraCost:body.extraCost==null?null:cents(body.extraCost)};
 const {previous,next}=adjacentStops(state,c,start,duration,ids),place={...c,start,duration} as unknown as Item;
 const points=[...(previous?[previous]:[]),place,...(next?[next]:[])],canRoute=mode!=='transit'&&points.length>1&&points.every(validPoint);
 const routes=canRoute&&!matrix?await cachedTravelRoute(points,mode as 'walk'|'drive',origin):{legs:[]};options.routes=routes.legs;options.matrix=matrix;
 const visible=visibleWorkspace(state,actor),evaluation=evaluateInsertion(visible,c,options);
 return {evaluation,pending:!!routes.pending,unavailable:!!routes.unavailable,version:state.version,details:placeInfo(c),options};
}
export async function prepareSuggestionAction(state:State,action:Action,origin:string,matrix?:TravelMatrix){
 const result=await suggestionPreview(state,action,action.actor,origin,matrix);
 if(result.evaluation.status==='blocked')throw Error(result.evaluation.issues[0]);
 action._insertion={...result.evaluation,details:result.details};
 return result;
}
