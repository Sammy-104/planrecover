'use client';
import {useEffect,useRef,useState} from 'react';
import {MapPin,LoaderCircle,Search} from 'lucide-react';
import {Combobox,ComboboxInput,ComboboxContent,ComboboxList,ComboboxItem} from '@/components/ui/combobox';
import {rankPlaces,placeDistance} from '@/lib/place-match';
import type {CityPlace} from '@/lib/cities';

export type PlaceChoice=Pick<CityPlace,'id'|'name'|'area'|'description'|'tags'|'sourceLabel'|'latitude'|'longitude'|'cuisines'|'admission'>;
export function ActivitySearch({value,onChange,places,tripId,destination,cityName,disabled,onChoose,lookup,radiusKm=20,cityPoint,originLabel='city centre'}:{value:string;onChange:(value:string)=>void;places:PlaceChoice[];tripId:string;destination:string;cityName:string;disabled:boolean;onChoose:(place:PlaceChoice,query:string)=>Promise<void>;lookup:(query:string,signal:AbortSignal,refresh?:boolean)=>Promise<{places:CityPlace[];unavailable:boolean}>;originLabel?:string;radiusKm?:number;cityPoint?:{latitude:number;longitude:number}}){
 const [remote,setRemote]=useState<PlaceChoice[]>([]),[loading,setLoading]=useState(false),[note,setNote]=useState(''),[selected,setSelected]=useState<PlaceChoice|null>(null);
 const lastSelection=useRef(''),container=useRef<HTMLDivElement>(null),lookupRef=useRef(lookup);lookupRef.current=lookup;
 const [retry,setRetry]=useState(0),[failed,setFailed]=useState(false);
 const query=value.trim(),local=query.length>=2?rankPlaces(places,query,cityName,cityPoint,radiusKm).slice(0,8):[];
 const matches=rankPlaces([...local,...remote],query,cityName,cityPoint,radiusKm).slice(0,12);
 useEffect(()=>setRetry(0),[query,tripId,destination,radiusKm,cityPoint?.latitude,cityPoint?.longitude]);
 useEffect(()=>{
  const life=new AbortController();let retryTimer:ReturnType<typeof setTimeout>|undefined;setRemote([]);setLoading(false);setNote('');setFailed(false);
  if(query.length<3||query===lastSelection.current||disabled)return;
  // A quiet typing pause keeps requests within the free service's fair-use allowance.
  const unavailable=(refresh:boolean)=>{if(life.signal.aborted)return;setNote(refresh?'Live search is temporarily unavailable. Saved places still work.':'Live search is taking a moment. Retrying automatically…');setFailed(refresh);if(!refresh)retryTimer=setTimeout(()=>void run(true),2000);};
  const run=async(refresh:boolean)=>{setLoading(true);try{const result=await lookupRef.current(query,life.signal,refresh);if(life.signal.aborted)return;setRemote(result.places);if(result.unavailable)unavailable(refresh);else{setFailed(false);setNote(!result.places.length?'No live matches in this area. Try another name or widen the search.':'');}}catch{unavailable(refresh);}finally{if(!life.signal.aborted)setLoading(false);}};
  const timer=setTimeout(()=>void run(retry>0),800);
  return()=>{clearTimeout(timer);clearTimeout(retryTimer);life.abort();};
 },[query,tripId,destination,disabled,radiusKm,retry,cityPoint?.latitude,cityPoint?.longitude]);
 return <div className="activity-autocomplete" ref={container}><Combobox items={matches} value={selected} inputValue={value} filter={null} itemToStringLabel={place=>place.name} isItemEqualToValue={(a,b)=>a.id===b.id}
  onInputValueChange={(text,details)=>{if(details.reason==='input-clear'){details.cancel();return;}if(['input-change','clear-press'].includes(details.reason)){lastSelection.current='';setSelected(null);onChange(text);}}}
  onValueChange={place=>{if(place){const searched=query;lastSelection.current=place.name;setSelected(place);setRemote([]);setNote('');onChange(place.name);void onChoose(place,searched);}}}>
  <ComboboxInput className="activity-search-input" aria-label="Search activities in this city" placeholder="Search a place, cuisine or activity" maxLength={100} autoComplete="off" showTrigger={false} disabled={disabled}><Search size={20}/></ComboboxInput>
  {matches.length>0&&<ComboboxContent portalContainer={container} className="place-results"><ComboboxList>{(place:PlaceChoice)=>{const km=cityPoint?placeDistance(cityPoint,place):undefined;return <ComboboxItem value={place} key={place.id}><MapPin size={18}/><span><strong>{place.name}</strong><small>{place.area}{km!==undefined&&` · ${km.toFixed(1)} km from ${originLabel}`}</small></span></ComboboxItem>;}}</ComboboxList><p className="city-attribution">Mapped places: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p></ComboboxContent>}
 </Combobox>{loading&&<small className="city-search-status" role="status"><LoaderCircle size={14} className="spin"/>Looking for nearby places…</small>}{note&&<small className="city-search-status" role="status">{note}{failed&&<button type="button" className="text-button" onClick={()=>setRetry(value=>value+1)}>Retry place search</button>}</small>}</div>;
}
