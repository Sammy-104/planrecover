import tzLookup from '@photostructure/tz-lookup';
import type {CitySelection} from './city-search.ts';
import {cityProfile} from './cities.ts';
import {suggestedCurrency} from './money.ts';

export function destinationSettings(destination:string,city?:CitySelection){
 const profile=cityProfile(destination,city);let timezone=profile?.timezone;
 if(city){try{const inferred=tzLookup(city.latitude,city.longitude);new Intl.DateTimeFormat('en',{timeZone:inferred});timezone=inferred;}catch{}}
 return {timezone,currency:suggestedCurrency(city?.country??profile?.country)};
}
export function validTimezone(value:unknown){if(typeof value!=='string'||value.length>100)throw Error('Choose a valid time zone.');try{new Intl.DateTimeFormat('en',{timeZone:value});}catch{throw Error('Choose a valid time zone.');}return value;}
export const worldTimezones=[...new Set(['UTC',...Intl.supportedValuesOf('timeZone')])].sort();
