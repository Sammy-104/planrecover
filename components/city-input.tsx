'use client';
import {useEffect,useRef,useState} from 'react';
import {MapPin,LoaderCircle} from 'lucide-react';
import {Combobox,ComboboxInput,ComboboxContent,ComboboxList,ComboboxItem} from '@/components/ui/combobox';
import type {CitySelection} from '@/lib/city-search';

export function CityInput({value,onChange,label='City and country'}:{value:string;onChange:(value:string,city?:CitySelection)=>void;label?:string}){
 const [cities,setCities]=useState<CitySelection[]>([]),[selected,setSelected]=useState<CitySelection|null>(null),[loading,setLoading]=useState(false),[note,setNote]=useState('');
 const lastSelection=useRef(''),container=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const query=value.trim();const life=new AbortController();
  if(query===lastSelection.current){setNote('');setLoading(false);return;}
  setCities([]);setNote('');setLoading(false);
  if(query.length<2)return;
  const timer=setTimeout(async()=>{
   setLoading(true);
   try{const response=await fetch(`/api/cities?q=${encodeURIComponent(query)}`,{signal:life.signal}),body=await response.json() as {cities?:CitySelection[];error?:string};
    if(life.signal.aborted)return;
    if(!response.ok)throw Error(body.error??'City suggestions are unavailable.');
    const matches=body.cities??[];setCities(matches);if(!matches.length)setNote('No city matches. Try adding the country, or enter your location manually.');
   }catch(e){if(!life.signal.aborted)setNote('City suggestions are unavailable. You can still enter your location manually.');}
   finally{if(!life.signal.aborted)setLoading(false);}
  },450);
  return ()=>{clearTimeout(timer);life.abort();};
 },[value]);
 return <div className="city-autocomplete" ref={container}><Combobox items={cities} value={selected} inputValue={value} filter={null} itemToStringLabel={city=>city.label} isItemEqualToValue={(a,b)=>a.id===b.id}
  onInputValueChange={(text,details)=>{if(details.reason==='input-change'||details.reason==='input-clear'||details.reason==='clear-press'){lastSelection.current='';setSelected(null);onChange(text);}}}
  onValueChange={city=>{if(city){lastSelection.current=city.label;setSelected(city);setCities([city]);setNote('');onChange(city.label,city);}}}>
  <ComboboxInput className="city-search-field" aria-label={label} placeholder="Type 2 letters, e.g. To or Li" maxLength={120} autoComplete="off" showTrigger={false}/>
  {cities.length>0&&<ComboboxContent portalContainer={container} className="city-results"><ComboboxList>{(city:CitySelection)=><ComboboxItem value={city} key={city.id}><MapPin size={17}/><span><strong>{city.name}</strong><small>{[city.region,city.country].filter(Boolean).join(', ')}</small></span></ComboboxItem>}</ComboboxList><p className="city-attribution">City data: <a href="https://www.geonames.org" target="_blank" rel="noreferrer">GeoNames</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></p></ComboboxContent>}
 </Combobox>{loading&&<small className="city-search-status" role="status"><LoaderCircle size={13} className="spin"/>Finding cities…</small>}{note&&<small className="city-search-status" role="status">{note}</small>}</div>;
}
