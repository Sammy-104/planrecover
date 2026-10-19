import {dayCity,cityHotels} from './city-stays.ts';
import {placeQuery} from './place-query.ts';
import type {State} from './model.ts';
import {validPoint} from './itinerary-map.ts';
export function discoveryOrigin(state:State,anchorId?:string,day=state.plan.start,stayId?:string){
 const city=dayCity(state,day,stayId).city;if(!anchorId)return city?{latitude:city.latitude,longitude:city.longitude}:undefined;
 const item=cityHotels(state,day,stayId).find(i=>i.id===anchorId);
 if(!item||!validPoint(item))throw Error('Choose an accommodation with a confirmed map location.');
 return {latitude:item.latitude!,longitude:item.longitude!};
}

export function queryAnchor(state:State,anchorId:string|undefined,query:string,day=state.plan.start,stayId?:string){if(!placeQuery(query).nearHotel)return anchorId;const hotel=cityHotels(state,day,stayId).find(i=>i.id===anchorId&&validPoint(i))??cityHotels(state,day,stayId).find(validPoint);if(!hotel)throw Error('Add an accommodation with a map location to search near your hotel.');return hotel.id;}
