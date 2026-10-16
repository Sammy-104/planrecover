import {sha256} from './financial-history.ts';
import {BackendError,conflict} from './backend-errors.ts';
import type {Identity} from './people.ts';

export type AgentTurn={conversationId:string;requestId:string;conversationOwner?:string};
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)]));return value;}
export async function checkpointTool(database:D1Database,owner:string,identity:Identity,turn:AgentTurn,name:string,input:unknown,execute:(proposalId:string)=>Promise<unknown>){
 const conversation=await database.prepare('SELECT id FROM assistant_conversations WHERE id=? AND owner=? AND member_id=?').bind(turn.conversationId,owner,identity.id).first();
 if(!conversation)throw new BackendError('CONVERSATION_UNAVAILABLE','This conversation is unavailable.',404);
 const body=JSON.stringify(canonical(input)),hash=await sha256(JSON.stringify([owner,identity.id,turn.conversationId,turn.requestId,name,body]));
 const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
 await database.prepare('INSERT OR IGNORE INTO agent_tool_calls(id,owner,member_id,conversation_id,request_id,tool_name,input,created) VALUES (?,?,?,?,?,?,?,?)').bind(id,owner,identity.id,turn.conversationId,turn.requestId,name,body,new Date().toISOString()).run();
 const prior=await database.prepare('SELECT input,result FROM agent_tool_calls WHERE id=? AND owner=? AND member_id=?').bind(id,owner,identity.id).first<{input:string;result:string|null}>();
 if(!prior||prior.input!==body)throw conflict();if(prior.result)return JSON.parse(prior.result);
 // Preparation services use this stable ID too: a crash between their write and this checkpoint cannot create another preview.
 const result=await execute(id),json=JSON.stringify(result);
 if(json.length>24000)throw new BackendError('AGENT_RESULT_SIZE','This preview is too large.');
 await database.prepare("UPDATE agent_tool_calls SET result=?,status='completed' WHERE id=? AND result IS NULL").bind(json,id).run();
 return JSON.parse((await database.prepare('SELECT result FROM agent_tool_calls WHERE id=?').bind(id).first<{result:string}>())!.result);
}
export async function savedToolResults(database:D1Database,owner:string,memberId:string,conversationId:string,requestId?:string){
 const rows=await database.prepare(`SELECT tool_name,result FROM agent_tool_calls WHERE owner=? AND member_id=? AND conversation_id=? AND result IS NOT NULL ${requestId?'AND request_id=?':''} ORDER BY created,id LIMIT 100`).bind(owner,memberId,conversationId,...(requestId?[requestId]:[])).all<{tool_name:string;result:string}>();
 return rows.results.map(row=>({name:row.tool_name,result:JSON.parse(row.result)}));
}
