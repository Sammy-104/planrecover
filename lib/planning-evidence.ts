import {z} from 'zod';
import {BackendError,conflict,forbidden,missingPlan} from './backend-errors.ts';
import type {State} from './model.ts';
import type {Identity} from './people.ts';
import type {SupplierConstraintEvidence,PlanningTravelEvidence} from './planning-constraints.ts';
import {cityKey} from './cities.ts';

export const EVIDENCE_FRESHNESS_MS=86400000;
export const MAX_PLANNING_EVIDENCE=200;
const instant=z.string().max(40).datetime({offset:true});
const id=z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).refine(value=>!['__proto__','constructor','prototype'].includes(value));
const version=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const evidenceSourceUrl=z.string().max(2048).refine(value=>{
 try{const url=new URL(value),host=url.hostname.toLowerCase();return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')
  &&host.includes('.')&&!/^[\d.]+$/.test(host)&&!host.startsWith('[')&&!/(?:^|\.)(?:localhost|local|internal)$/.test(host);}
 catch{return false;}
},'Use a public HTTPS source URL without credentials.').transform(value=>new URL(value).href);
const support=z.record(z.string().trim().min(1).max(120),z.enum(['supported','unsupported','unknown']))
 .refine(value=>Object.keys(value).length<=30&&!Object.keys(value).some(key=>['__proto__','constructor','prototype'].includes(key)));
const interval=z.object({start:instant,end:instant}).strict().refine(value=>Date.parse(value.end)>Date.parse(value.start));
export const supplierEvidenceSchema=z.object({itemId:id,sourceUrl:evidenceSourceUrl,checkedAt:instant,expiresAt:instant.optional(),
 openIntervals:z.array(interval).max(50).optional(),dietary:support.optional(),accessibility:support.optional()}).strict()
 .refine(value=>value.openIntervals!==undefined||value.dietary!==undefined||value.accessibility!==undefined,'Provide explicit supplier facts.')
 .refine(value=>!value.expiresAt||Date.parse(value.expiresAt)>Date.parse(value.checkedAt),'Evidence expiry must follow its check.');
export const travelEvidenceSchema=z.object({fromId:id,toId:id,sourceUrl:evidenceSourceUrl,checkedAt:instant,expiresAt:instant.optional(),
 minutes:z.number().finite().int().min(0).max(1440),basis:z.enum(['provider','estimate'])}).strict()
 .refine(value=>value.fromId!==value.toId,'Choose two different saved places.')
 .refine(value=>!value.expiresAt||Date.parse(value.expiresAt)>Date.parse(value.checkedAt));
const mutation=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('supplier'),planVersion:version,version,evidence:supplierEvidenceSchema,confirm:z.literal(true)}).strict(),
 z.object({kind:z.literal('travel'),planVersion:version,version,evidence:travelEvidenceSchema,confirm:z.literal(true)}).strict(),
]);
const revocation=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('supplier'),planVersion:version,version:version.refine(value=>value>0),itemId:id}).strict(),
 z.object({kind:z.literal('travel'),planVersion:version,version:version.refine(value=>value>0),fromId:id,toId:id}).strict(),
]);
export type EvidenceMutation=z.infer<typeof mutation>;
export type EvidenceRevocation=z.infer<typeof revocation>;
type SupplierFacts=z.infer<typeof supplierEvidenceSchema>;
type TravelFacts=z.infer<typeof travelEvidenceSchema>;
type EvidenceRow={owner:string;plan_id:string;kind:'supplier'|'travel';subject_key:string;body:string;subject_snapshot:string;
 source_url:string;checked_at:string;confirmed_by:string;status:'active'|'revoked';version:number;created:string;updated:string};
type Subject={id:string;name:string;category:string;location?:string;address?:string;latitude?:number;longitude?:number;sourceUrl?:string;officialWebsite?:string;catalog:boolean;participants?:string[]};
const keyFor=(kind:string,value:{itemId?:string;fromId?:string;toId?:string})=>JSON.stringify(kind==='supplier'?[value.itemId]:[value.fromId,value.toId]);
const fresh=(value:{checkedAt:string;expiresAt?:string},now:number)=>Date.parse(value.checkedAt)<=now+300000&&now-Date.parse(value.checkedAt)<=EVIDENCE_FRESHNESS_MS&&(!value.expiresAt||Date.parse(value.expiresAt)>now);

export function parsePlanningEvidenceMutation(input:unknown,now=Date.now()):EvidenceMutation{
 const parsed=mutation.safeParse(input);if(!parsed.success)throw new BackendError('INVALID_PLANNING_EVIDENCE','Provide explicit source facts, saved item IDs, current versions and owner confirmation.');
 if(!fresh(parsed.data.evidence,now))throw new BackendError('STALE_PLANNING_EVIDENCE','Check the source again. Evidence must be unexpired and checked within the last 24 hours.');
 return parsed.data;
}
export function parsePlanningEvidenceRevocation(input:unknown):EvidenceRevocation{
 const parsed=revocation.safeParse(input);if(!parsed.success)throw new BackendError('INVALID_PLANNING_EVIDENCE','Choose current saved evidence to revoke.');return parsed.data;
}
function subjects(state:State){
 const result=new Map<string,Subject>();
 if(state.recommendations?.destinationKey===cityKey(state.plan.destination))for(const place of state.recommendations.entries)
  result.set(place.id,{id:place.id,name:place.name,category:place.category,location:place.area,address:place.address,latitude:place.latitude,longitude:place.longitude,sourceUrl:place.sourceUrl,officialWebsite:place.officialWebsite,catalog:true});
 for(const item of state.items)if(item.status!=='cancelled')result.set(item.id,{id:item.id,name:item.name,category:item.category,location:item.location,address:item.address,latitude:item.latitude,longitude:item.longitude,
  sourceUrl:item.sourceUrl,officialWebsite:item.officialWebsite,catalog:false,participants:item.participants});
 return result;
}
function subjectSnapshot(state:State,kind:string,evidence:{itemId?:string;fromId?:string;toId?:string}){
 const available=subjects(state),ids=kind==='supplier'?[evidence.itemId!]:[evidence.fromId!,evidence.toId!],selected=ids.map(id=>available.get(id));
 if(selected.some(item=>!item))throw new BackendError('EVIDENCE_ITEM_UNAVAILABLE','Evidence must identify actual saved plan items or saved catalog places.',404);
 return JSON.stringify({destination:state.plan.destination,subjects:selected.map(item=>({id:item!.id,name:item!.name,category:item!.category,location:item!.location??null,address:item!.address??null,
  latitude:item!.latitude??null,longitude:item!.longitude??null,sourceUrl:item!.sourceUrl??null,officialWebsite:item!.officialWebsite??null,catalog:item!.catalog}))});
}
function decode(row:EvidenceRow,state:State){
 let raw:unknown;try{raw=JSON.parse(row.body);}catch{return null;}
 const parsed=row.kind==='supplier'?supplierEvidenceSchema.safeParse(raw):travelEvidenceSchema.safeParse(raw);
 if(!parsed.success)return null;
 try{if(subjectSnapshot(state,row.kind,parsed.data)!==row.subject_snapshot)return null;}catch{return null;}
 return {row,evidence:parsed.data};
}
async function canonicalPlan(database:D1Database,owner:string,planId:string){
 const row=await database.prepare("SELECT body FROM plans WHERE owner=? AND id=? AND status<>'deleted'").bind(owner,planId).first<{body:string}>();
 if(!row)throw missingPlan();return JSON.parse(row.body) as State;
}

/** Server-only loader. Stale, revoked, removed or changed venue evidence stays unknown. */
export async function loadPlanningEvidence(database:D1Database,owner:string,planId:string,options:{now?:number}={}){
 const state=await canonicalPlan(database,owner,planId),now=options.now??Date.now(),rows=await database.prepare("SELECT * FROM planning_evidence WHERE owner=? AND plan_id=? AND status='active' ORDER BY kind,subject_key LIMIT ?")
  .bind(owner,planId,MAX_PLANNING_EVIDENCE).all<EvidenceRow>();
 const supplierEvidence:(SupplierConstraintEvidence&{provenance:'owner-confirmed'})[]=[],travelEvidence:(PlanningTravelEvidence&{sourceUrl:string;provenance:'owner-confirmed'})[]=[];
 for(const row of rows.results){const value=decode(row,state);if(!value||!fresh(value.evidence,now))continue;
  if(row.kind==='supplier')supplierEvidence.push({...value.evidence as SupplierFacts,provenance:'owner-confirmed'});
  else travelEvidence.push({...value.evidence as TravelFacts,provenance:'owner-confirmed'});
 }
 return {supplierEvidence,travelEvidence,provenance:'owner-confirmed' as const};
}

export class PlanningEvidenceRepository{
 private database:D1Database;
 constructor(database:D1Database){this.database=database;}
 private async access(planId:string,identity:Identity){
  const row=await this.database.prepare(`SELECT p.owner,p.body,p.version,m.role FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
   WHERE p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role<>'legacy'`).bind(planId,identity.id).first<{owner:string;body:string;version:number;role:string}>();
  if(!row)throw missingPlan();return {...row,state:JSON.parse(row.body) as State};
 }
 async list(planId:string,identity:Identity,now=Date.now()){
  const plan=await this.access(planId,identity),available=subjects(plan.state),rows=await this.database.prepare("SELECT * FROM planning_evidence WHERE owner=? AND plan_id=? AND status='active' ORDER BY updated DESC,kind,subject_key LIMIT ?")
   .bind(plan.owner,planId,MAX_PLANNING_EVIDENCE).all<EvidenceRow>();
  if(plan.role==='owner'){
   const revoked=await this.database.prepare("SELECT * FROM planning_evidence WHERE owner=? AND plan_id=? AND status='revoked' ORDER BY updated DESC,kind,subject_key LIMIT 100")
    .bind(plan.owner,planId).all<EvidenceRow>();rows.results.push(...revoked.results);
  }
  const relevant=(id:string)=>{const subject=available.get(id);return !!subject&&(plan.role==='owner'||subject.catalog||subject.participants?.includes(identity.id));};
  const records=rows.results.flatMap(row=>{const value=decode(row,plan.state);
   let raw:unknown;try{raw=JSON.parse(row.body);}catch{return [];}
   const parsed=row.kind==='supplier'?supplierEvidenceSchema.safeParse(raw):travelEvidenceSchema.safeParse(raw);if(!parsed.success)return [];
   const data=parsed.data,ids=row.kind==='supplier'?[(data as SupplierFacts).itemId]:[(data as TravelFacts).fromId,(data as TravelFacts).toId];
   if(plan.role!=='owner'&&(!value||!ids.every(relevant)))return [];
   return [{kind:row.kind,evidence:data,version:row.version,status:row.status,applicable:!!value,fresh:!!value&&row.status==='active'&&fresh(data,now),provenance:'owner-confirmed',confirmedBy:row.confirmed_by,updated:row.updated}];
  });
  return {planVersion:plan.version,records,provenance:'owner-confirmed',requiresReview:true,liveInventoryVerified:false};
 }
 async save(planId:string,identity:Identity,input:unknown,now=Date.now()){
  const plan=await this.access(planId,identity);if(plan.role!=='owner')throw forbidden();
  const parsed=parsePlanningEvidenceMutation(input,now);if(parsed.planVersion!==plan.version)throw conflict();
  const snapshot=subjectSnapshot(plan.state,parsed.kind,parsed.evidence),key=keyFor(parsed.kind,parsed.evidence),token=crypto.randomUUID(),at=new Date(now).toISOString();
  try{await this.database.batch([
   this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
    WHERE p.owner=? AND p.id=? AND p.version=? AND p.status<>'deleted' AND m.member_id=? AND m.role='owner')
    AND COALESCE((SELECT version FROM planning_evidence WHERE owner=? AND plan_id=? AND kind=? AND subject_key=?),0)=?
    AND ((SELECT COUNT(*) FROM planning_evidence WHERE owner=? AND plan_id=? AND status='active')<? OR EXISTS(SELECT 1 FROM planning_evidence WHERE owner=? AND plan_id=? AND kind=? AND subject_key=? AND status='active'))
    THEN 1 ELSE 0 END)`).bind(token,plan.owner,planId,parsed.planVersion,identity.id,plan.owner,planId,parsed.kind,key,parsed.version,plan.owner,planId,MAX_PLANNING_EVIDENCE,plan.owner,planId,parsed.kind,key),
   this.database.prepare(`INSERT INTO planning_evidence(owner,plan_id,kind,subject_key,body,subject_snapshot,source_url,checked_at,confirmed_by,status,version,created,updated) VALUES (?,?,?,?,?,?,?,?,?,'active',1,?,?)
    ON CONFLICT(owner,plan_id,kind,subject_key) DO UPDATE SET body=excluded.body,subject_snapshot=excluded.subject_snapshot,source_url=excluded.source_url,checked_at=excluded.checked_at,
    confirmed_by=excluded.confirmed_by,status='active',version=planning_evidence.version+1,updated=excluded.updated`)
    .bind(plan.owner,planId,parsed.kind,key,JSON.stringify(parsed.evidence),snapshot,parsed.evidence.sourceUrl,parsed.evidence.checkedAt,identity.id,at,at),
   this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token),
  ]);}catch(error){if(String(error).includes('CHECK constraint failed'))throw conflict();throw error;}
  return {kind:parsed.kind,evidence:parsed.evidence,version:parsed.version+1,status:'active',provenance:'owner-confirmed',requiresReview:true,liveInventoryVerified:false};
 }
 async revoke(planId:string,identity:Identity,input:unknown,now=Date.now()){
  const plan=await this.access(planId,identity);if(plan.role!=='owner')throw forbidden();
  const parsed=parsePlanningEvidenceRevocation(input);if(parsed.planVersion!==plan.version)throw conflict();
  const key=keyFor(parsed.kind,parsed),at=new Date(now).toISOString();
  const result=await this.database.prepare(`UPDATE planning_evidence SET status='revoked',version=version+1,updated=? WHERE owner=? AND plan_id=? AND kind=? AND subject_key=? AND version=? AND status='active'
   AND EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=planning_evidence.owner AND p.id=planning_evidence.plan_id
    AND p.version=? AND p.status<>'deleted' AND m.member_id=? AND m.role='owner')`)
   .bind(at,plan.owner,planId,parsed.kind,key,parsed.version,parsed.planVersion,identity.id).run();
  if(!result.meta.changes)throw conflict();return {revoked:true,version:parsed.version+1};
 }
}

export async function planningEvidenceJson(request:Request):Promise<unknown>{
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new BackendError('INVALID_REQUEST','Send planning evidence as JSON.',415);
 const reader=request.body?.getReader();if(!reader)throw new BackendError('INVALID_REQUEST','Provide explicit planning evidence.');
 const decoder=new TextDecoder();let text='',size=0;
 try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>20000){await reader.cancel();throw new BackendError('REQUEST_TOO_LARGE','Keep planning evidence under 20 KB.',413);}text+=decoder.decode(next.value,{stream:true});}
  text+=decoder.decode();try{return JSON.parse(text);}catch{throw new BackendError('INVALID_REQUEST','Provide valid planning evidence JSON.');}
 }finally{reader.releaseLock();}
}
