import {applyAction,planMembers,type State,type Action} from './model';
import {checkedJourney} from './whole-trip-server';
import {draftTravelMatrix} from './schedule-preview';
import {draftCityState} from './city-stays';
import {prepareSuggestionAction} from './suggestion-preview';
import {prepareScheduleAction} from './schedule-preview';
/** Bind any external route checks to the saved state before draft mutation. */
export async function prepareFrontendAction(state:State,actor:string,action:Action,origin:string):Promise<Action>{
 const next:Action={...action,actor};
 if(action.type==='move_item'||action.type==='optimize_order')await prepareScheduleAction(state,next,origin);
 if(action.type==='apply_journey'){
  const result=await checkedJourney(state,actor,action.input as Parameters<typeof checkedJourney>[2],origin);
  if(result.pending||!('draft'in result)||!result.draft)throw Error('The routes are still being checked. Preview this trip again.');
  if(result.draft.fingerprint!==action.fingerprint)throw Error('The itinerary changed. Preview this trip again.');
  next._journeyEntries=result.draft.entries.map(e=>({suggestionId:e.suggestionId,start:e.start,duration:e.duration}));
 }
 if(action.type==='apply_draft'){
  const entries=action.entries as {suggestionId:string;start:string;duration:number}[],scoped=draftCityState(state,String(action.planningDay??state.plan.start));
  const days=[...new Set(entries.map(e=>e.start.slice(0,10)))],routes=await draftTravelMatrix(scoped,entries.map(e=>e.suggestionId),days,action.travelMode==='drive'?'drive':'walk',origin);
  if(!routes.matrix)throw Error('Mapped routes are not ready. Preview the draft again.');
  const checked=[];let working=state;const participants=planMembers(state).filter(p=>!['viewer','legacy'].includes(p.role)).map(p=>p.id);
  for(const entry of entries){const addition:Action={type:'add_suggestion',actor,suggestionId:entry.suggestionId,start:entry.start,duration:entry.duration,participants};await prepareSuggestionAction(working,addition,origin,routes.matrix);working=applyAction(working,addition);checked.push(entry);}
  next._draftEntries=checked;
 }
 return next;
}
