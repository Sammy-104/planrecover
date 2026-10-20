import {applyAction,planMembers,type State,type Suggestion,type Action} from './model.ts';
import {bestSuggestionSlot,evaluateInsertion} from './suggestion-planning.ts';
import {zonedStart,localDateTime} from './trip-time.ts';
import {validLocalDateTime} from './time-input.ts';

/** Each selected visit is placed against the visits already reviewed in this batch. */
export function previewSuggestionBatch(state:State,actor:string,selected:Suggestion[],day:string,overrides:Record<string,string>={}){
 let working=structuredClone(state);const entries:{suggestion:Suggestion;action:Omit<Action,'actor'>;issues:string[];error:string}[]=[];
 if(!selected.length||selected.length>12)throw Error('Select between 1 and 12 ideas.');
 if(new Set(selected.map(c=>c.id)).size!==selected.length)throw Error('Select each idea once.');
 const memberIds=planMembers(state).filter(p=>!['viewer','legacy'].includes(p.role)).map(p=>p.id);
 for(const original of selected){
  const participants=original.suggestedParticipants?.filter(id=>memberIds.includes(id))??memberIds;
  let suggestion=original,issues:string[]=[],error='',action:Omit<Action,'actor'>={type:'add_suggestion',suggestionId:original.id,participants};
  try{
   const already=state.items.some(i=>i.status!=='cancelled'&&(i.ideaId===original.id||i.name.toLowerCase()===original.name.toLowerCase()));
   if(already)throw Error('This idea is already in your itinerary.');
   suggestion=bestSuggestionSlot(working,{...original,suggestedParticipants:participants},actor,day);
   if(overrides[original.id]!==undefined){
    if(!validLocalDateTime(overrides[original.id],true))throw Error('Enter a valid date and time.');
    suggestion={...suggestion,start:zonedStart(overrides[original.id],suggestion.timezone??state.plan.timezone)};
   }
   const visitDay=localDateTime(suggestion.start,suggestion.timezone??state.plan.timezone).slice(0,10);
   const evaluation=evaluateInsertion(working,suggestion,{actor,participants,day:visitDay,start:suggestion.start,duration:suggestion.duration});
   issues=evaluation.issues;if(evaluation.status==='blocked')throw Error(issues[0]??'Choose another time.');
   action={...action,start:suggestion.start,duration:suggestion.duration,buffer:evaluation.buffer};
   working=applyAction(working,{...action,type:String(action.type),actor} as Action);
  }catch(e){error=(e as Error).message;}
  entries.push({suggestion,action,issues,error});
 }
 return {entries,blocked:entries.some(e=>!!e.error)};
}
