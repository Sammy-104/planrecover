import type {State,Item} from './model.ts';
import {itineraryStops,validPoint} from './itinerary-map.ts';
import {stopDay} from './map-planning.ts';
import type {TravelMode} from './schedule.ts';

export type TravelLeg={from:string;to:string;minutes:number;km:number;coordinates:[number,number][]};
export type RouteResult={legs:TravelLeg[];pending?:boolean;unavailable?:boolean};
export function routeSegments(state:State,day:string){
 const segments:Item[][]=[];let current:Item[]=[];
 function flush(){if(current.length>1)segments.push(current);current=[];}
 for(const {item} of itineraryStops(state).filter(s=>stopDay(s.item,state.plan.timezone)===day)){
  if(!validPoint(item)){flush();continue;}current.push(item);
  if(current.length===32){flush();current=[item];}
 }flush();return segments;
}
export function routeUrl(items:Item[],mode:TravelMode){
 if(!['walk','drive'].includes(mode)||items.length<2||items.length>32||!items.every(validPoint))throw Error('Choose mapped stops and a walking or driving route.');
 const points=items.map(item=>`${item.longitude!.toFixed(6)},${item.latitude!.toFixed(6)}`).join(';');
 return `https://routing.openstreetmap.de/routed-${mode==='walk'?'foot':'car'}/route/v1/driving/${points}?overview=false&steps=true&geometries=geojson&generate_hints=false`;
}
export function readRoute(body:any,items:Item[]):TravelLeg[]{
 const route=body?.routes?.[0];if(body?.code!=='Ok'||!route||route.legs?.length!==items.length-1)throw Error('No usable route found.');
 // Reject a route snapped far away from the actual place.
 if(body.waypoints?.length!==items.length||body.waypoints.some((p:any)=>!Number.isFinite(p.distance)||p.distance>1000))throw Error('An activity is too far from a mapped road or path.');
 return route.legs.map((leg:any,index:number)=>{
  if(!Number.isFinite(leg.duration)||leg.duration<0||!Number.isFinite(leg.distance)||leg.distance<0)throw Error('Route duration unavailable.');
  const points=leg.steps?.flatMap((step:any)=>step.geometry?.type==='LineString'?step.geometry.coordinates:[])??[];
  if(points.length<2||points.length>50000||points.some((p:any)=>!Array.isArray(p)||!validPoint({latitude:p[1],longitude:p[0]})))throw Error('Route path unavailable.');
  return {from:items[index].id,to:items[index+1].id,minutes:Math.max(1,Math.ceil(leg.duration/60)),km:leg.distance/1000,coordinates:points.map((p:number[])=>[p[1],p[0]])};
 });
}
