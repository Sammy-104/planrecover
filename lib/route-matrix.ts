import {validPoint} from './itinerary-map.ts';
import type {TravelMode} from './schedule.ts';
export type RoutePoint={latitude?:number;longitude?:number};
export type TravelMatrix={mode:'walk'|'drive';points:string[];minutes:(number|null)[][];checkedAt:string};
export const pointKey=(point:RoutePoint)=>validPoint(point)?point.longitude!.toFixed(6)+','+point.latitude!.toFixed(6):undefined;
export function matrixPoints(items:RoutePoint[]){return [...new Set(items.map(pointKey).filter((p):p is string=>!!p))].sort();}
export function matrixUrl(items:RoutePoint[],mode:TravelMode){
 if(!['walk','drive'].includes(mode))throw Error('Choose walking or driving for routed planning.');
 const points=matrixPoints(items);if(points.length<2||points.length>80)throw Error('Routed planning supports 2–80 mapped locations at a time.');
 return 'https://routing.openstreetmap.de/routed-'+(mode==='walk'?'foot':'car')+'/table/v1/driving/'+points.join(';')+'?annotations=duration&generate_hints=false';
}
export function readMatrix(body:any,items:RoutePoint[],mode:'walk'|'drive'):TravelMatrix{
 const points=matrixPoints(items),count=points.length,waypoints=body?.sources;
 if(body?.code!=='Ok'||body.fallback_speed_cells?.length||!Array.isArray(body.durations)||body.durations.length!==count||!Array.isArray(waypoints)||waypoints.length!==count||!Array.isArray(body.destinations)||body.destinations.length!==count)throw Error('No usable travel-time matrix was returned.');
 if([...waypoints,...body.destinations].some((p:any)=>!Number.isFinite(p.distance)||p.distance>1000))throw Error('An activity is too far from a mapped road or path.');
 const minutes=body.durations.map((row:any,i:number)=>{if(!Array.isArray(row)||row.length!==count)throw Error('Incomplete travel-time matrix.');return row.map((seconds:any,j:number)=>{if(seconds===null)return null;if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0)throw Error('Invalid routed travel time.');return i===j?0:Math.max(1,Math.ceil(seconds/60));});});
 return {mode,points,minutes,checkedAt:new Date().toISOString()};
}
export function matrixMinutes(matrix:TravelMatrix,a:RoutePoint,b:RoutePoint,mode:TravelMode=matrix.mode){
 if(mode!==matrix.mode)throw Error('Travel mode changed. Check a fresh route.');
 const from=pointKey(a),to=pointKey(b),i=from?matrix.points.indexOf(from):-1,j=to?matrix.points.indexOf(to):-1;
 if(i<0||j<0)return undefined;const value=matrix.minutes[i]?.[j];return i===j&&value===0?1:value;
}
export function routedMinutes(matrix:TravelMatrix,a:RoutePoint,b:RoutePoint,mode:TravelMode=matrix.mode){const value=matrixMinutes(matrix,a,b,mode);if(value===undefined)throw Error('An activity location needs checking before routed scheduling.');if(value===null)throw Error('No mapped route connects these activities. Choose different stops or travel mode.');return value;}
export function matrixFingerprint(matrix:TravelMatrix){return JSON.stringify([matrix.mode,matrix.points,matrix.minutes]);}
