import {BackendError,conflict} from './backend-errors.ts';
import {PlanRepository} from './plan-repository.ts';
import type {Identity} from './people.ts';
import {savedToolResults} from './agent-checkpoints.ts';

type Row={id:string;owner:string;member_id:string;plan_id:string|null;context_actor:string;title:string;version:number;lease_token:string|null;lease_until:number;created:string;updated:string};
type Message={id:string;role:'user'|'assistant';text:string;mode:string;metadata:string;created:string};
const unavailable=()=>new BackendError('CONVERSATION_UNAVAILABLE','This conversation is unavailable.',404);
const busy=()=>new BackendError('CONVERSATION_BUSY','This message already started or another reply is in progress. Reopen the conversation to check it; a billed request is never retried automatically.',409);

/** Member-private transcripts. No read or replay executes a tool or invokes a model. */
export class ConversationRepository{
 constructor(private database:D1Database){}
 async ownerFor(identity:Identity,id:string){const row=await this.database.prepare('SELECT owner FROM assistant_conversations WHERE id=? AND member_id=?').bind(id,identity.id).first<{owner:string}>();if(!row)throw unavailable();return row.owner;}
 private async accessible(owner:string,identity:Identity,id:string,actor?:string){
  const row=await this.database.prepare('SELECT * FROM assistant_conversations WHERE id=? AND owner=? AND member_id=?').bind(id,owner,identity.id).first<Row>();
  if(!row||(actor!==undefined&&row.context_actor!==actor))throw unavailable();
  const plan=row.plan_id?await new PlanRepository(this.database).getPlan(row.plan_id,identity):null;
  return {row,plan};
 }
 async list(owner:string,identity:Identity,planId?:string,actor=''){
  if(planId)await new PlanRepository(this.database).getPlan(planId,identity);
  const rows=await this.database.prepare(`SELECT id,title,plan_id,context_actor,version,updated FROM assistant_conversations WHERE owner=? AND member_id=? AND context_actor=? AND ${planId?'plan_id=?':'plan_id IS NULL'} ORDER BY updated DESC,id DESC LIMIT 50`).bind(owner,identity.id,actor,...(planId?[planId]:[])).all();return rows.results;
 }
 async create(owner:string,identity:Identity,planId:string|null,title='New conversation',actor=''){
  const plan=planId?await new PlanRepository(this.database).getPlan(planId,identity):null;
  const id=crypto.randomUUID(),now=new Date().toISOString();
  const result=await this.database.prepare(`INSERT INTO assistant_conversations(id,owner,member_id,plan_id,context_actor,title,created,updated) SELECT ?,?,?,?,?,?,?,? ${plan?"WHERE EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role<>'legacy')":''}`)
   .bind(id,owner,identity.id,planId,actor,title.slice(0,100),now,now,...(plan?[plan.owner,planId,identity.id]:[])).run();
  if(!result.meta.changes)throw unavailable();return this.read(owner,identity,id,undefined,actor);
 }
 async read(owner:string,identity:Identity,id:string,before?:string,actor?:string){
  const {row,plan}=await this.accessible(owner,identity,id,actor);
  const cursor=before?await this.database.prepare('SELECT id,created FROM assistant_messages WHERE conversation_id=? AND id=?').bind(id,before).first<{id:string;created:string}>():null;
  if(before&&!cursor)throw new BackendError('CONVERSATION_CURSOR','This conversation page is unavailable.',400);
  const records=await this.database.prepare(`SELECT * FROM assistant_messages WHERE conversation_id=? ${cursor?'AND (created<? OR (created=? AND id<?))':''} ORDER BY created DESC,id DESC LIMIT 51`).bind(id,...(cursor?[cursor.created,cursor.created,cursor.id]:[])).all<Message>();
  const limited=records.results.slice(0,50),messages=limited.reverse().map(message=>({...message,metadata:JSON.parse(message.metadata)}));
  return {id:row.id,title:row.title,planId:row.plan_id,contextActor:row.context_actor,version:row.version,messages,hasMore:records.results.length>50,nextBefore:records.results.length>50?messages[0]?.id:null,
   prepared:await savedToolResults(this.database,owner,identity.id,id),pending:!!row.lease_token&&row.lease_until>Date.now(),pendingUntil:row.lease_until,planVersion:plan?.version??null};
 }
 async begin(owner:string,identity:Identity,id:string,expected:number,requestId:string,input:string,actor=''){
  const {row,plan}=await this.accessible(owner,identity,id,actor);
  const prior=await this.database.prepare('SELECT role,text,mode,metadata FROM assistant_messages WHERE conversation_id=? AND request_id=?').bind(id,requestId).all<Pick<Message,'role'|'text'|'mode'|'metadata'>>();
  const user=prior.results.find(message=>message.role==='user'),answer=prior.results.find(message=>message.role==='assistant');
  if(user&&user.text!==input)throw new BackendError('CONVERSATION_REQUEST','Use a new request ID for a different message.',409);
  if(answer)return {duplicate:{...JSON.parse(answer.metadata),reply:answer.text,mode:answer.mode,conversationVersion:row.version},token:null};
  if(user)throw busy();
  if(row.version!==expected)throw conflict();
  const token=crypto.randomUUID(),guard=crypto.randomUUID(),now=Date.now(),stamp=new Date(now).toISOString();
  try{await this.database.batch([
   this.database.prepare(`UPDATE assistant_conversations SET version=version+1,lease_token=?,lease_until=?,updated=?,title=CASE WHEN version=0 THEN ? ELSE title END WHERE id=? AND owner=? AND member_id=? AND context_actor=? AND version=? AND lease_until<=? ${plan?"AND EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role<>'legacy')":''}`)
    .bind(token,now+90_000,stamp,input.slice(0,100),id,owner,identity.id,actor,expected,now,...(plan?[plan.owner,row.plan_id,identity.id]:[])),
   this.database.prepare('INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)').bind(guard),
   this.database.prepare("UPDATE assistant_messages SET mode='interrupted' WHERE conversation_id=? AND role='user' AND mode='pending'").bind(id),
   this.database.prepare("INSERT INTO assistant_messages(id,conversation_id,request_id,role,text,mode,metadata,created) VALUES (?,?,?,'user',?,'pending','{}',?)").bind(`${id}:${String(expected+1).padStart(12,'0')}-0`,id,requestId,input,stamp),
   this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard),
  ]);}catch(error){if(/constraint|backend_write_guard/i.test(String(error)))throw conflict();throw error;}
  return {token,duplicate:null};
 }
 async finish(owner:string,identity:Identity,id:string,expected:number,token:string,requestId:string,input:string,reply:string,mode:string,metadata:Record<string,unknown>={},planVersion?:number){
  const {row,plan}=await this.accessible(owner,identity,id);
  if(row.lease_token!==token||row.version!==expected+1||row.lease_until<=Date.now()||(planVersion!==undefined&&plan?.version!==planVersion))throw conflict();
  const guard=crypto.randomUUID(),now=new Date().toISOString(),body=JSON.stringify(metadata);
  if(body.length>128_000)throw new BackendError('CONVERSATION_SIZE','The conversation result is too large to save.',413);
  try{await this.database.batch([
   this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM assistant_conversations WHERE id=? AND owner=? AND member_id=? AND version=? AND lease_token=? AND lease_until>?) ${plan?"AND EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=? AND p.id=? AND p.version=? AND p.status<>'deleted' AND m.member_id=? AND m.role<>'legacy')":''} THEN 1 ELSE 0 END)`)
    .bind(guard,id,owner,identity.id,expected+1,token,Date.now(),...(plan?[plan.owner,row.plan_id,planVersion??plan.version,identity.id]:[])),
   this.database.prepare("INSERT INTO assistant_messages(id,conversation_id,request_id,role,text,mode,metadata,created) VALUES (?,?,?,'assistant',?,?,?,?)").bind(`${id}:${String(expected+1).padStart(12,'0')}-1`,id,requestId,reply,mode,body,now),
   this.database.prepare("UPDATE assistant_messages SET mode='complete' WHERE conversation_id=? AND request_id=? AND role='user' AND text=?").bind(id,requestId,input),
   this.database.prepare('UPDATE assistant_conversations SET lease_token=NULL,lease_until=0,updated=? WHERE id=? AND lease_token=?').bind(now,id,token),
   this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard),
  ]);}catch(error){if(/constraint|backend_write_guard/i.test(String(error)))throw conflict();throw error;}
 }
 async release(id:string,token:string){await this.database.batch([
  this.database.prepare("UPDATE assistant_messages SET mode='interrupted' WHERE conversation_id=? AND role='user' AND mode='pending' AND EXISTS(SELECT 1 FROM assistant_conversations WHERE id=? AND lease_token=?)").bind(id,id,token),
  this.database.prepare('UPDATE assistant_conversations SET lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?').bind(id,token),
 ]);}
}
