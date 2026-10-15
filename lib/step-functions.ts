import {z} from 'zod';
import {awsJson} from './aws-adapters.ts';
import type {Env} from './http-adapters.ts';
import type {Identity} from './people.ts';
import {PlanRepository} from './plan-repository.ts';
import {PlanChangeService} from './plan-changes.ts';
import {BackendError,conflict,forbidden} from './backend-errors.ts';
const to64=(value:Uint8Array)=>btoa(String.fromCharCode(...value));
const from64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function cryptKey(env:Env){if(typeof env.WORKFLOW_TOKEN_KEY!=='string'||env.WORKFLOW_TOKEN_KEY.length<32)throw new BackendError('WORKFLOW_CONFIG','Configure the private workflow-token encryption key.',503);return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.WORKFLOW_TOKEN_KEY)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
async function seal(env:Env,value:string){const iv=crypto.getRandomValues(new Uint8Array(12)),key=await cryptKey(env);return {iv:to64(iv),value:to64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value))))};}
async function open(env:Env,value:{iv:string;value:string}){return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(value.iv)},await cryptKey(env),from64(value.value)));}
export const workflowRequest=z.object({action:z.enum(['start','claim-approval','complete-approval','status']),changeId:z.string().uuid(),version:z.number().int().nonnegative(),confirm:z.literal(true)}).strict();
export async function runApprovalWorkflow(database:D1Database,env:Env,planId:string,identity:Identity,input:z.infer<typeof workflowRequest>,fetcher:typeof fetch=fetch){
 const repository=new PlanRepository(database),record=await repository.getPlan(planId,identity);if(record.role!=='owner')throw forbidden();if(record.version!==input.version)throw conflict();
 const changes=new PlanChangeService(database),change=await changes.get(planId,identity,input.changeId),id=`step-${change.id}`,arn=env.STEP_FUNCTIONS_STATE_MACHINE_ARN,activity=env.STEP_FUNCTIONS_ACTIVITY_ARN;
 if(typeof arn!=='string'||!/^arn:aws:states:ca-central-1:\d{12}:stateMachine:[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?$/.test(arn)||typeof activity!=='string'||!/^arn:aws:states:ca-central-1:\d{12}:activity:[A-Za-z0-9_-]+$/.test(activity))throw new BackendError('WORKFLOW_CONFIG','Configure a Canada Central STANDARD state machine and approval activity.',503);
 const now=new Date().toISOString(),payload={operationId:id,changeId:change.id,planId},request=JSON.stringify({stateMachineArn:arn,name:`planrecover-${change.id}`,input:JSON.stringify(payload)});
 await database.prepare("INSERT OR IGNORE INTO adapter_operations(id,owner,plan_id,member_id,provider,kind,request,created,updated) VALUES (?,?,?,?,'aws-step-functions','approval',?,?,?)").bind(id,record.owner,planId,identity.id,request,now,now).run();
 const row=await database.prepare('SELECT request,response,status,lease_until FROM adapter_operations WHERE id=? AND owner=? AND plan_id=?').bind(id,record.owner,planId).first<{request:string;response:string|null;status:string;lease_until:number}>();if(!row||row.request!==request)throw conflict();
 let saved=row.response?JSON.parse(row.response):{};
 if(input.action==='status')return {operationId:id,status:row.status,executionArn:saved.executionArn??null,hasApprovalToken:!!saved.token};
 if(input.action==='start'&&saved.executionArn)return {operationId:id,status:row.status,executionArn:saved.executionArn};
 const lease=crypto.randomUUID(),claim=await database.prepare('UPDATE adapter_operations SET lease_token=?,lease_until=? WHERE id=? AND lease_until<=?').bind(lease,Date.now()+90000,id,Date.now()).run();if(!claim.meta.changes)throw new BackendError('WORKFLOW_BUSY','This workflow request is already running.',409);
 try{
  if(input.action==='start'){const result=z.object({executionArn:z.string().regex(/^arn:aws:states:ca-central-1:\d{12}:execution:/)}).passthrough().parse(await awsJson(env,'states','StartExecution',JSON.parse(request),{fetch:fetcher}));saved={...saved,executionArn:result.executionArn};}
  else if(input.action==='claim-approval'){
   if(saved.token)return {operationId:id,status:'awaiting-approval',executionArn:saved.executionArn};if(!saved.executionArn)throw conflict();await cryptKey(env);
   const result=z.object({taskToken:z.string().max(2048).optional(),input:z.string().max(32000).optional()}).passthrough().parse(await awsJson(env,'states','GetActivityTask',{activityArn:activity,workerName:`planrecover-${change.id}`},{fetch:fetcher,timeoutMs:65000}));
   if(!result.taskToken)return {operationId:id,status:'no-task-available'};
   saved={...saved,token:await seal(env,result.taskToken),taskInput:result.input??''};
   await database.prepare("UPDATE adapter_operations SET response=?,status='awaiting-approval',updated=? WHERE id=? AND lease_token=?").bind(JSON.stringify(saved),now,id,lease).run();
   if(result.input!==JSON.stringify(payload))throw new BackendError('WORKFLOW_TASK_SCOPE','A different workflow task was safely retained for owner review.',409);
  }else{
   if(row.status==='completed')return {operationId:id,status:'completed',executionArn:saved.executionArn};
   if(row.status==='completing'){const result=await awsJson(env,'states','DescribeExecution',{executionArn:saved.executionArn},{fetch:fetcher});return {operationId:id,status:result.status==='SUCCEEDED'?'completed':'callback-needs-review',executionArn:saved.executionArn};}
   if(!saved.token||saved.taskInput!==JSON.stringify(payload)||!change.fullyApproved||change.status!=='review')throw forbidden();
   if(change.terms.originals.some(original=>{const item=record.state.items.find(i=>i.id===original.id);return !item||item.revision!==original.revision||item.source!==original.source||item.price!==original.price||JSON.stringify(item.shares)!==JSON.stringify(original.shares);})||change.terms.required.some(id=>!record.state.people?.some(m=>m.id===id&&['owner','editor'].includes(m.role))))throw conflict();
   await database.prepare("UPDATE adapter_operations SET status='completing' WHERE id=? AND lease_token=?").bind(id,lease).run();
   await awsJson(env,'states','SendTaskSuccess',{taskToken:await open(env,saved.token),output:JSON.stringify({...payload,approved:true,paymentAuthorized:false,requiresExplicitExecution:true})},{fetch:fetcher});
   saved={executionArn:saved.executionArn,approved:true};
  }
  const status=input.action==='complete-approval'?'completed':saved.token?'awaiting-approval':'started';await database.prepare('UPDATE adapter_operations SET status=?,response=?,updated=? WHERE id=? AND lease_token=?').bind(status,JSON.stringify(saved),new Date().toISOString(),id,lease).run();return {operationId:id,status,executionArn:saved.executionArn};
 }finally{await database.prepare('UPDATE adapter_operations SET lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?').bind(id,lease).run();}
}
