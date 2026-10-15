import type {State,Preferences} from './model.ts';
export type PlanPerson={id:string;name:string;initials:string;color:string;role:'owner'|'editor'|'viewer'|'legacy'};
export type Identity={id:string;name:string};
export function personName(value:unknown){if(typeof value!=='string'||!value.trim()||value.trim().length>60)throw Error('Enter your name, up to 60 characters.');return value.trim();}
export async function accountPersonId(account:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(account));return 'person-'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('').slice(0,32);}
export function makePerson(id:string,name:string,role:PlanPerson['role']):PlanPerson{name=personName(name);return {id,name,role,initials:name.split(/\s+/).map(w=>Array.from(w)[0]).slice(0,2).join('').toUpperCase(),color:['#315be8','#ac5ac6','#0b8d88','#c77a28'][id.charCodeAt(id.length-1)%4]};}
export function defaultPreferences(budget:number):Preferences{return {budget,cash:budget,reserve:0,pace:'balanced',interests:[],paypalMe:'',financing:0};}
export function initializePeople(state:State,identity:Identity){
 if(state.people)return state;
 const used=new Set(state.items.flatMap(i=>[...i.participants,...Object.keys(i.shares),...i.paid,...(i.required??[])]));
 for(const event of state.events)for(const id of [...Object.keys(event.shares),...Object.keys(event.contributions),event.from,event.to])if(id)used.add(id);
 for(const r of state.receipts)for(const id of [r.payer,...r.rows.flatMap(row=>row.claims),...Object.keys(r.shares)])used.add(id);
 const legacyNames:Record<string,string>={sam:'Sam',alex:'Alex',maya:'Maya',chris:'Chris'};
 state.people=[makePerson(identity.id,identity.name,'owner'),...[...used].filter(id=>id!==identity.id).map(id=>makePerson(id,legacyNames[id]??'Previous participant','legacy'))];
 state.preferences=Object.fromEntries(state.people.map(p=>[p.id,state.preferences[p.id]??defaultPreferences(state.plan.budget)]));return state;
}
export function addPerson(state:State,identity:Identity,role:'editor'|'viewer'){
 if(!state.people)throw Error('Choose a personal plan to join.');const existing=state.people.find(p=>p.id===identity.id);if(existing)return existing;
 const person=makePerson(identity.id,identity.name,role);state.people.push(person);state.preferences[person.id]=defaultPreferences(state.plan.budget);
 state.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),text:`${person.name} joined as ${role}.`,actorId:person.id,actorName:person.name});return person;
}
export function canEditPerson(state:State,id?:string){return !!state.people?.some(p=>p.id===id&&['owner','editor'].includes(p.role));}
