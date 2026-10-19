'use client';
import {useEffect,useRef,useState} from 'react';
import {Globe2,LocateFixed,MapPin,LoaderCircle} from 'lucide-react';
import type {Map as LeafletMap,LayerGroup,Marker} from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {planType} from '@/lib/plan-types';
import {itineraryStops,validPoint} from '@/lib/itinerary-map';
import type {State,Item} from '@/lib/model';
import {dayColor,stopDay,dayDirections,directionsUrl} from '@/lib/map-planning';
import type {TravelLeg} from '@/lib/travel-routes';
import type {TravelMode} from '@/lib/schedule';

type Runtime={L:typeof import('leaflet');map:LeafletMap;markers:LayerGroup;routes:LayerGroup};
export function ItineraryMap({state,day=state.plan.start,onDay,travelMode='walk',findingLocations=false,locationUnavailable=false,routeLegs=[],selectedId=null,onSelect,onOpen}:{state:State;routeLegs?:TravelLeg[];day?:string;onDay?:(day:string)=>void;travelMode?:TravelMode;findingLocations?:boolean;locationUnavailable?:boolean;selectedId?:string|null;onSelect?:(id:string)=>void;onOpen?:(item:Item)=>void}){
 const container=useRef<HTMLDivElement>(null),runtime=useRef<Runtime|null>(null);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[tileIssue,setTileIssue]=useState(false);
 const markerIndex=useRef(new Map<string,Marker>()),callbacks=useRef({onSelect,onOpen});callbacks.current={onSelect,onOpen};
 const stops=itineraryStops(state),pins=stops.filter(s=>validPoint(s.item)),unmapped=stops.filter(s=>!validPoint(s.item));
 const mapDays=[...new Set([day,...stops.map(s=>stopDay(s.item,state.plan.timezone))])].sort(),directions=dayDirections(state,day,travelMode);
 const routeSignature=JSON.stringify(routeLegs);
 const pinSignature=pins.map(({item,number})=>[item.id,item.latitude,item.longitude,item.name,item.start,item.locationSourceUrl,item.locationPrecision,number].join('|')).join(';');
 useEffect(()=>{
  let cancelled=false,resize:ResizeObserver|undefined;
  void import('leaflet').then(module=>{
   if(cancelled||!container.current)return;const L=module.default??module;
   const map=L.map(container.current,{minZoom:0,maxZoom:19,worldCopyJump:true,scrollWheelZoom:true}).fitWorld();
   const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',keepBuffer:1}).addTo(map);
   tiles.on('tileerror',()=>{if(!cancelled)setTileIssue(true);});
   const routes=L.layerGroup().addTo(map),markers=L.layerGroup().addTo(map);runtime.current={L,map,markers,routes};setReady(true);
   resize=new ResizeObserver(()=>map.invalidateSize());resize.observe(container.current);
  }).catch(()=>{if(!cancelled)setError('The map could not load. Please reload the page.');});
  return()=>{cancelled=true;resize?.disconnect();runtime.current?.map.remove();runtime.current=null;};
 },[]);
 useEffect(()=>{
  const r=runtime.current;if(!r||!ready)return;r.markers.clearLayers();r.routes.clearLayers();markerIndex.current.clear();
  const dayStops=stops.filter(s=>stopDay(s.item,state.plan.timezone)===day);
  for(let i=1;i<dayStops.length;i++){const a=dayStops[i-1].item,b=dayStops[i].item;if(!validPoint(a)||!validPoint(b))continue;const route=routeLegs.find(leg=>leg.from===a.id&&leg.to===b.id);r.L.polyline(route?.coordinates??[[a.latitude!,a.longitude!],[b.latitude!,b.longitude!]],{color:dayColor(state,day),weight:route?5:2,dashArray:route?undefined:'5 9',opacity:route?.85:.5,interactive:false}).addTo(r.routes);}
  const groups=new Map<string,typeof pins>();for(const stop of pins){const key=`${stop.item.latitude!.toFixed(5)},${stop.item.longitude!.toFixed(5)}`;groups.set(key,[...(groups.get(key)??[]),stop]);}
  for(const group of groups.values()){
   const first=group[0].item,numbers=group.map(stop=>stop.number),label=group.map(stop=>`${stop.number}. ${stop.item.name}`).join(' · ');
   const shared=numbers.length>1,columns=Math.min(4,numbers.length),cellWidth=Math.max(28,String(numbers.at(-1)).length*10+12),width=shared?columns*cellWidth+8:40,bodyHeight=Math.ceil(numbers.length/columns)*30+8,height=shared?bodyHeight+12:44,center=width/2;
   const shape=shared?`M12 1H${width-12}Q${width-1} 1 ${width-1} 12V${bodyHeight-12}Q${width-1} ${bodyHeight-1} ${width-12} ${bodyHeight-1}H${center+9}L${center} ${height-1}L${center-9} ${bodyHeight-1}H12Q1 ${bodyHeight-1} 1 ${bodyHeight-12}V12Q1 1 12 1Z`:'M20 1C10 1 2 9 2 19c0 11 18 23 18 23s18-12 18-23C38 9 30 1 20 1Z';
   const color=dayColor(state,stopDay(first,state.plan.timezone)),badges=shared?`<div class="itinerary-pin-numbers" style="grid-template-columns:repeat(${columns},1fr)">${group.map(stop=>`<span style="background:${dayColor(state,stopDay(stop.item,state.plan.timezone))}">${stop.number}</span>`).join('')}</div>`:`<span>${numbers[0]}</span>`;
   const icon=r.L.divIcon({className:`itinerary-pin${shared?' itinerary-pin-shared':''}`,html:`<svg viewBox="0 0 ${width} ${height}" style="--pin-color:${color}" aria-hidden="true"><path d="${shape}" fill="${color}" stroke="white" stroke-width="2"/></svg>${badges}`,iconSize:[width,height],iconAnchor:[center,shared?height-1:42],popupAnchor:[0,4-height]});
   const marker=r.L.marker([first.latitude!,first.longitude!],{icon,title:label,alt:label,keyboard:true}).addTo(r.markers);
   marker.setOpacity(group.some(s=>stopDay(s.item,state.plan.timezone)===day)?1:.55);
   for(const stop of group)markerIndex.current.set(stop.item.id,marker);marker.on('click',()=>{callbacks.current.onSelect?.(first.id);callbacks.current.onOpen?.(first);});
   const tooltip=document.createElement('span');tooltip.textContent=label;marker.bindTooltip(tooltip,{direction:'top',offset:[0,7-height]});
   const popup=document.createElement('div');popup.className='itinerary-map-popup';
   for(const stop of group){const row=document.createElement('div'),title=document.createElement('strong'),date=document.createElement('small');title.textContent=`${stop.number}. ${stop.item.name}`;date.textContent=new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:stop.item.timezone??state.plan.timezone}).format(new Date(stop.item.start));row.appendChild(title);row.appendChild(date);if(stop.item.locationPrecision&&stop.item.locationPrecision>.001){const area=document.createElement('small');area.textContent='Approximate area location';row.appendChild(area);}try{const source=new URL(stop.item.locationSourceUrl??'');if(source.protocol==='https:'&&['www.wikidata.org','en.wikipedia.org','www.openstreetmap.org'].includes(source.hostname)){const link=document.createElement('a');link.href=source.href;link.target='_blank';link.rel='noreferrer';link.textContent='View location source';row.appendChild(link);}}catch{}popup.appendChild(row);}
   for(const stop of group){const link=document.createElement('a');link.href=directionsUrl([stop.item],travelMode)!;link.target='_blank';link.rel='noreferrer';link.textContent=`Directions to ${stop.item.name}`;popup.appendChild(link);if(onOpen){const button=document.createElement('button');button.textContent=`Open ${stop.item.name}`;button.className='text-button';button.addEventListener('click',()=>{callbacks.current.onSelect?.(stop.item.id);callbacks.current.onOpen?.(stop.item);});popup.appendChild(button);}}
   marker.bindPopup(popup);marker.getElement()?.setAttribute('aria-label',label);
  }
 },[ready,pinSignature,state.plan.timezone,state.plan.start,state.plan.end,day,travelMode,routeSignature]);
 useEffect(()=>{const r=runtime.current;if(!r||!ready)return;for(const marker of new Set(markerIndex.current.values())){marker.getElement()?.classList.remove('is-selected');marker.setZIndexOffset(0);}const marker=selectedId?markerIndex.current.get(selectedId):undefined;if(marker){marker.getElement()?.classList.add('is-selected');marker.setZIndexOffset(1000);r.map.setView(marker.getLatLng(),Math.max(r.map.getZoom(),14));marker.openPopup();}},[ready,selectedId,pinSignature,day]);
 function world(){runtime.current?.map.fitWorld();}
 function showItinerary(){const r=runtime.current;if(!r||!pins.length)return;const bounds=r.L.latLngBounds(pins.map(stop=>[stop.item.latitude!,stop.item.longitude!] as [number,number]));r.map.fitBounds(bounds,{padding:[48,48],maxZoom:15});}
 function showDay(){const r=runtime.current,selected=pins.filter(s=>stopDay(s.item,state.plan.timezone)===day);if(r&&selected.length)r.map.fitBounds(r.L.latLngBounds(selected.map(s=>[s.item.latitude!,s.item.longitude!] as [number,number])),{padding:[48,48],maxZoom:15});}
 return <section className="itinerary-map-section" aria-label="Your activities on the world map"><div className="itinerary-map-toolbar"><div><h2>{planType(state.plan).schedule} map</h2><p>{pins.length} of {stops.length} stops pinned · All plan days</p><p className="map-numbering-key">1 = earliest · Numbered by scheduled time</p></div><div className="action-row"><button className="btn" disabled={!ready} onClick={world}><Globe2 size={16}/>World view</button><button className="btn primary" disabled={!ready||!pins.length} onClick={showItinerary}><LocateFixed size={16}/>Show {planType(state.plan).schedule.toLowerCase()}</button></div></div>
  <div className="map-day-legend" aria-label="Map day colours">{mapDays.map(d=><button key={d} aria-pressed={day===d} disabled={!onDay} onClick={()=>onDay?.(d)}><span style={{background:dayColor(state,d)}}/>{new Date(d+'T12:00:00Z').toLocaleDateString('en-CA',{month:'short',day:'numeric',timeZone:'UTC'})}</button>)}<button className="text-button" disabled={!ready||!pins.some(s=>stopDay(s.item,state.plan.timezone)===day)} onClick={showDay}>Zoom to selected day</button></div>
  {directions.length>0&&<div className="map-day-directions"><strong>Directions for selected day</strong>{directions.map(route=><a key={route.label} href={route.url} target="_blank" rel="noreferrer">{route.label} · Google Maps</a>)}</div>}
  <p className="map-route-key">Selected-day pins are highlighted. Solid lines follow walking or driving routes. Dashed lines show stop order where a route is unavailable.</p>
  <div className="itinerary-map-frame"><div ref={container} className="itinerary-world-map" role="region" aria-label="Interactive world map. Pins are numbered earliest to latest across all plan days and coloured by day. Zoom and pan to see your itinerary pins."/>{!ready&&!error&&<div className="map-loading" role="status"><LoaderCircle size={22} className="spin"/>Loading world map…</div>}{error&&<div className="map-loading" role="alert">{error}</div>}{!stops.length&&ready&&<div className="map-empty-hint">Add an activity to your plan to see its pin here.</div>}</div>
  {routeLegs.length>0&&<p className="source-footnote route-attribution">Routes: <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noreferrer">OSRM · FOSSGIS</a> / <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Fix the map</a></p>}
  {tileIssue&&<p className="source-footnote" role="status">The map background could not load. Your saved pins are still available. Try reloading the page.</p>}
  {findingLocations&&<p className="map-location-status" role="status"><LoaderCircle size={16} className="spin"/>Finding activity locations automatically…</p>}
  {!findingLocations&&unmapped.length>0&&<div className="unmapped-stops"><p>{locationUnavailable?'Location search is temporarily unavailable for these stops.':'An exact location could not be found for these stops.'}</p><div>{unmapped.map(({item,number})=><span className="unmapped-stop" key={item.id}><MapPin size={15}/>{number}. {item.name}</span>)}</div></div>}
 </section>;
}
