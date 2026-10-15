import type {State,Suggestion,Item} from './model.ts';
import {validPoint,itineraryStops} from './itinerary-map.ts';
import {localDateTime,tripDays,zonedStart} from './trip-time.ts';
import type {TravelMode} from './schedule.ts';
export const dayPalette=['#315be8','#a63eb3','#087f78','#bc5413','#6949bf','#b32550','#236887','#66701b'];
export function stopDay(item:Pick<Item,'start'>,zone:string){return localDateTime(item.start,zone).slice(0,10);}
export function dayColor(state:State,day:string){return dayPalette[Math.max(0,tripDays(state.plan.start,state.plan.end).indexOf(day))%dayPalette.length];}
export function directionsUrl(items:Pick<Item,'latitude'|'longitude'>[],mode:TravelMode='walk'){
 if(!items.length||items.length>(mode==='transit'?2:5)||!items.every(validPoint))return undefined;
 const point=(item:typeof items[number])=>`${item.latitude},${item.longitude}`,url=new URL('https://www.google.com/maps/dir/');
 url.searchParams.set('api','1');url.searchParams.set('travelmode',mode==='drive'?'driving':mode==='transit'?'transit':'walking');if(items.length>1)url.searchParams.set('origin',point(items[0]));url.searchParams.set('destination',point(items.at(-1)!));if(items.length>2)url.searchParams.set('waypoints',items.slice(1,-1).map(point).join('|'));return url.href;
}
export function dayDirections(state:State,day:string,mode:TravelMode='walk'){
 const stops=itineraryStops(state).filter(s=>stopDay(s.item,state.plan.timezone)===day),routes:{url:string;label:string}[]=[];
 // Never silently skip an unknown location between two stops.
 for(let i=0;i<stops.length;){if(!validPoint(stops[i].item)){i++;continue;}let end=i+1;while(end<stops.length&&validPoint(stops[end].item))end++;
  const increment=mode==='transit'?1:4;for(let start=i;start<end-1;start+=increment){const chunk=stops.slice(start,Math.min(start+(mode==='transit'?2:5),end));routes.push({url:directionsUrl(chunk.map(s=>s.item),mode)!,label:`Stops ${chunk[0].number}–${chunk.at(-1)!.number}`});}i=end;
 }return routes;
}
export function suggestedVisit(state:State,idea:Suggestion,day:string){
 if(!idea.flexible)return idea.start;
 if(!tripDays(state.plan.start,state.plan.end).includes(day))throw Error('Choose a day within this plan.');
 let instant=Date.parse(zonedStart(`${day}T10:00`,state.plan.timezone));
 const items=itineraryStops(state).filter(s=>stopDay(s.item,state.plan.timezone)===day).map(s=>s.item);
 for(const item of items){const start=Date.parse(item.start),end=start+item.duration*60000;if(instant+idea.duration*60000<=start-15*60000)break;if(instant<end+15*60000)instant=end+15*60000;}
 if(stopDay({start:new Date(instant+idea.duration*60000-1).toISOString()},state.plan.timezone)!==day)throw Error('This day is full. Choose another day or adjust an activity.');
 return zonedStart(localDateTime(new Date(instant).toISOString(),state.plan.timezone),state.plan.timezone);
}
