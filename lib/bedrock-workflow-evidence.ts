import {bedrockConfigurationHash} from './bedrock-operations.ts';

/** Only authenticated server handlers may record these facts, after checking the
 * actual saved/read-back artifact or constructing the validated preview. None
 * of these scopes certifies a later review, approval or financial action. */
export const BEDROCK_WORKFLOW_SCOPES={
 'saved-chat-readback':{feature:'chat',sources:['chat','agent']},
 'saved-agent-proposal-readback':{feature:'agent',sources:['agent']},
 'draft-preview-constructed':{feature:'plan-draft',sources:['plan-draft']},
 'saved-image-receipt-readback':{feature:'receipt-image',sources:['receipt-image']},
 'saved-pdf-receipt-readback':{feature:'receipt-pdf',sources:['receipt-pdf']},
} as const;
export type BedrockWorkflowScope=keyof typeof BEDROCK_WORKFLOW_SCOPES;
export type BedrockWorkflowFeature=typeof BEDROCK_WORKFLOW_SCOPES[BedrockWorkflowScope]['feature'];
export type BedrockWorkflowProof={owner:string;memberId:string;planId:string;operationId:string;scope:BedrockWorkflowScope;proofReference:string};
export type BedrockWorkflowFact={feature:BedrockWorkflowFeature;scope:BedrockWorkflowScope;status:'unverified'|'observed';count:number;lastObservedAt:string|null};
export type BedrockWorkflowEvidence={scope:'current-configuration-authenticated-server-observations';verification:'unverified'|'partially-observed'|'scoped-observations-recorded';features:Record<BedrockWorkflowFeature,BedrockWorkflowFact>;limitations:'Preview and saved-result checks do not certify review, approval, accuracy or a production workflow.'};
const validId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=300&&!/[\x00-\x1f\x7f]/.test(value);
async function referenceHash(scope:BedrockWorkflowScope,reference:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${scope}\0${reference}`)))].map(value=>value.toString(16).padStart(2,'0')).join('');}

/** A caller cannot create a passed flag: a matching succeeded tracked operation,
 * successful model invocation and current plan membership must all still exist.
 * Artifact references are hashed; prompts, replies and receipt contents are not
 * retained here. Duplicate proofs never inflate counts or change timestamps. */
export async function recordBedrockWorkflowEvidence(database:D1Database,settings:Record<string,unknown>,proof:BedrockWorkflowProof,now=Date.now()):Promise<boolean>{
 if(!proof||!Object.prototype.hasOwnProperty.call(BEDROCK_WORKFLOW_SCOPES,proof.scope)||![proof.owner,proof.memberId,proof.planId,proof.operationId].every(validId)||typeof proof.proofReference!=='string'||!proof.proofReference.length||proof.proofReference.length>2000||!Number.isSafeInteger(now)||now<0||now>8_640_000_000_000_000)return false;
 const definition=BEDROCK_WORKFLOW_SCOPES[proof.scope],configurationHash=await bedrockConfigurationHash(settings),reference=await referenceHash(proof.scope,proof.proofReference);
 const sources=definition.sources as readonly string[];
 const eligible=`o.id=? AND o.owner=? AND o.member_id=? AND o.plan_id=? AND o.configuration_hash=? AND o.feature IN (${sources.map(()=>'?').join(',')}) AND o.state='succeeded'
   AND EXISTS(SELECT 1 FROM bedrock_invocations i WHERE i.operation_id=o.id AND i.state='succeeded')
   AND NOT EXISTS(SELECT 1 FROM bedrock_invocations i WHERE i.operation_id=o.id AND i.state<>'succeeded')
   AND EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id WHERE p.owner=o.owner AND p.id=o.plan_id AND p.status<>'deleted' AND m.member_id=o.member_id AND m.role<>'legacy')`;
 const eligibilityValues=[proof.operationId,proof.owner,proof.memberId,proof.planId,configurationHash,...sources];
 await database.prepare(`INSERT OR IGNORE INTO bedrock_workflow_evidence(id,operation_id,owner,member_id,plan_id,feature,configuration_hash,scope,reference_hash,created_at)
  SELECT ?,o.id,o.owner,o.member_id,o.plan_id,?,o.configuration_hash,?,?,? FROM bedrock_operations o
  WHERE ${eligible}`).bind(crypto.randomUUID(),definition.feature,proof.scope,reference,now,...eligibilityValues).run();
 const saved=await database.prepare(`SELECT 1 AS found FROM bedrock_workflow_evidence e JOIN bedrock_operations o ON o.id=e.operation_id
  WHERE ${eligible} AND e.owner=o.owner AND e.member_id=o.member_id AND e.plan_id=o.plan_id AND e.configuration_hash=o.configuration_hash AND e.feature=? AND e.scope=? AND e.reference_hash=?`)
  .bind(...eligibilityValues,definition.feature,proof.scope,reference).first();
 return !!saved;
}

/** Read-only, owner/plan scoped facts for the exact current server settings.
 * This deliberately cannot promote provider success into read-back evidence. */
export async function readBedrockWorkflowEvidence(database:D1Database,settings:Record<string,unknown>,owner:string,planId:string):Promise<BedrockWorkflowEvidence>{
 const features={} as BedrockWorkflowEvidence['features'];
 for(const [scope,definition] of Object.entries(BEDROCK_WORKFLOW_SCOPES))features[definition.feature]={feature:definition.feature,scope:scope as BedrockWorkflowScope,status:'unverified',count:0,lastObservedAt:null};
 const result:BedrockWorkflowEvidence={scope:'current-configuration-authenticated-server-observations',verification:'unverified',features,limitations:'Preview and saved-result checks do not certify review, approval, accuracy or a production workflow.'};
 let configurationHash:string;try{configurationHash=await bedrockConfigurationHash(settings);}catch{return result;}
 const rows=await database.prepare(`SELECT e.feature,e.scope,o.feature AS source_feature,COUNT(*) AS count,MAX(e.created_at) AS observed_at FROM bedrock_workflow_evidence e
  JOIN bedrock_operations o ON o.id=e.operation_id AND o.owner=e.owner AND o.member_id=e.member_id AND o.plan_id=e.plan_id AND o.configuration_hash=e.configuration_hash
  WHERE e.owner=? AND e.plan_id=? AND e.configuration_hash=? AND o.state='succeeded'
   AND EXISTS(SELECT 1 FROM bedrock_invocations i WHERE i.operation_id=o.id AND i.state='succeeded')
   AND NOT EXISTS(SELECT 1 FROM bedrock_invocations i WHERE i.operation_id=o.id AND i.state<>'succeeded')
  GROUP BY e.feature,e.scope,o.feature`).bind(owner,planId,configurationHash).all<{feature:string;scope:string;source_feature:string;count:number;observed_at:number}>();
 for(const row of rows.results){
  if(!Object.prototype.hasOwnProperty.call(BEDROCK_WORKFLOW_SCOPES,row.scope))continue;
  const definition=BEDROCK_WORKFLOW_SCOPES[row.scope as BedrockWorkflowScope];
  if(definition.feature!==row.feature||!(definition.sources as readonly string[]).includes(row.source_feature)||!Number.isSafeInteger(row.count)||row.count<1||!Number.isSafeInteger(row.observed_at)||row.observed_at<0||row.observed_at>8_640_000_000_000_000)continue;
  const previous=features[definition.feature],observedAt=new Date(row.observed_at).toISOString();
  features[definition.feature]={feature:definition.feature,scope:row.scope as BedrockWorkflowScope,status:'observed',count:previous.count+row.count,lastObservedAt:previous.lastObservedAt&&previous.lastObservedAt>observedAt?previous.lastObservedAt:observedAt};
 }
 const observed=Object.values(features).filter(feature=>feature.status==='observed').length;
 result.verification=observed===Object.keys(features).length?'scoped-observations-recorded':observed?'partially-observed':'unverified';
 return result;
}
