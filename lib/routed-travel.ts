import {matrixUrl,matrixPoints,readMatrix,type TravelMatrix,type RoutePoint} from './route-matrix';
import type {Item} from './model';
import {routeUrl,readRoute,type RouteResult} from './travel-routes';
import {db} from './store';

export async function cachedTravelRoute(items:Item[],mode:'walk'|'drive',origin:string):Promise<RouteResult>{
 if(items.length<2)return {legs:[]};
 const url=routeUrl(items,mode),key=new URL('/__public_route_v1',origin);key.searchParams.set('route',url);
 const cache=(globalThis.caches as CacheStorage&{default?:Cache})?.default;
 try{const cached=await cache?.match(key.href);if(cached)return {legs:readRoute(await cached.json(),items)};}catch{}
 const now=Date.now(),slot=await db().prepare('INSERT INTO route_provider_slots (id,next_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET next_at=excluded.next_at WHERE route_provider_slots.next_at <= ?').bind('fossgis-osrm',now+1200,now).run();
 if(!slot.meta.changes)return {legs:[],pending:true};
 try{const response=await fetch(url,{headers:{'User-Agent':'PlanRecoverBeta/1.0 (itinerary routing; https://planrecover-beta.goodluckimmigrations.chatgpt.site)'},signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Route provider unavailable.');const body=await response.json(),legs=readRoute(body,items);try{await cache?.put(key.href,Response.json(body,{headers:{'Cache-Control':'public, max-age=86400'}}));}catch{}return {legs};}catch{return {legs:[],unavailable:true};}
}

export async function cachedTravelMatrix(items:RoutePoint[],mode:'walk'|'drive',origin:string):Promise<{matrix?:TravelMatrix;pending?:boolean;unavailable?:boolean}>{
 const points=matrixPoints(items);if(points.length<2)return {matrix:{mode,points,minutes:points.map(()=>[0]),checkedAt:new Date().toISOString()}};
 const url=matrixUrl(items,mode),key=new URL('/__public_travel_matrix_v1',origin);key.searchParams.set('route',url);const cache=(globalThis.caches as CacheStorage&{default?:Cache})?.default;
 try{const cached=await cache?.match(key.href);if(cached)return {matrix:readMatrix(await cached.json(),items,mode)};}catch{}
 const now=Date.now(),slot=await db().prepare('INSERT INTO route_provider_slots (id,next_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET next_at=excluded.next_at WHERE route_provider_slots.next_at <= ?').bind('fossgis-osrm',now+1200,now).run();if(!slot.meta.changes)return {pending:true};
 try{const response=await fetch(url,{headers:{'User-Agent':'PlanRecoverBeta/1.0 (routed planning; https://planrecover-beta.goodluckimmigrations.chatgpt.site)'},signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Route provider unavailable.');const body=await response.json(),matrix=readMatrix(body,items,mode);try{await cache?.put(key.href,Response.json(body,{headers:{'Cache-Control':'public, max-age=86400'}}));}catch{}return {matrix};}catch{return {unavailable:true};}
}
