import type {State,Item} from './model.ts';
import {scheduleDay,scheduleLocked,travelEstimate,type TravelMode} from './schedule.ts';
import {matrixMinutes,type TravelMatrix} from './route-matrix.ts';
export function selectedScheduleChanges(state:State,changes:{itemId:string;start:string}[],selected:unknown,mode:TravelMode,matrix?:TravelMatrix,requiredId?:string){
 if(selected===undefined)return changes;
 if(!Array.isArray(selected)||!selected.length||selected.length>changes.length||new Set(selected).size!==selected.length||selected.some(id=>typeof id!=='string'||!changes.some(c=>c.itemId===id))||requiredId&&changes.some(c=>c.itemId===requiredId)&&!selected.includes(requiredId))throw Error('Choose the moved activity and only changes from this preview.');
 const chosen=changes.filter(c=>selected.includes(c.itemId));if(chosen.length===changes.length)return chosen;
 const hypothetical=state.items.map(i=>({...i,start:chosen.find(c=>c.itemId===i.id)?.start??i.start}));
 for(const change of chosen){const item=hypothetical.find(i=>i.id===change.itemId)!;if(scheduleLocked(item,state))throw Error('A fixed booking cannot be changed here.');
  const day=scheduleDay(item,state.plan.timezone),neighbors=hypothetical.filter(i=>i.id!==item.id&&!i.financialOnly&&i.status!=='cancelled'&&i.category!=='Preparation'&&scheduleDay(i,state.plan.timezone)===day&&i.participants.some(id=>item.participants.includes(id))).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  if(neighbors.some(i=>Date.parse(item.start)<Date.parse(i.start)+i.duration*60000&&Date.parse(i.start)<Date.parse(item.start)+item.duration*60000))throw Error('Keeping those times creates an overlap. Include the connected changes or choose a different position.');
  const previous=neighbors.filter(i=>Date.parse(i.start)<Date.parse(item.start)).at(-1),next=neighbors.find(i=>Date.parse(i.start)>Date.parse(item.start));
  for(const [from,to]of [[previous,item],[item,next]] as [Item|undefined,Item|undefined][]){if(!from||!to)continue;const value=matrix?matrixMinutes(matrix,from,to,mode):travelEstimate(from,to,mode).minutes;if(value===undefined||value===null)throw Error('The selected changes need a fresh mapped travel check.');const gap=(Date.parse(to.start)-Date.parse(from.start))/60000-from.duration;if(gap<value+(matrix?10:0))throw Error('Keeping those times leaves too little travel time. Include the connected changes or choose a different position.');}
 }
 return chosen;
}
