import {z} from 'zod';
import {awsJson} from './aws-adapters.ts';
import type {Env} from './http-adapters.ts';
const point=z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)]);
export const locationRequest=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('search'),query:z.string().trim().min(1).max(200),bias:point,maxResults:z.number().int().min(1).max(10).default(5)}).strict(),
 z.object({operation:z.literal('route'),origin:point,destination:point,travelMode:z.enum(['Car','Pedestrian']).default('Car')}).strict(),
]);
export async function queryAmazonLocation(env:Env,input:z.infer<typeof locationRequest>,fetcher:typeof fetch=fetch){
 if(input.operation==='search'){const raw=await awsJson(env,'geo-places','SearchText',{QueryText:input.query,BiasPosition:input.bias,MaxResults:input.maxResults,IntendedUse:'SingleUse'},{fetch:fetcher});
  const result=z.object({ResultItems:z.array(z.object({PlaceId:z.string().max(500),Title:z.string().max(500),Position:point,Address:z.object({Label:z.string().max(1000).optional()}).passthrough().optional()}).passthrough()).max(100)}).passthrough().parse(raw);
  return {provider:'amazon-location',results:result.ResultItems.slice(0,input.maxResults).map(p=>({id:p.PlaceId,name:p.Title,position:p.Position,address:p.Address?.Label??null})),storage:'single-use',price:null,availability:'unknown',bookingAuthority:false};
 }
 const raw=await awsJson(env,'geo-routes','CalculateRoutes',{Origin:input.origin,Destination:input.destination,TravelMode:input.travelMode,MaxAlternatives:0},{fetch:fetcher});
 const result=z.object({Routes:z.array(z.object({Summary:z.object({Distance:z.number().nonnegative(),Duration:z.number().nonnegative()}).passthrough()}).passthrough()).max(10)}).passthrough().parse(raw);
 return {provider:'amazon-location',routes:result.Routes.map(r=>({distanceMetres:r.Summary.Distance,durationSeconds:r.Summary.Duration})),bookingAuthority:false};
}
