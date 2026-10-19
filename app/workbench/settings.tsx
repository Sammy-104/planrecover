'use client';
import {type State,type Preferences,isDemoTrip} from '@/lib/model';
import {useState,useEffect,type ReactNode} from 'react';
import {Switch} from '@/components/ui/switch';
import PushDeviceSettings from '@/components/push-device-settings';
import {BackgroundChecks} from '@/components/background-checks';
import {ExternalLink,RotateCcw,Store} from 'lucide-react';
import {type Config,useMoney,useGroup,Field,Choose,Pill} from './shared';
function SettingsSection({title,description,children,id}:{title:string;description:string;children:ReactNode;id:string}){return <section className="settings-section" aria-labelledby={id}><div className="settings-section-intro"><h2 id={id}>{title}</h2><p>{description}</p></div><div className="settings-section-body">{children}</div></section>;}
export function Settings({state,actor,config,act,onReset,onDemo}:{state:State;actor:string;config:Config;act:any;onReset:()=>void;onDemo:()=>void}){const {currency,step,moneyInput,parseMoney}=useMoney();
 const {name}=useGroup();const [pref,setPref]=useState<Preferences>(state.preferences[actor]),[interestText,setInterestText]=useState((state.preferences[actor]?.interests??[]).join(', '));useEffect(()=>{setPref(state.preferences[actor]);setInterestText((state.preferences[actor]?.interests??[]).join(', '));},[actor,state.preferences]);
 const interests=[...new Set(interestText.split(',').map(value=>value.trim()).filter(Boolean))],invalidInterests=interests.length>30||interests.some(value=>value.length>80);
 if(!pref)return <div className="settings-page"><div className="calm-empty"><h2>Settings</h2><p>Join the plan to set your preferences.</p></div></div>;
 const connections=[
  {label:'Receipt scanner',detail:'On-device scanning ready',ready:true,status:'Ready'},
  {label:'AI conversations and drafts',detail:config.bedrock?'Bedrock configured; see service checks':'Bedrock not configured',ready:!!config.bedrock,status:config.bedrock?'Configured':'Not configured'},
  {label:'PayPal sandbox',detail:config.paypal?'Configured; checkout verification is separate':'Not configured',ready:config.paypal,status:config.paypal?'Configured':'Not configured'},
  {label:'PayPal webhooks',detail:config.webhook?'Configured; signed callback verification is separate':'Not configured',ready:config.webhook,status:config.webhook?'Configured':'Not configured'},
 ];
 return <div className="settings-page">
  <div className="page-heading"><div><h1>Settings</h1><p className="page-subtitle">Your budget and planning preferences.</p></div></div>

  <SettingsSection id="settings-preferences" title={`${name(actor)}’s preferences`} description="Your spending limits and planning preferences are private. Your approved PayPal.Me link is shared for repayments.">
   <div className="settings-card">
    <div className="form-grid"><Field label={`Your plan budget (${currency})`}><input type="number" min="0" step={step} value={moneyInput(pref.budget)} onChange={e=>setPref({...pref,budget:parseMoney(e.target.value)})}/></Field><Field label="Preferred pace"><Choose label="Preferred pace" value={pref.pace} onChange={pace=>setPref({...pref,pace})} options={['relaxed','balanced','busy'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)}))}/></Field></div>
    <Field label="Your interests" hint="Separate interests with commas, for example: museums, food, outdoors."><input value={interestText} maxLength={2430} onChange={e=>setInterestText(e.target.value)}/></Field>{invalidInterests&&<p className="inline-error">Use up to 30 interests, each under 81 characters.</p>}
    <details className="settings-disclosure"><summary>Spending limits and repayments</summary><div className="form-grid">{([{key:'cash',label:'Immediate spending limit'},{key:'reserve',label:'Keep aside'},{key:'financing',label:'Known financing obligations'}] as const).map(f=><Field key={f.key} label={`${f.label} (${currency})`}><input type="number" min="0" step={step} value={moneyInput(pref[f.key])} onChange={e=>setPref({...pref,[f.key]:parseMoney(e.target.value)})}/></Field>)}<Field label="Your PayPal.Me link (optional)"><input type="url" value={pref.paypalMe} placeholder="https://paypal.me/yourname" onChange={e=>setPref({...pref,paypalMe:e.target.value})}/></Field></div></details>
    <div className="settings-card-footer"><button className="btn primary" disabled={invalidInterests||[pref.budget,pref.cash,pref.reserve,pref.financing].some(value=>!Number.isSafeInteger(value)||value<0)} onClick={()=>act({type:'preferences',preferences:{...pref,interests}},'Preferences saved')}>Save preferences</button></div>
   </div>
  </SettingsSection>

  <SettingsSection id="settings-suggestions" title="Suggestions" description="Choose the categories you want to see.">
   <div className="settings-card settings-rows">{['Activity','Free stop','Meal','Preparation','Practical stop'].map(c=><label className="switch-line" key={c}><span>{c}</span><Switch checked={!state.muted.includes(c)} onCheckedChange={()=>act({type:'mute',category:c})}/></label>)}</div>
  </SettingsSection>

  {state.people&&state.plan.id&&!pref.publicOnly&&<SettingsSection id="settings-notifications" title="Notifications" description="Register this browser for reminder push notifications."><div className="settings-card"><PushDeviceSettings planId={state.plan.id}/></div></SettingsSection>}

  <SettingsSection id="settings-advanced" title="Advanced" description="Background checks, connection status, demo tools and developer resources.">
   {(isDemoTrip(state)||state.people?.find(person=>person.id===actor)?.role==="owner")&&<div className="settings-card"><BackgroundChecks/></div>}
   <div className="settings-card"><h3 className="settings-card-title">Connections</h3>
    <ul className="settings-status-list">{connections.map(c=><li key={c.label}><div><strong>{c.label}</strong><small>{c.detail}</small></div><Pill tone={c.ready?'green':'neutral'}>{c.status}</Pill></li>)}</ul>
    {!config.bedrock&&<p className="source-footnote">Saved-plan chat and photo scanning work now. For flexible AI conversations, the app owner needs to configure a Bedrock key and a Canada Central application inference profile in server settings.</p>}
   </div>
   <div className="settings-card"><h3 className="settings-card-title">Demo workspace</h3><p className="settings-card-text">The merchant scenario uses fictional bookings. Sandbox payments are test payments.</p><div className="action-row"><button className="btn" onClick={onDemo}><Store size={16}/>Open demo tools</button><button className="btn danger reset-button" onClick={onReset}><RotateCcw size={16}/>Reset demo workspace</button></div></div>
   <div className="settings-card"><h3 className="settings-card-title">Developer resources</h3><div className="settings-links">{[{name:'PayPal AI Hackathon resources',url:'https://paypalaihackathon.devpost.com/resources'},{name:'PayPal JavaScript SDK',url:'https://developer.paypal.com/sdk/js/set-up'},{name:'PayPal API documentation',url:'https://developer.paypal.com/api/rest/'},{name:'PayPal AI Toolkit',url:'https://github.com/paypal/AI-Toolkit'}].map(l=><a className="resource-link" key={l.url} href={l.url} target="_blank" rel="noreferrer">{l.name}<ExternalLink size={15}/></a>)}</div></div>
  </SettingsSection>
 </div>;
}
