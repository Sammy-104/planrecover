import {cachedTravelMatrix} from './routed-travel';
import {wholeTripDraft,journeyStays,validateJourney,transferDays,type JourneyInput} from './whole-trip';
import {tripCatalog,type State} from './model';
import {itemDay} from './city-stays';
import type {TravelMatrix} from './route-matrix';
import {validPoint} from './itinerary-map';
import {visibleWorkspace} from './privacy';
export async function checkedJourney(state:State,actor:string,input:JourneyInput,origin:string){
 validateJourney(input,state);const matrices:Record<string,TravelMatrix>={},pending:string[]=[],catalog=tripCatalog(state),transfers=new Set(transferDays(state).map(t=>t.day));
 for(const stay of journeyStays(state)){
  const chosen=input.selections.find(s=>s.stayId===stay.id);if(!chosen?.ids.length)continue;const items=state.items.filter(i=>i.status!=='cancelled'&&!i.financialOnly&&i.category!=='Preparation'&&itemDay(i,state.plan.timezone)>=stay.start&&itemDay(i,state.plan.timezone)<=stay.end&&!transfers.has(itemDay(i,state.plan.timezone)));
  const points=[...chosen.ids.map(id=>catalog.find(c=>c.id===id)!),...items];if(points.some(p=>!validPoint(p)))throw Error('Confirm the saved activity locations in '+stay.destination+' before building routed times.');if(points.length>80)throw Error('This city has too many scheduled locations for one route check. Choose fewer places.');const result=await cachedTravelMatrix(points,input.mode,origin);if(result.pending){pending.push(stay.destination);continue;}if(!result.matrix)throw Error('Routes for '+stay.destination+' are unavailable. Retry the preview.');matrices[stay.id]=result.matrix;
 }
 if(pending.length)return {pending:true,pendingCities:pending};const visible=visibleWorkspace(state,actor),draft=wholeTripDraft(visible,actor,input,matrices);return {pending:false,draft};
}
