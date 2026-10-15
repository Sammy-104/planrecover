import type {State} from './model.ts';
import {PLACE_DETAILS_VERSION,type PlaceLocation,type PlacePhoto} from './cities.ts';
export const validPoint=(value:{latitude?:number;longitude?:number})=>typeof value.latitude==='number'&&typeof value.longitude==='number'&&Number.isFinite(value.latitude)&&Number.isFinite(value.longitude)&&Math.abs(value.latitude)<=90&&Math.abs(value.longitude)<=180;
export function needsPlaceDetails(item:PlaceLocation&PlacePhoto&{policy:string}){const sourced=!!(item.wikiTitle||item.wikidataId||(!item.placeLookupManual&&/https:\/\/en\.wikipedia\.org\/\?curid=\d+/.test(item.policy)));return !validPoint(item)||(sourced&&item.placeDetailsVersion!==PLACE_DETAILS_VERSION)||(sourced&&!item.imageUrl&&(!item.photoStatus||item.photoStatus==='retry'));}
// One sequence for the entire plan, shared by itinerary cards and map pins.
export function itineraryStops(state:State){return state.items.filter(item=>item.status!=='cancelled'&&item.category!=='Preparation').sort((a,b)=>new Date(a.start).getTime()-new Date(b.start).getTime()).map((item,index)=>({item,number:index+1}));}
