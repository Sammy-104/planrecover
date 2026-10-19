'use client';
import {MessageCircle,Sun,House,CalendarDays,Compass,Wallet,CheckCheck,Store,SlidersHorizontal,Bus,Utensils,Backpack,Leaf,Mountain,PartyPopper} from 'lucide-react';
import {createContext,useContext,type ReactNode} from 'react';
import {type PlanPerson} from '@/lib/people';
import {members as demoMembers} from '@/lib/model';
import {type PlanKind,planTypes} from '@/lib/plan-types';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {Checkbox} from '@/components/ui/checkbox';
import {moneyStep,formatMoney,moneyInput as amountInput,parseMoney as amountParse,currencyCodes,currencyName} from '@/lib/money';
import {worldTimezones} from '@/lib/localization';
import {type PlacePhoto} from '@/lib/cities';
import {ActivityMedia} from '@/components/activity-media';
export type View='today'|'home'|'chat'|'plan'|'discover'|'money'|'decisions'|'merchant'|'settings';
export type Collaboration={shared:boolean;canManage:boolean;sharingEnabled:boolean;canEdit?:boolean;signedIn?:boolean;memberId?:string;displayName?:string;role?:string;canJoin?:boolean;linkRole?:string};
export type Config={paypal:boolean;clientId:string;ai:boolean;webhook:boolean;bedrock?:boolean};
export const nav=[{id:'home',label:'All plans',icon:House},{id:'today',label:'Today',icon:Sun},{id:'plan',label:'Plan',icon:CalendarDays},{id:'discover',label:'Discover',icon:Compass},{id:'chat',label:'Chat',icon:MessageCircle},{id:'money',label:'Money',icon:Wallet},{id:'decisions',label:'To do',icon:CheckCheck},{id:'merchant',label:'Demo tools',icon:Store},{id:'settings',label:'Settings',icon:SlidersHorizontal}] as const;
export const PeopleContext=createContext<readonly PlanPerson[]>(demoMembers.map(m=>({...m,role:'editor' as const})));
export const EditingContext=createContext(true);
export function useGroup(){const members=useContext(PeopleContext);return {members,memberIds:members.filter(m=>m.role!=='viewer'&&m.role!=='legacy').map(m=>m.id),name:(id:string)=>members.find(m=>m.id===id)?.name??(id==='guest'?'Guest':'Previous participant')};}
export const datetime=(s:string,zone='America/Toronto')=>new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:zone}).format(new Date(s));
const time=(s:string,zone='America/Toronto')=>new Intl.DateTimeFormat('en-CA',{hour:'numeric',minute:'2-digit',timeZone:zone}).format(new Date(s));
export function Icon({category}:{category:string}){const C=category==='Accommodation'?House:category==='Transport'?Bus:category==='Meal'?Utensils:category==='Preparation'?Backpack:category==='Free stop'?Leaf:Mountain;return <C size={20}/>;}
export function PlanIcon({kind,size=18}:{kind:PlanKind;size?:number}){const C=kind==='event'?PartyPopper:kind==='day-out'?Sun:Compass;return <C size={size}/>;}
export function PlanTypePicker({value,onChange}:{value:PlanKind;onChange:(kind:PlanKind)=>void}){return <fieldset className="plan-type-picker"><legend>What are you planning?</legend><div>{planTypes.map(type=><button type="button" key={type.id} aria-pressed={value===type.id} className={value===type.id?'selected':''} onClick={()=>onChange(type.id)}><PlanIcon kind={type.id} size={23}/><strong>{type.label}</strong><span>{type.description}</span></button>)}</div></fieldset>;}
export function Avatar({id,small=false}:{id:string;small?:boolean}){const {members,memberIds,name}=useGroup();const canEdit=useContext(EditingContext);const m=members.find(m=>m.id===id);return <span className={`avatar ${small?'small':''}`} style={{background:m?.color??'#56708e'}} title={m?.name??'Guest'}>{m?.initials??'G'}</span>;}
export function Pill({children,tone='neutral'}:{children:ReactNode;tone?:string}){return <span className={`pill ${tone}`}>{children}</span>;}
export function Choose({value,onChange,options,label,disabled=false}:{disabled?:boolean;value:string;onChange:(v:string)=>void;options:{value:string;label:string}[];label:string}){return <Select disabled={disabled} value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="select-control"><SelectValue/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>;}
export function PersonChoices({selected,onChange}:{selected:string[];onChange:(ids:string[])=>void}){const {members,memberIds,name}=useGroup();const canEdit=useContext(EditingContext);return <div className="people-choices">{members.filter(m=>memberIds.includes(m.id)).map(m=><label key={m.id}><Checkbox checked={selected.includes(m.id)} onCheckedChange={v=>onChange(v?[...selected,m.id]:selected.filter(id=>id!==m.id))}/><Avatar id={m.id} small/>{m.name}</label>)}</div>;}
export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}){return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;}
export const CurrencyContext=createContext('CAD');
export function useMoney(selected?:string){const inherited=useContext(CurrencyContext),currency=selected??inherited;return {currency,step:moneyStep(currency),dollars:(n:number)=>formatMoney(n,currency),moneyInput:(n:number)=>amountInput(n,currency),parseMoney:(s:string)=>amountParse(s,currency)};}
export function TimezonePicker({value,onChange}:{value:string;onChange:(zone:string)=>void}){return <><input aria-label="Plan time zone" list="world-timezones" value={value} onChange={e=>onChange(e.target.value)} placeholder="Search a city or time zone"/><datalist id="world-timezones">{[...new Set([value,...worldTimezones])].map(zone=><option value={zone} key={zone}/>)}</datalist></>;}
export function CurrencyPicker({value,onChange,disabled=false}:{value:string;onChange:(currency:string)=>void;disabled?:boolean}){return <Choose label="Plan currency" value={value} onChange={onChange} disabled={disabled} options={currencyCodes.map(code=>({value:code,label:currencyName(code)}))}/>;}
export function shareToken(){return typeof window==='undefined'?'':new URLSearchParams(window.location.hash.slice(1)).get('trip')??'';}
export function apiHeaders(options?:RequestInit){const headers=new Headers(options?.headers);const token=shareToken();if(token)headers.set('x-trip-share',token);return headers;}
export class WorkspaceError extends Error{constructor(message:string,public status:number){super(message);}}
export async function jsonFetch(url:string,options?:RequestInit):Promise<any>{const r=await fetch(url,{...options,headers:apiHeaders(options),cache:'no-store'}),b=await r.json() as any;if(!r.ok)throw new WorkspaceError(b.error??'Something went wrong. Please try again.',r.status);return b;}
export function PageHeading({eyebrow,title,subtitle}:{eyebrow:string;title:string;subtitle:string}){return <div className="page-heading"><div><h1>{title}</h1><p className="page-subtitle">{subtitle}</p></div></div>;}
export function PhotoCredit({place}:{place:PlacePhoto}){
 return <>{place.imagePageUrl?<a href={place.imagePageUrl} target="_blank" rel="noreferrer">{place.imageCredit??'Photo source'}</a>:place.imageCredit??'Photo source'}{place.imageLicense&&<> · {place.imageLicenseUrl?<a href={place.imageLicenseUrl} target="_blank" rel="noreferrer">{place.imageLicense}</a>:place.imageLicense}</>}</>;
}
export function ActivityPhoto({place,name,compact=false,category='Activity'}:{place:PlacePhoto;name:string;compact?:boolean;category?:string}){return <ActivityMedia place={place} name={name} category={category} compact={compact}/>;}
