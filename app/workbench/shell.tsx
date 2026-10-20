'use client';
import {useSidebar,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarGroup,SidebarGroupLabel,Sidebar,SidebarHeader,SidebarContent,SidebarFooter,SidebarTrigger} from '@/components/ui/sidebar';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuLabel,DropdownMenuSeparator} from '@/components/ui/dropdown-menu';
import {Bell,Check,ChevronsUpDown,Compass,House,LoaderCircle,LockKeyhole,Plus,Search,Users} from 'lucide-react';
import {tripList,type State} from '@/lib/model';
import {planKind} from '@/lib/plan-types';
import {Avatar,Choose,PlanIcon,nav,type View,type Collaboration} from './shared';

const planGroup:readonly View[]=['home','today','plan','discover','chat'];
const groupGroup:readonly View[]=['money','decisions'];

function dateRange(start:string,end:string){const f=(d:string,year:boolean)=>new Date(d+'T12:00:00').toLocaleDateString('en-CA',{month:'short',day:'numeric',...(year?{year:'numeric'}:{})});return start===end?f(start,true):`${f(start,false)} – ${f(end,true)}`;}

export function visibleNav(shared:boolean,simple:boolean):View[]{
 const base:View[]=simple?['home','plan','chat','discover','today']:['home','plan','chat','discover','today','money','decisions'];
 return shared?base.filter(v=>v!=='home'):[...base,'settings'];
}

function PlanSwitcher({state,busy,shared,onSelect,onNew,onAll}:{state:State|null;busy:boolean;shared:boolean;onSelect:(id:string)=>void;onNew:()=>void;onAll:()=>void}){
 const plan=state&&!state.empty?state.plan:null;
 const trigger=<button type="button" className="plan-switcher" disabled={!state||busy||shared} aria-label={plan?`Current plan: ${plan.name}. Switch plan`:'Choose a plan'}>
  <span className="plan-switcher-icon">{plan?<PlanIcon kind={planKind(plan)} size={17}/>:<Compass size={17}/>}</span>
  <span className="plan-switcher-text"><strong>{plan?.name??'No plan open'}</strong><small>{plan?`${plan.destination.split(',')[0]} · ${dateRange(plan.start,plan.end)}`:'Create or open a plan'}</small></span>
  {!shared&&<ChevronsUpDown size={15} className="plan-switcher-chevron"/>}
 </button>;
 if(shared)return <div className="plan-switcher-shell"><span className="sidebar-caption"><Users size={13}/>Shared with you</span>{trigger}</div>;
 return <div className="plan-switcher-shell"><DropdownMenu><DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
  <DropdownMenuContent align="start" className="plan-switcher-menu">
   <DropdownMenuLabel>Your plans</DropdownMenuLabel>
   {state&&tripList(state).slice(0,6).map(t=><DropdownMenuItem key={t.id} onSelect={()=>onSelect(t.id)} className="plan-switcher-item">
    <PlanIcon kind={planKind(t.plan)} size={15}/><span><strong>{t.plan.template==='algonquin'?'Demo · ':''}{t.plan.name}</strong><small>{t.plan.destination.split(',')[0]} · {t.itemCount} {t.itemCount===1?'item':'items'}</small></span>{t.active&&<Check size={15} className="plan-switcher-check"/>}
   </DropdownMenuItem>)}
   <DropdownMenuSeparator/>
   <DropdownMenuItem onSelect={onAll}><House size={15}/>All plans{state&&tripList(state).length>6?` (${tripList(state).length})`:null}</DropdownMenuItem>
   <DropdownMenuItem onSelect={onNew}><Plus size={15}/>New plan</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu></div>;
}

export function AppSidebar({view,onGo,count,collab,state,busy,simple,identityMode,actor,onActor,memberOptions,personName,personRole,onSelectPlan,onNewPlan}:{view:View;onGo:(v:View)=>void;count:number;collab:Collaboration;state:State|null;busy:boolean;simple:boolean;identityMode:boolean;actor:string;onActor:(id:string)=>void;memberOptions:{value:string;label:string}[];personName:string;personRole:string;onSelectPlan:(id:string)=>void;onNewPlan:()=>void}){
 const {isMobile,setOpenMobile}=useSidebar();
 const allowed=visibleNav(collab.shared,simple);
 function navigate(v:View){onGo(v);if(isMobile)setOpenMobile(false);}
 function menu(ids:readonly View[]){const items=nav.filter(n=>ids.includes(n.id)&&allowed.includes(n.id));if(!items.length)return null;return <SidebarMenu>{items.map(n=><SidebarMenuItem key={n.id}><SidebarMenuButton isActive={view===n.id} onClick={()=>navigate(n.id)} className="nav-button" aria-current={view===n.id?'page':undefined}><n.icon size={17}/><span>{n.label}</span>{n.id==='decisions'&&count>0&&<span className="nav-count">{count}</span>}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu>;}
 const group=menu(groupGroup);
 return <Sidebar className="app-sidebar">
  <SidebarHeader className="brand-area">
   <div className="brand"><span className="brand-mark" aria-hidden><Compass size={18}/></span><span className="brand-name">PlanRecover</span><span className="beta-tag">Beta</span></div>
   <PlanSwitcher state={state} busy={busy} shared={collab.shared} onSelect={id=>{onSelectPlan(id);if(isMobile)setOpenMobile(false);}} onNew={()=>{onNewPlan();if(isMobile)setOpenMobile(false);}} onAll={()=>navigate('home')}/>
  </SidebarHeader>
  <SidebarContent>
   <SidebarGroup><SidebarGroupLabel className="sidebar-caption">Planning</SidebarGroupLabel>{menu(planGroup)}</SidebarGroup>
   {group&&<SidebarGroup><SidebarGroupLabel className="sidebar-caption">Together</SidebarGroupLabel>{group}</SidebarGroup>}
   {!collab.shared&&<SidebarGroup className="utility-nav">{menu(['settings'])}</SidebarGroup>}
  </SidebarContent>
  <SidebarFooter className="sidebar-bottom">
   <div className="persona"><Avatar id={actor}/><div className="persona-text"><strong>{personName}</strong><small>{personRole}</small></div></div>
   {!identityMode&&<details className="persona-switch"><summary>Demo options</summary><Choose label="View as demo member" value={actor} onChange={onActor} options={memberOptions}/><p className="demo-note">Fictional demo · no real bookings</p></details>}
  </SidebarFooter>
 </Sidebar>;
}

export function Topbar({view,planName,shared,showHome,onHome,onSearch,onReminders,reminderCount,status}:{view:View;planName?:string;shared:boolean;showHome:boolean;onHome:()=>void;onSearch?:()=>void;onReminders:()=>void;reminderCount:number;status:{kind:'demo'|'saving'|'saved'|'idle';label:string}}){
 const label=nav.find(n=>n.id===view)?.label;
 return <header className="topbar">
  <div className="crumb"><SidebarTrigger className="sidebar-toggle"/>{showHome&&!shared&&<button className="icon-button mobile-home-link" aria-label="Your saved plans" onClick={onHome}><House size={18}/></button>}
   <nav aria-label="Breadcrumb" className="crumb-trail">{planName&&view!=='home'&&view!=='settings'&&<><span className="crumb-plan">{planName}</span><span className="crumb-sep" aria-hidden>/</span></>}<span className="crumb-current" aria-current="page">{label}</span></nav>
  </div>
  <div className="topbar-right">
   {onSearch&&<button className="topbar-search" aria-label="Search saved plans and bookings" onClick={onSearch}><Search size={15}/><span>Search</span><kbd>Ctrl K</kbd></button>}
   <span className={`save-indicator ${status.kind}`} role="status">{status.kind==='saving'?<LoaderCircle size={13} className="spin"/>:status.kind==='saved'?<Check size={13}/>:status.kind==='demo'?<Compass size={13}/>:<LockKeyhole size={13}/>}<span>{status.label}</span></span>
   <button className="icon-button topbar-bell" aria-label={reminderCount?`View reminders and ${reminderCount} items to review`:'View reminders'} onClick={onReminders}><Bell size={18}/>{reminderCount>0&&<span className="bell-dot" aria-hidden/>}</button>
  </div>
 </header>;
}
