import { z } from 'zod';
import { BackendError, conflict, forbidden, missingPlan } from './backend-errors.ts';
import { allocate, type Item, type MoneyEvent, type State } from './model.ts';
import { planCurrency } from './money.ts';
import { hasMerchantCheckout } from './merchant-scope.ts';
import { dataTripId, providerCents, requireCaptureLedgerMatch, verifiedOrderCapture, type PaymentOperation, type ProviderOrder } from './payment-guards.ts';
import { relatedCaptureId, type ProviderRefund } from './paypal-webhooks.ts';
import { PlanRepository } from './plan-repository.ts';
import { mergeSharedTrip, sharedTripView } from './trip-sharing.ts';
import { commitFinancialEffect, saveProviderRequestIntent,sha256 } from './financial-history.ts';
import {assertDependenciesReviewed} from './dependencies.ts';

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const units = z.number().int().min(0).max(1_000_000_000_000);
const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sourceUrl = z.string().url().max(2000).refine(value => {
  const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password;
}, 'Use an HTTPS supplier source without credentials.');
export const bookingPolicyRequest = z.object({
  type: z.literal('register-policy'), version, itemId: identifier, revision: version,
  policy: z.object({ merchant: z.enum(['fictional-sandbox', 'external-manual']),
    merchantName: z.string().trim().min(1).max(200), confirmedTerms: z.literal(true),
    terms: z.string().trim().min(10).max(5000), evidence: z.string().trim().min(10).max(5000), sourceUrl,
    refundableBps: z.number().int().min(0).max(10_000), cancellationFeeUnits: units,
    cutoff: z.string().datetime({ offset: true }).nullable(),
  }).strict(),
}).strict();
export const recoveryRequest = z.discriminatedUnion('type', [bookingPolicyRequest,
  z.object({type:z.literal('propose'), version, policyId:identifier, reason:z.string().trim().min(10).max(2000),
    refundAmounts:z.record(identifier, units).optional()}).strict(),
  z.object({type:z.literal('approve'), proposalId:identifier, version:version.refine(v=>v>0), planVersion:version}).strict(),
  z.object({type:z.literal('execute'), proposalId:identifier, version:version.refine(v=>v>0), planVersion:version,
    confirmSandboxRefunds:z.literal(true)}).strict(),
  z.object({type:z.literal('cancel-proposal'), proposalId:identifier, version:version.refine(v=>v>0), planVersion:version}).strict(),
]);

export type RecoveryScope = {owner:string; planId:string; memberId:string};
export type BookingPolicy = z.infer<typeof bookingPolicyRequest>['policy'] & {
  id:string; itemId:string; itemRevision:number; currency:string; itemPrice:number;
  participants:string[]; shares:Record<string,number>; source:string; confirmedBy:string; created:string;
};
type CaptureAllocation = {captureId:string; operationId:string; memberId:string; captured:number; amount:number; currency:string;costShares?:Record<string,number>;policyMaximum?:number};
type ProposalBody = {policy:BookingPolicy; reason:string; fingerprint:string; required:string[];
  allocations:CaptureAllocation[];invoiceRefunds?:{id:string;invoiceId:string;memberId:string;amount:number;expectedTotal:number;baseline:string[]}[]; dependentItems:{id:string;name:string;revision:number}[]};
async function invoiceRefundIntentReady(database:D1Database,owner:string,planId:string,invoice:NonNullable<ProposalBody['invoiceRefunds']>[number]){
 return !!await database.prepare(`SELECT 1 AS ready FROM invoice_refund_requests q WHERE q.id=? AND q.owner=? AND q.plan_id=? AND q.invoice_id=? AND q.amount=?
  AND q.approved_owner=1 AND q.approved_member=1 AND q.status='completed' AND q.amount=(SELECT COALESCE(SUM(a.amount),0) FROM invoice_refund_allocations a WHERE a.request_id=q.id)`)
  .bind(invoice.id,owner,planId,invoice.invoiceId,invoice.amount).first();
}
async function invoiceRecoveryReady(database:D1Database,owner:string,planId:string,snapshot:ProposalBody){
 for(const invoice of snapshot.invoiceRefunds??[])if(!await invoiceRefundIntentReady(database,owner,planId,invoice))return false;
 const open=await database.prepare("SELECT COUNT(*) AS n FROM plan_invoices i WHERE i.owner=? AND i.plan_id=? AND i.item_id=? AND i.paid>0 AND i.paid<i.amount AND i.status<>'cancelled' AND NOT EXISTS(SELECT 1 FROM invoice_collection_closures c WHERE c.invoice_id=i.id AND c.status='verified')").bind(owner,planId,snapshot.policy.itemId).first<{n:number}>();return !open?.n;
}
type ProposalRow = {id:string;owner:string;plan_id:string;policy_id:string;plan_version:number;version:number;
  status:'review'|'executing'|'completed'|'manual-review'|'cancelled';body:string;created_by:string;created:string;updated:string};
type ReservationRow = {id:string;proposal_id:string;capture_id:string;member_id:string;amount:number;currency:string;
  status:'reserved'|'submitted'|'confirmed'|'failed'|'manual-review';refund_id:string|null;created:string;updated:string};
export type RecoveryProposal = {id:string;planId:string;planVersion:number;version:number;status:ProposalRow['status'];
  snapshot:ProposalBody; approved:string[]; fullyApproved:boolean; reservations:ReservationRow[];created:string;updated:string};
export type CanonicalCapture = {id?:string;status?:string;amount?:{currency_code?:string;value?:string}};
export type RecoveryDependencies = {
  database:D1Database; now?:()=>Date;
  fetchOrder:(id:string)=>Promise<ProviderOrder>;
  fetchCapture:(id:string)=>Promise<CanonicalCapture>;
  createRefund:(captureId:string,amount:number,currency:string,requestId:string)=>Promise<ProviderRefund>;
  fetchRefund:(id:string)=>Promise<ProviderRefund>;
  commitRefund:(input:{owner:string;planId:string;event:MoneyEvent;operationId:string;statements:D1PreparedStatement[]})=>Promise<unknown>;
  cancelBooking:(input:{scope:RecoveryScope;itemId:string;fingerprint:string;proposalId:string;statements:D1PreparedStatement[]})=>Promise<unknown>;
};
const unavailable=()=>new BackendError('RECOVERY_UNAVAILABLE','This recovery proposal is unavailable.',404);
const executionLeaseMs=60_000;
const executionChanged=()=>new BackendError('RECOVERY_EXECUTION_CHANGED','This recovery execution expired or another request took over. Refresh before resuming.',409);
function invalid(message:string){return new BackendError('INVALID_RECOVERY',message);}
function captureMismatch(){return new BackendError('CAPTURE_MISMATCH','The original sandbox capture needs merchant review.',409);}
export function recoveryRefundBody(amount:number,currency:string) {
  if(currency!=='CAD'||!Number.isSafeInteger(amount)||amount<=0)throw captureMismatch();
  return {amount:{currency_code:currency,value:(amount/100).toFixed(2)},
    note_to_payer:'Explicitly approved PlanRecover sandbox cancellation'};
}

/** A refunded capture proves its original expense. This does not prove that any
 * individual refund completed; each refund still requires a canonical read. */
export function verifiedRecoveryOrderCapture(operation:PaymentOperation,order:ProviderOrder) {
  const normalized=structuredClone(order),capture=normalized.purchase_units?.[0]?.payments?.captures?.[0];
  if(!capture||!['COMPLETED','PARTIALLY_REFUNDED','REFUNDED'].includes(capture.status??''))throw captureMismatch();
  capture.status='COMPLETED';return verifiedOrderCapture(operation,normalized);
}

/** Excludes completion/payment projections but includes every approved booking term. */
export function recoveryItemFingerprint(item:Item) {
  return JSON.stringify({id:item.id,name:item.name,revision:item.revision,price:item.price,
    participants:[...item.participants].sort(),shares:Object.fromEntries(Object.entries(item.shares).sort()),
    required:[...(item.required??item.participants)].sort(),approvals:[...item.approvals].sort(),
    source:item.source,sourceUrl:item.sourceUrl??null,policy:item.policy,deadline:item.deadline,expires:item.expires,
    start:item.start,duration:item.duration,depends:[...item.depends].sort(),...(item.dependencyEvidence?{dependencyEvidence:item.dependencyEvidence}:{}),...(item.funding?{funding:item.funding}:{})});
}
export function maximumCaptureRefund(captured:number,bps:number,fee:number) {
  if(!Number.isSafeInteger(captured)||captured<=0||!Number.isInteger(bps)||bps<0||bps>10_000||!Number.isSafeInteger(fee)||fee<0)
    throw invalid('Refund terms must use exact non-negative currency units.');
  return Math.max(0,Number(BigInt(captured)*BigInt(bps)/BigInt(10_000))-fee);
}

export type CaptureRefundReservation = {reservationId:string;owner:string;planId:string;itemId:string;memberId:string;
  captureId:string;currency:string;captured:number;amount:number};
/** Shared with the legacy refund endpoint. Commit these statements together with
 * the durable operation carrying planrecoverCapacityReserved=true. The current
 * operation gets one immutable claim, including legacy backfills and retries. */
export async function reserveCaptureRefund(database:D1Database,input:CaptureRefundReservation,now=new Date().toISOString()) {
  if(input.currency!=='CAD'||!Number.isSafeInteger(input.amount)||input.amount<=0||input.amount>input.captured)throw captureMismatch();
  const legacy=await database.prepare("SELECT id,amount,status,payload FROM provider_operations WHERE owner=? AND kind='refund' AND status NOT IN ('failed','denied','cancelled')")
    .bind(input.owner).all<{id:string;amount:number;status:string;payload:string|null}>();
  const oldClaims:{id:string;amount:number;status:'reserved'|'confirmed'}[]=[];
  for(const operation of legacy.results) {
    let payload:Record<string,unknown>;try{payload=JSON.parse(operation.payload??'{}');}catch{throw captureMismatch();}
    if(payload.planrecoverCapacityReserved||payload.planrecoverRecoveryReservationId)continue;
    if((payload.planrecoverCaptureId??payload.captureId)!==input.captureId)continue;
    if(!Number.isSafeInteger(operation.amount)||operation.amount<=0||operation.amount>input.captured)throw captureMismatch();
    oldClaims.push({id:operation.id,amount:operation.amount,status:operation.status==='refunded'||operation.status==='confirmed'?'confirmed':'reserved'});
  }
  const guard=`capacity-${crypto.randomUUID()}`;
  const statements=[database.prepare(`INSERT OR IGNORE INTO capture_refund_capacity
    (capture_id,owner,plan_id,item_id,member_id,currency,captured,reserved,refunded,updated) VALUES (?,?,?,?,?,?,?,0,0,?)`)
    .bind(input.captureId,input.owner,input.planId,input.itemId,input.memberId,input.currency,input.captured,now),
    database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(
      SELECT 1 FROM capture_refund_capacity WHERE capture_id=? AND owner=? AND plan_id=? AND item_id=? AND member_id=? AND currency=?
      AND captured=?) THEN 1 ELSE 0 END)`)
      .bind(guard,input.captureId,input.owner,input.planId,input.itemId,input.memberId,input.currency,input.captured)];
  for(const claim of [...oldClaims,...(!oldClaims.some(claim=>claim.id===input.reservationId)?[{id:input.reservationId,amount:input.amount,status:'reserved' as const}]:[])]) {
    const claimGuard=crypto.randomUUID();
    statements.push(database.prepare(`UPDATE capture_refund_capacity SET ${claim.status==='confirmed'?'refunded':'reserved'}=${claim.status==='confirmed'?'refunded':'reserved'}+?,updated=?
      WHERE capture_id=? AND NOT EXISTS(SELECT 1 FROM capture_refund_claims WHERE id=?)`).bind(claim.amount,now,input.captureId,claim.id));
    statements.push(database.prepare('INSERT OR IGNORE INTO capture_refund_claims(id,capture_id,amount,status,created) VALUES (?,?,?,?,?)')
      .bind(claim.id,input.captureId,claim.amount,claim.status,now));
    statements.push(database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(
      SELECT 1 FROM capture_refund_claims WHERE id=? AND capture_id=? AND amount=?) THEN 1 ELSE 0 END)`)
      .bind(claimGuard,claim.id,input.captureId,claim.amount));
    statements.push(database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(claimGuard));
  }
  statements.push(database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(
    SELECT 1 FROM capture_refund_claims WHERE id=? AND capture_id=? AND amount=?) THEN 1 ELSE 0 END)`)
    .bind(`${guard}-current`,input.reservationId,input.captureId,input.amount));
  statements.push(database.prepare('DELETE FROM backend_write_guards WHERE id IN (?,?)').bind(guard,`${guard}-current`));
  return statements;
}

/** Confirmation is idempotent even when a webhook and an owner request race. */
export function confirmCaptureRefund(database:D1Database,input:{reservationId:string;captureId:string;amount:number},now=new Date().toISOString()) {
  const guard=crypto.randomUUID();
  return [database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(
    SELECT 1 FROM capture_refund_claims WHERE id=? AND capture_id=? AND amount=? AND status IN ('reserved','confirmed')) THEN 1 ELSE 0 END)`)
    .bind(guard,input.reservationId,input.captureId,input.amount),
    database.prepare(`UPDATE capture_refund_capacity SET reserved=reserved-?,refunded=refunded+?,updated=? WHERE capture_id=? AND
      EXISTS(SELECT 1 FROM capture_refund_claims WHERE id=? AND capture_id=? AND amount=? AND status='reserved')`)
      .bind(input.amount,input.amount,now,input.captureId,input.reservationId,input.captureId,input.amount),
    database.prepare("UPDATE capture_refund_claims SET status='confirmed' WHERE id=? AND capture_id=? AND amount=? AND status='reserved'")
      .bind(input.reservationId,input.captureId,input.amount),database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard)];
}

/** Cancellation and proposal completion share the same versioned transaction. */
export async function cancelRecoveredBooking(database:D1Database,input:Parameters<RecoveryDependencies['cancelBooking']>[0]) {
  const repository=new PlanRepository(database);
  for(let attempt=0;attempt<3;attempt++) {
    const record=await repository.getPlan(input.scope.planId,{id:input.scope.memberId,name:'Plan member'});
    if(record.owner!==input.scope.owner||record.role!=='owner')throw forbidden();
    const root=await repository.loadWorkspace(input.scope.owner);if(!root)throw missingPlan();
    const target=sharedTripView(root,input.scope.planId),item=target.items.find(item=>item.id===input.itemId);
    assertDependenciesReviewed(target.items,target.items.filter(item=>item.status!=='cancelled').map(item=>item.id));
    if(!item||recoveryItemFingerprint(item)!==input.fingerprint)throw conflict();
    const proposal=await database.prepare('SELECT body,version FROM recovery_proposals WHERE id=? AND owner=? AND plan_id=?')
      .bind(input.proposalId,input.scope.owner,input.scope.planId).first<{body:string;version:number}>();
    if(!proposal)throw unavailable();const snapshot=JSON.parse(proposal.body) as ProposalBody;
    if(!await invoiceRecoveryReady(database,input.scope.owner,input.scope.planId,snapshot))throw new BackendError('INVOICE_REFUND_PENDING','Complete the approved invoice refund and closure checks first.',409);
    if(snapshot.fingerprint!==input.fingerprint||snapshot.required.some(id=>!target.people?.some(person=>person.id===id&&person.role!=='legacy')))throw conflict();
    if(target.items.some(candidate=>candidate.status!=='cancelled'&&candidate.depends.includes(item.id)))
      throw new BackendError('RECOVERY_DEPENDENCIES','Review dependent bookings before cancellation.',409);
    item.status='cancelled';target.reminders=target.reminders.filter(reminder=>reminder.itemId!==item.id);
    if(!target.audit.some(entry=>entry.id===`recovery-${input.proposalId}`))target.audit.push({id:`recovery-${input.proposalId}`,
      at:new Date().toISOString(),actorId:input.scope.memberId,text:`Approved recovery cancelled ${item.name}.`,
      detail:`Saved recovery ${input.proposalId}; provider-confirmed refunds are recorded separately.`});
    const guard=crypto.randomUUID(),effects=[database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN
      EXISTS(SELECT 1 FROM recovery_proposals WHERE id=? AND owner=? AND plan_id=? AND status IN ('executing','manual-review'))
      AND NOT EXISTS(SELECT 1 FROM refund_reservations WHERE proposal_id=? AND status<>'confirmed')
      AND NOT EXISTS(SELECT 1 FROM json_each(?) member WHERE NOT EXISTS(SELECT 1 FROM recovery_approvals WHERE proposal_id=? AND version=? AND member_id=member.value))
      THEN 1 ELSE 0 END)`)
      .bind(guard,input.proposalId,input.scope.owner,input.scope.planId,input.proposalId,JSON.stringify(snapshot.required),input.proposalId,proposal.version),...input.statements,
      database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard)];
    try{return await repository.saveWorkspace(input.scope.owner,mergeSharedTrip(root,target,input.scope.planId),root.version,
      {planId:input.scope.planId,version:record.version,memberId:input.scope.memberId},undefined,effects);}
    catch(error){if(error instanceof BackendError&&error.status===409&&attempt<2)continue;throw error;}
  }
  throw conflict();
}

/** Current terms are never inferred from AI output or from free-text booking policy. */
export class RecoveryService {
  private database:D1Database;
  private now:()=>Date;
  constructor(private dependencies:RecoveryDependencies){this.database=dependencies.database;this.now=dependencies.now??(()=>new Date());}
  private async plan(scope:RecoveryScope,ownerOnly=false) {
    const row=await this.database.prepare(`SELECT p.body,p.version,m.role FROM plans p
      JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
      WHERE p.owner=? AND p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role<>'legacy'`)
      .bind(scope.owner,scope.planId,scope.memberId).first<{body:string;version:number;role:string}>();
    if(!row)throw missingPlan();if(ownerOnly&&row.role!=='owner')throw forbidden();
    return {state:{...JSON.parse(row.body),version:row.version} as State,version:row.version,role:row.role};
  }
  private accessCondition(ownerOnly=false) {
    return `EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
      WHERE p.owner=? AND p.id=? AND p.version=? AND p.status<>'deleted' AND m.member_id=? AND
      m.role ${ownerOnly?"='owner'":"IN ('owner','editor','viewer')"})`;
  }
  private async renewExecution(scope:RecoveryScope,proposalId:string,token:string) {
    const now=this.now().getTime();
    const renewed=await this.database.prepare(`UPDATE recovery_proposals SET execution_until=?
      WHERE id=? AND owner=? AND plan_id=? AND execution_token=? AND execution_until>?
      AND status IN ('review','executing','manual-review') RETURNING execution_token`)
      .bind(now+executionLeaseMs,proposalId,scope.owner,scope.planId,token,now).first<{execution_token:string}>();
    if(renewed?.execution_token!==token)throw executionChanged();
  }
  private async assertSubmissionCurrent(scope:RecoveryScope,proposal:RecoveryProposal,token:string) {
    const current=await this.plan(scope,true);
    this.assertCurrent(proposal,current.state,current.version,current.version);
    if(proposal.snapshot.policy.cutoff&&Date.parse(proposal.snapshot.policy.cutoff)<=this.now().getTime())
      throw new BackendError('CANCELLATION_CUTOFF','The cancellation cutoff passed. Review this saved request with the merchant.',409);
    if(current.state.items.some(item=>item.status!=='cancelled'&&item.depends.includes(proposal.snapshot.policy.itemId)))
      throw new BackendError('RECOVERY_DEPENDENCIES','Review dependent bookings before submitting another refund.',409);
    // Fence the last read and lease renewal in one statement before the POST.
    const now=this.now().getTime();
    const renewed=await this.database.prepare(`UPDATE recovery_proposals SET execution_until=?
      WHERE id=? AND version=? AND execution_token=? AND execution_until>? AND status IN ('executing','manual-review')
      AND ${this.accessCondition(true)}
      AND NOT EXISTS(SELECT 1 FROM json_each(?) member WHERE NOT EXISTS(
        SELECT 1 FROM recovery_approvals WHERE proposal_id=? AND version=? AND member_id=member.value)) RETURNING execution_token`)
      .bind(now+executionLeaseMs,proposal.id,proposal.version,token,now,scope.owner,scope.planId,current.version,scope.memberId,
        JSON.stringify(proposal.snapshot.required),proposal.id,proposal.version).first<{execution_token:string}>();
    if(renewed?.execution_token!==token)throw executionChanged();
  }
  async list(scope:RecoveryScope) {
    await this.plan(scope);
    const policies=await this.database.prepare('SELECT body FROM booking_policies WHERE owner=? AND plan_id=? ORDER BY created DESC LIMIT 50')
      .bind(scope.owner,scope.planId).all<{body:string}>();
    const rows=await this.database.prepare('SELECT id FROM recovery_proposals WHERE owner=? AND plan_id=? ORDER BY updated DESC LIMIT 50')
      .bind(scope.owner,scope.planId).all<{id:string}>();
    return {policies:policies.results.map(row=>JSON.parse(row.body) as BookingPolicy),
      proposals:await Promise.all(rows.results.map(row=>this.get(scope,row.id)))};
  }
  async get(scope:RecoveryScope,id:string):Promise<RecoveryProposal> {
    await this.plan(scope);
    const row=await this.database.prepare('SELECT * FROM recovery_proposals WHERE id=? AND owner=? AND plan_id=?')
      .bind(id,scope.owner,scope.planId).first<ProposalRow>();if(!row)throw unavailable();
    const snapshot=JSON.parse(row.body) as ProposalBody;
    const approvals=await this.database.prepare('SELECT member_id FROM recovery_approvals WHERE proposal_id=? AND version=?')
      .bind(id,row.version).all<{member_id:string}>();
    const reservations=await this.database.prepare('SELECT * FROM refund_reservations WHERE proposal_id=? ORDER BY capture_id,id')
      .bind(id).all<ReservationRow>();
    const approved=approvals.results.map(row=>row.member_id);
    return {id,planId:scope.planId,planVersion:row.plan_version,version:row.version,status:row.status,snapshot,
      approved,fullyApproved:snapshot.required.every(id=>approved.includes(id)),reservations:reservations.results,created:row.created,updated:row.updated};
  }
  async registerPolicy(scope:RecoveryScope,input:z.infer<typeof bookingPolicyRequest>) {
    const {state,version}=await this.plan(scope,true);if(version!==input.version)throw conflict();
    const item=state.items.find(item=>item.id===input.itemId);
    if(!item||item.revision!==input.revision||item.price===null||item.price<=0||!Number.isSafeInteger(item.price))
      throw invalid('Select the current confirmed booking and exact quoted amount.');
    if(!item.participants.length||new Set(item.participants).size!==item.participants.length||
      item.participants.some(id=>!state.people?.some(person=>person.id===id&&person.role!=='legacy'))||
      Object.keys(item.shares).length!==item.participants.length||Object.entries(item.shares).some(([id,amount])=>
        !item.participants.includes(id)||!Number.isSafeInteger(amount)||amount<0)||Object.values(item.shares).reduce((a,b)=>a+b,0)!==item.price)
      throw invalid('A recovery booking needs exact shares for signed-in plan members.');
    if(input.policy.merchant==='fictional-sandbox'&&(!hasMerchantCheckout(item)||planCurrency(state.plan)!=='CAD'))
      throw invalid('Sandbox terms apply only to the fictional CAD merchant catalog.');
    if(input.policy.cancellationFeeUnits>item.price)throw invalid('The cancellation fee exceeds the booking total.');
    const policy:BookingPolicy={...input.policy,id:crypto.randomUUID(),itemId:item.id,itemRevision:item.revision,
      currency:planCurrency(state.plan),itemPrice:item.price,participants:[...item.participants],shares:{...item.shares},
      source:item.source,confirmedBy:scope.memberId,created:this.now().toISOString()};
    const result=await this.database.prepare(`INSERT INTO booking_policies(id,owner,plan_id,item_id,revision,body,confirmed_by,created)
      SELECT ?,?,?,?,?,?,?,? WHERE ${this.accessCondition(true)}`)
      .bind(policy.id,scope.owner,scope.planId,item.id,item.revision,JSON.stringify(policy),scope.memberId,policy.created,
        scope.owner,scope.planId,version,scope.memberId).run();
    if(!result.meta.changes)throw conflict();return policy;
  }
  private async captures(scope:RecoveryScope,state:State,item:Item,policy:BookingPolicy) {
    const rows=await this.database.prepare("SELECT * FROM provider_operations WHERE owner=? AND item_id=? AND kind='order' AND status='captured' LIMIT 51")
      .bind(scope.owner,item.id).all<PaymentOperation>();
    if(rows.results.length>50)throw new BackendError('RECOVERY_LIMIT','Review this booking with the merchant; its capture history exceeds the automatic review limit.',409);
    const funding=item.funding??{revision:policy.itemRevision,participants:policy.participants,shares:policy.shares,price:policy.itemPrice,source:policy.source};
    if(item.funding){const approved=await this.database.prepare('SELECT snapshot FROM approval_revisions WHERE owner=? AND plan_id=? AND item_id=? AND revision=?').bind(scope.owner,scope.planId,item.id,funding.revision).first<{snapshot:string}>();const facts=approved?JSON.parse(approved.snapshot):null;
      if(!facts||funding.price!==item.price||funding.source!==item.source||facts.price!==funding.price||facts.source!==funding.source||JSON.stringify(Object.entries(facts.shares).sort())!==JSON.stringify(Object.entries(funding.shares).sort())||JSON.stringify([...facts.participants].sort())!==JSON.stringify([...funding.participants].sort()))throw captureMismatch();}
    const fees=allocate(policy.cancellationFeeUnits,funding.participants,'weight',funding.shares,funding.participants);
    const operations=rows.results.filter(op=>dataTripId(op)===scope.planId),operationFees=await this.fundingFees(scope,item,policy);
    const result:CaptureAllocation[]=[];const seenMembers=new Set<string>(),seenCaptures=new Set<string>();
    for(const operation of operations) {
      if(!operation.provider_id)throw captureMismatch();
      if(item.collection){const approved=await this.database.prepare('SELECT snapshot FROM approval_revisions WHERE owner=? AND plan_id=? AND item_id=? AND revision=?').bind(scope.owner,scope.planId,item.id,operation.revision).first<{snapshot:string}>();const facts=approved?JSON.parse(approved.snapshot):null;
       if(!facts||operation.amount!==(facts.collection?.due?.[operation.member]??facts.shares?.[operation.member])||!facts.participants.includes(operation.member))throw captureMismatch();
      }else if(operation.revision!==funding.revision||operation.amount!==funding.shares[operation.member]||!funding.participants.includes(operation.member)||seenMembers.has(operation.member))throw captureMismatch();
      let order:ProviderOrder;
      try{order=await this.dependencies.fetchOrder(operation.provider_id);}catch{throw captureMismatch();}
      const originalCapture=verifiedRecoveryOrderCapture(operation,JSON.parse(operation.payload??'{}'));
      const capture=verifiedRecoveryOrderCapture(operation,order);if(originalCapture.id!==capture.id)throw captureMismatch();
      const events=state.events.filter(event=>event.providerId===capture.id);
      if(events.length!==1||seenCaptures.has(capture.id))throw captureMismatch();requireCaptureLedgerMatch(operation,events[0]);
      let canonical:CanonicalCapture;
      try{canonical=await this.dependencies.fetchCapture(capture.id);}catch{throw captureMismatch();}
      this.verifyCapture(canonical,{captureId:capture.id,captured:operation.amount});
      const capacity=await this.database.prepare('SELECT reserved,refunded FROM capture_refund_capacity WHERE capture_id=? AND owner=?')
        .bind(capture.id,scope.owner).first<{reserved:number;refunded:number}>();
      let alreadyEncumbered=(capacity?.reserved??0)+(capacity?.refunded??0);
      const legacy=await this.database.prepare(`SELECT p.id,p.amount,p.payload FROM provider_operations p
        WHERE p.owner=? AND p.kind='refund' AND p.status NOT IN ('failed','denied','cancelled')
        AND NOT EXISTS(SELECT 1 FROM capture_refund_claims c WHERE c.id=p.id)`)
        .bind(scope.owner).all<{id:string;amount:number;payload:string|null}>();
      for(const refund of legacy.results){let metadata:Record<string,unknown>;try{metadata=JSON.parse(refund.payload??'{}');}catch{throw captureMismatch();}
        if((metadata.planrecoverCaptureId??metadata.captureId)===capture.id)alreadyEncumbered+=refund.amount;}
      seenMembers.add(operation.member);seenCaptures.add(capture.id);
      result.push({captureId:capture.id,operationId:operation.id,memberId:operation.member,captured:operation.amount,
        amount:Math.max(0,maximumCaptureRefund(operation.amount,policy.refundableBps,operationFees[operation.id]??fees[operation.member])-alreadyEncumbered),currency:policy.currency,policyMaximum:maximumCaptureRefund(operation.amount,policy.refundableBps,operationFees[operation.id]??fees[operation.member])});
    }
    return result;
  }
  private async fundingFees(scope:RecoveryScope,item:Item,policy:BookingPolicy){
    const captures=await this.database.prepare("SELECT id,amount,payload FROM provider_operations WHERE owner=? AND item_id=? AND kind='order' AND status='captured'").bind(scope.owner,item.id).all<{id:string;amount:number;payload:string}>(),invoices=await this.database.prepare('SELECT id,paid FROM plan_invoices WHERE owner=? AND plan_id=? AND item_id=? AND paid>0').bind(scope.owner,scope.planId,item.id).all<{id:string;paid:number}>();
    const weights=Object.fromEntries([...captures.results.filter(c=>JSON.parse(c.payload).planrecoverTripId===scope.planId).map(c=>[c.id,c.amount] as const),...invoices.results.map(i=>[`invoice-${i.id}`,i.paid] as const)]),ids=Object.keys(weights).sort();return ids.length?allocate(policy.cancellationFeeUnits,ids,'weight',weights,ids):{};
  }
  private verifyCapture(capture:CanonicalCapture,expected:{captureId:string;captured:number}) {
    if(capture.id!==expected.captureId||!['COMPLETED','PARTIALLY_REFUNDED','REFUNDED'].includes(capture.status??'')||
      providerCents(capture.amount)!==expected.captured)throw captureMismatch();
  }
  private assertCurrent(proposal:RecoveryProposal,state:State,currentVersion:number,expectedVersion:number,starting=false) {
    assertDependenciesReviewed(state.items,state.items.filter(item=>item.status!=='cancelled').map(item=>item.id));
    if(currentVersion!==expectedVersion||(starting&&proposal.planVersion!==currentVersion))throw conflict();
    const item=state.items.find(item=>item.id===proposal.snapshot.policy.itemId);
    if(!item||recoveryItemFingerprint(item)!==proposal.snapshot.fingerprint)throw conflict();
    for(const dependent of proposal.snapshot.dependentItems)if(!state.items.some(item=>item.id===dependent.id&&item.revision===dependent.revision))throw conflict();
    if(proposal.snapshot.required.some(id=>!state.people?.some(person=>person.id===id&&person.role!=='legacy')))throw conflict();
    if(starting&&proposal.snapshot.policy.cutoff&&Date.parse(proposal.snapshot.policy.cutoff)<=this.now().getTime())
      throw new BackendError('CANCELLATION_CUTOFF','The cancellation cutoff passed. Confirm new supplier terms before proceeding.',409);
    return item;
  }
  async propose(scope:RecoveryScope,input:Extract<z.infer<typeof recoveryRequest>,{type:'propose'}>) {
    const current=await this.plan(scope,true);if(current.version!==input.version)throw conflict();
    assertDependenciesReviewed(current.state.items,current.state.items.filter(item=>item.status!=='cancelled').map(item=>item.id));
    const row=await this.database.prepare('SELECT body FROM booking_policies WHERE id=? AND owner=? AND plan_id=?')
      .bind(input.policyId,scope.owner,scope.planId).first<{body:string}>();if(!row)throw invalid('Select saved, confirmed booking terms.');
    const policy=JSON.parse(row.body) as BookingPolicy,item=current.state.items.find(item=>item.id===policy.itemId);
    if(!item||item.revision!==policy.itemRevision||item.price!==policy.itemPrice||item.source!==policy.source||
      JSON.stringify(item.shares)!==JSON.stringify(policy.shares)||JSON.stringify(item.participants)!==JSON.stringify(policy.participants))throw conflict();
    if(policy.cutoff&&Date.parse(policy.cutoff)<=this.now().getTime())throw new BackendError('CANCELLATION_CUTOFF','Confirm new supplier terms after the cancellation cutoff.',409);
    const allocations=policy.merchant==='fictional-sandbox'?await this.captures(scope,current.state,item,policy):[];
    if(input.refundAmounts&&Object.keys(input.refundAmounts).some(id=>!allocations.some(allocation=>allocation.captureId===id)))
      throw invalid('Refund amounts must reference verified captures from this booking.');
    for(const allocation of allocations)if(input.refundAmounts) {
      const requested=input.refundAmounts[allocation.captureId]??0;
      if(requested>allocation.amount)throw invalid('A requested refund exceeds the confirmed supplier terms.');allocation.amount=requested;
    }
    const dependents=current.state.items.filter(candidate=>candidate.status!=='cancelled'&&candidate.depends.includes(item.id));
    if(item.funding)for(const allocation of allocations)allocation.costShares=allocate(allocation.amount,item.participants,'weight',item.shares,item.participants);
    const required=[...new Set([...item.participants,...(item.funding?.participants??[]),...dependents.flatMap(item=>item.participants)])].sort();
    const id=crypto.randomUUID(),invoiceRefunds:NonNullable<ProposalBody['invoiceRefunds']>=[];
    const invoices=await this.database.prepare('SELECT id,member_id,paid FROM plan_invoices WHERE owner=? AND plan_id=? AND item_id=? AND paid>0').bind(scope.owner,scope.planId,item.id).all<{id:string;member_id:string;paid:number}>(),invoiceFees=await this.fundingFees(scope,item,policy);
    for(const invoice of invoices.results){const prior=await this.database.prepare('SELECT refund_id,amount FROM invoice_refunds WHERE invoice_id=?').bind(invoice.id).all<{refund_id:string;amount:number}>(),already=prior.results.reduce((n,r)=>n+r.amount,0),expectedTotal=maximumCaptureRefund(invoice.paid,policy.refundableBps,invoiceFees[`invoice-${invoice.id}`]??0),amount=Math.max(0,expectedTotal-already);if(amount){const hash=await sha256(`${id}:${invoice.id}`);invoiceRefunds.push({id:`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`,invoiceId:invoice.id,memberId:invoice.member_id,amount,expectedTotal,baseline:prior.results.map(r=>r.refund_id)});}}
    const snapshot:ProposalBody={policy,reason:input.reason,fingerprint:recoveryItemFingerprint(item),required,...(invoiceRefunds.length?{invoiceRefunds}:{}),
      allocations,dependentItems:dependents.map(({id,name,revision})=>({id,name,revision}))};
    const now=this.now().toISOString();
    const inserted=await this.database.prepare(`INSERT INTO recovery_proposals
      (id,owner,plan_id,policy_id,plan_version,version,status,body,created_by,created,updated)
      SELECT ?,?,?,?,?,1,'review',?,?,?,? WHERE ${this.accessCondition(true)}`)
      .bind(id,scope.owner,scope.planId,policy.id,current.version,JSON.stringify(snapshot),scope.memberId,now,now,
        scope.owner,scope.planId,current.version,scope.memberId).run();
    if(!inserted.meta.changes)throw conflict();return this.get(scope,id);
  }
  async approve(scope:RecoveryScope,input:Extract<z.infer<typeof recoveryRequest>,{type:'approve'}>) {
    const current=await this.plan(scope),proposal=await this.get(scope,input.proposalId);
    if(proposal.version!==input.version||proposal.status!=='review')throw conflict();
    this.assertCurrent(proposal,current.state,current.version,input.planVersion,true);
    if(!proposal.snapshot.required.includes(scope.memberId))throw forbidden();
    const inserted=await this.database.prepare(`INSERT OR IGNORE INTO recovery_approvals(proposal_id,version,member_id,approved)
      SELECT ?,?,?,? WHERE ${this.accessCondition()} AND EXISTS(SELECT 1 FROM recovery_proposals WHERE id=? AND version=? AND status='review')`)
      .bind(proposal.id,proposal.version,scope.memberId,this.now().toISOString(),scope.owner,scope.planId,current.version,scope.memberId,proposal.id,proposal.version).run();
    if(!inserted.meta.changes&&!proposal.approved.includes(scope.memberId))throw conflict();return this.get(scope,proposal.id);
  }
  async cancelProposal(scope:RecoveryScope,input:Extract<z.infer<typeof recoveryRequest>,{type:'cancel-proposal'}>) {
    const current=await this.plan(scope,true),proposal=await this.get(scope,input.proposalId);
    if(proposal.version!==input.version||proposal.status!=='review')throw conflict();
    this.assertCurrent(proposal,current.state,current.version,input.planVersion);
    const changed=await this.database.prepare(`UPDATE recovery_proposals SET status='cancelled',updated=? WHERE id=? AND version=? AND status='review' AND ${this.accessCondition(true)}`)
      .bind(this.now().toISOString(),proposal.id,proposal.version,scope.owner,scope.planId,current.version,scope.memberId).run();
    if(!changed.meta.changes)throw conflict();return this.get(scope,proposal.id);
  }
  private async reserve(scope:RecoveryScope,proposal:RecoveryProposal,state:State,currentVersion:number,executionToken:string) {
    const now=this.now().toISOString(),token=crypto.randomUUID();
    const commands:D1PreparedStatement[]=[this.database.prepare(`INSERT INTO backend_write_guards(id,valid)
      VALUES (?,CASE WHEN ${this.accessCondition(true)} AND EXISTS(SELECT 1 FROM recovery_proposals WHERE id=? AND version=? AND status='review' AND execution_token=? AND execution_until>?)
      AND NOT EXISTS(SELECT 1 FROM json_each(?) member WHERE NOT EXISTS(SELECT 1 FROM recovery_approvals WHERE proposal_id=? AND version=? AND member_id=member.value)) THEN 1 ELSE 0 END)`)
      .bind(token,scope.owner,scope.planId,currentVersion,scope.memberId,proposal.id,proposal.version,executionToken,this.now().getTime(),
        JSON.stringify(proposal.snapshot.required),proposal.id,proposal.version)];
    for(const allocation of proposal.snapshot.allocations.filter(allocation=>allocation.amount>0)) {
      // A persisted UUID provides a stable, compact PayPal request ID.
      const reservationId=crypto.randomUUID();
      commands.push(...await reserveCaptureRefund(this.database,{reservationId,owner:scope.owner,planId:scope.planId,
        itemId:proposal.snapshot.policy.itemId,memberId:allocation.memberId,captureId:allocation.captureId,currency:allocation.currency,
        captured:allocation.captured,amount:allocation.amount},now));
      const policyFees=allocate(proposal.snapshot.policy.cancellationFeeUnits,proposal.snapshot.policy.participants,'weight',
        proposal.snapshot.policy.shares,proposal.snapshot.policy.participants);
      const maximum=allocation.policyMaximum??maximumCaptureRefund(allocation.captured,proposal.snapshot.policy.refundableBps,policyFees[allocation.memberId]);
      const policyGuard=crypto.randomUUID();
      // Capacity protects the capture total; this additional guard protects the
      // supplier's cumulative policy ceiling across several partial proposals.
      commands.push(this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(
        SELECT 1 FROM capture_refund_capacity WHERE capture_id=? AND reserved+refunded<=?) THEN 1 ELSE 0 END)`)
        .bind(policyGuard,allocation.captureId,maximum));
      commands.push(this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(policyGuard));
      commands.push(this.database.prepare("INSERT INTO refund_reservations(id,proposal_id,capture_id,member_id,amount,currency,status,created,updated) VALUES (?,?,?,?,?,?,'reserved',?,?)")
        .bind(reservationId,proposal.id,allocation.captureId,allocation.memberId,allocation.amount,allocation.currency,now,now));
      commands.push(this.database.prepare("INSERT INTO provider_operations(id,owner,item_id,member,revision,kind,amount,status,payload) VALUES (?,?,?,?,?,'refund',?,'reserved',?)")
        .bind(reservationId,scope.owner,proposal.snapshot.policy.itemId,allocation.memberId,proposal.version,allocation.amount,
          JSON.stringify({planrecoverTripId:scope.planId,planrecoverCurrency:allocation.currency,planrecoverCaptureId:allocation.captureId,
            planrecoverRecoveryProposalId:proposal.id,planrecoverRecoveryReservationId:reservationId,planrecoverCapacityReserved:true})));
    }
    commands.push(this.database.prepare("UPDATE recovery_proposals SET status='executing',updated=? WHERE id=?").bind(now,proposal.id));
    for(const invoice of proposal.snapshot.invoiceRefunds??[]){
     const body=JSON.stringify({reason:proposal.snapshot.reason,recoveryProposalId:proposal.id,previousRefunds:invoice.baseline});
     commands.push(this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM invoice_refund_requests WHERE id=?) OR ?<=MIN(?,(SELECT paid FROM plan_invoices WHERE id=?))-(SELECT COALESCE(SUM(amount),0) FROM invoice_refunds WHERE invoice_id=?)-(SELECT COALESCE(SUM(q.amount-(SELECT COALESCE(SUM(a.amount),0) FROM invoice_refund_allocations a WHERE a.request_id=q.id)),0) FROM invoice_refund_requests q WHERE q.invoice_id=? AND q.status IN ('review','awaiting-merchant','completed')) THEN 1 ELSE 0 END)`).bind(`invoice-${invoice.id}`,invoice.id,invoice.amount,invoice.expectedTotal,invoice.invoiceId,invoice.invoiceId,invoice.invoiceId));
     commands.push(this.database.prepare("INSERT OR IGNORE INTO invoice_refund_requests(id,owner,plan_id,invoice_id,member_id,amount,currency,terms,status,created,approved_owner,approved_member) VALUES (?,?,?,?,?,?,'CAD',?,'awaiting-merchant',?,1,1)").bind(invoice.id,scope.owner,scope.planId,invoice.invoiceId,invoice.memberId,invoice.amount,body,now));
     commands.push(this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(`invoice-${invoice.id}`));
    }
    commands.push(this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token));
    try{await this.database.batch(commands);}catch(error){if(String(error).includes('CHECK constraint failed'))throw new BackendError('REFUND_CAPACITY','Another refund or plan change consumed the available capture balance.',409);throw error;}
    return this.get(scope,proposal.id);
  }
  private verifyRefund(refund:ProviderRefund,reservation:ReservationRow) {
    if(!refund.id||!['COMPLETED','PENDING'].includes(refund.status??'')||providerCents(refund.amount)!==reservation.amount||
      relatedCaptureId(refund)!==reservation.capture_id)throw new BackendError('REFUND_MISMATCH','The canonical refund needs merchant review; its reserved amount remains unavailable.',409);
  }
  private async settle(scope:RecoveryScope,proposal:RecoveryProposal,reservation:ReservationRow,refund:ProviderRefund) {
    this.verifyRefund(refund,reservation);
    const token=crypto.randomUUID(),now=this.now().toISOString();
    const completed=refund.status==='COMPLETED',payload=JSON.stringify({...refund,planrecoverTripId:scope.planId,
      planrecoverCurrency:reservation.currency,planrecoverCaptureId:reservation.capture_id,planrecoverRecoveryProposalId:proposal.id,
      planrecoverRecoveryReservationId:reservation.id,planrecoverCapacityReserved:true});
    const statements=[this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(
      SELECT 1 FROM refund_reservations WHERE id=? AND proposal_id=? AND capture_id=? AND amount=? AND status IN ('submitted','manual-review','confirmed') AND refund_id=?) THEN 1 ELSE 0 END)`)
      .bind(token,reservation.id,proposal.id,reservation.capture_id,reservation.amount,refund.id),
      ...(completed?[...confirmCaptureRefund(this.database,{reservationId:reservation.id,captureId:reservation.capture_id,amount:reservation.amount},now),
      this.database.prepare("UPDATE refund_reservations SET status='confirmed',updated=? WHERE id=?").bind(now,reservation.id)]:[]),
      this.database.prepare("UPDATE provider_operations SET status='refunded',payload=? WHERE id=? AND owner=?")
        .bind(payload,reservation.id,scope.owner),
      this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token)];
    if(!completed)statements[statements.length-2]=this.database.prepare("UPDATE provider_operations SET status='refund-pending',payload=? WHERE id=? AND owner=?")
      .bind(payload,reservation.id,scope.owner);
    const event:MoneyEvent={id:`paypal-refund-${refund.id}`,itemId:proposal.snapshot.policy.itemId,kind:'refund',
      label:`${proposal.snapshot.policy.merchantName} · approved partial sandbox refund`,amount:-reservation.amount,
      shares:proposal.snapshot.allocations.find(a=>a.captureId===reservation.capture_id)?.costShares?Object.fromEntries(Object.entries(proposal.snapshot.allocations.find(a=>a.captureId===reservation.capture_id)!.costShares!).map(([id,n])=>[id,-n])):{[reservation.member_id]:-reservation.amount},contributions:{[reservation.member_id]:-reservation.amount},status:completed?'confirmed':'pending',mode:'sandbox',
      created:now,providerId:refund.id,evidence:`Canonical ${completed?'completed':'pending'} sandbox refund ${refund.id} against capture ${reservation.capture_id}; recovery ${proposal.id} version ${proposal.version} unanimously approved. Bank availability is unverified.`};
    await this.dependencies.commitRefund({owner:scope.owner,planId:scope.planId,event,operationId:reservation.id,statements});
  }
  /** Internal canonical reconciliation preserves approved accounting after a plan
   * is deleted or a payer leaves. It never submits a provider money mutation. */
  async reconcileSavedRefund(operation:PaymentOperation,refund:ProviderRefund) {
    let metadata:Record<string,unknown>;try{metadata=JSON.parse(operation.payload??'{}');}catch{throw captureMismatch();}
    if(operation.kind!=='refund'||metadata.planrecoverRecoveryReservationId!==operation.id||
      typeof metadata.planrecoverRecoveryProposalId!=='string'||typeof metadata.planrecoverTripId!=='string'||
      !operation.provider_id||refund.id!==operation.provider_id)throw captureMismatch();
    const row=await this.database.prepare('SELECT * FROM recovery_proposals WHERE id=? AND owner=? AND plan_id=?')
      .bind(metadata.planrecoverRecoveryProposalId,operation.owner,metadata.planrecoverTripId).first<ProposalRow>();
    const reservation=await this.database.prepare('SELECT * FROM refund_reservations WHERE id=?').bind(operation.id).first<ReservationRow>();
    if(!row||!reservation||reservation.proposal_id!==row.id||reservation.capture_id!==metadata.planrecoverCaptureId||
      reservation.member_id!==operation.member||reservation.amount!==operation.amount||operation.revision!==row.version||
      !['executing','manual-review','completed'].includes(row.status)||reservation.currency!==metadata.planrecoverCurrency)throw captureMismatch();
    const snapshot=JSON.parse(row.body) as ProposalBody;
    const allocation=snapshot.allocations.find(allocation=>allocation.captureId===reservation.capture_id);
    if(snapshot.policy.merchant!=='fictional-sandbox'||!allocation||allocation.memberId!==operation.member||
      allocation.amount!==operation.amount||allocation.currency!==reservation.currency)throw captureMismatch();
    const approvals=await this.database.prepare('SELECT member_id FROM recovery_approvals WHERE proposal_id=? AND version=?')
      .bind(row.id,row.version).all<{member_id:string}>();
    const approved=approvals.results.map(row=>row.member_id);
    if(snapshot.required.some(id=>!approved.includes(id)))throw captureMismatch();
    const original=await this.database.prepare("SELECT * FROM provider_operations WHERE id=? AND owner=? AND kind='order' AND status='captured'")
      .bind(allocation.operationId,operation.owner).first<PaymentOperation>();
    if(!original||dataTripId(original)!==row.plan_id||original.member!==allocation.memberId||original.amount!==allocation.captured||
      verifiedRecoveryOrderCapture(original,JSON.parse(original.payload??'{}')).id!==allocation.captureId)throw captureMismatch();
    this.verifyRefund(refund,reservation);
    if(reservation.refund_id&&reservation.refund_id!==refund.id)throw captureMismatch();
    if(!reservation.refund_id) {
      await this.database.prepare("UPDATE refund_reservations SET refund_id=?,status='submitted',updated=? WHERE id=? AND refund_id IS NULL")
        .bind(refund.id,this.now().toISOString(),reservation.id).run();reservation.refund_id=refund.id;reservation.status='submitted';
    }
    const proposal:RecoveryProposal={id:row.id,planId:row.plan_id,planVersion:row.plan_version,version:row.version,status:row.status,
      snapshot,approved,fullyApproved:true,reservations:[reservation],created:row.created,updated:row.updated};
    await this.settle({owner:row.owner,planId:row.plan_id,memberId:row.created_by},proposal,reservation,refund);
    return {operationId:operation.id,status:refund.status==='COMPLETED'?'refunded':'refund-pending'};
  }
  /** Only an explicit owner command can submit refunds. Network uncertainty keeps capacity reserved. */
  async execute(scope:RecoveryScope,input:Extract<z.infer<typeof recoveryRequest>,{type:'execute'}>) {
    await this.plan(scope,true);
    const proposal=await this.get(scope,input.proposalId);
    if(proposal.version!==input.version)throw conflict();
    if(proposal.status==='completed')return proposal;
    const token=crypto.randomUUID(),now=this.now().getTime();
    const claimed=await this.database.prepare(`UPDATE recovery_proposals SET execution_token=?,execution_until=?
      WHERE id=? AND owner=? AND plan_id=? AND version=? AND execution_until<=?
      AND status IN ('review','executing','manual-review') AND ${this.accessCondition(true)} RETURNING execution_token`)
      .bind(token,now+executionLeaseMs,proposal.id,scope.owner,scope.planId,proposal.version,now,
        scope.owner,scope.planId,input.planVersion,scope.memberId).first<{execution_token:string}>();
    if(claimed?.execution_token!==token)throw new BackendError('RECOVERY_BUSY','This recovery is already running or its plan changed. Refresh before resuming.',409);
    try{return await this.executeWithLease(scope,input,token);}
    finally{await this.database.prepare('UPDATE recovery_proposals SET execution_token=NULL,execution_until=0 WHERE id=? AND execution_token=?')
      .bind(proposal.id,token).run();}
  }
  private async executeWithLease(scope:RecoveryScope,input:Extract<z.infer<typeof recoveryRequest>,{type:'execute'}>,token:string) {
    const current=await this.plan(scope,true);let proposal=await this.get(scope,input.proposalId);
    if(proposal.version!==input.version||!['review','executing','manual-review','completed'].includes(proposal.status))throw conflict();
    if(proposal.status==='completed')return proposal;
    const item=this.assertCurrent(proposal,current.state,current.version,input.planVersion,proposal.status==='review');
    if(!proposal.fullyApproved)throw new BackendError('RECOVERY_APPROVALS','Every affected member must approve this exact recovery version.',409);
    if(proposal.snapshot.policy.merchant!=='fictional-sandbox'||!hasMerchantCheckout(item))
      throw new BackendError('EXTERNAL_BOOKING','Cancel external bookings with the supplier and review documented payments manually. PlanRecover cannot issue their refunds.',409);
    // Dependents retain their own policies and costs. A parent cancellation cannot silently cancel them.
    if(current.state.items.some(item=>item.status!=='cancelled'&&item.depends.includes(proposal.snapshot.policy.itemId)))
      throw new BackendError('RECOVERY_DEPENDENCIES','Review or reschedule each dependent booking before cancelling this booking.',409);
    if(proposal.status==='review') {
      for(const allocation of proposal.snapshot.allocations.filter(allocation=>allocation.amount>0)) {
        await this.renewExecution(scope,proposal.id,token);
        this.verifyCapture(await this.dependencies.fetchCapture(allocation.captureId),allocation);
      }
      await this.renewExecution(scope,proposal.id,token);
      proposal=await this.reserve(scope,proposal,current.state,current.version,token);
    }
    for(const invoice of proposal.snapshot.invoiceRefunds??[])if(!await invoiceRefundIntentReady(this.database,scope.owner,scope.planId,invoice))return {...proposal,invoiceRefundRequired:invoice,reviewUrl:`/flows?plan=${encodeURIComponent(scope.planId)}`,message:'The approved invoice refund is ready for the sandbox merchant. Issue it there, check invoice status, then continue this saved recovery.'};
    if(!await invoiceRecoveryReady(this.database,scope.owner,scope.planId,proposal.snapshot))return {...proposal,message:'Close the old partial invoice collection in the reviewed change flow before completing this cancellation.'};
    let processed=0;
    for(const reservation of proposal.reservations) {
      if(reservation.status==='confirmed')continue;
      if(processed++>=5)break;
      try{
        await this.renewExecution(scope,proposal.id,token);
        let refund:ProviderRefund;
        if(reservation.refund_id)refund=await this.dependencies.fetchRefund(reservation.refund_id);
        else {
          // Stop after a conservative replay window if a prior POST may have
          // succeeded without its returned ID. A known refund is reconciled by GET.
          if(reservation.status==='manual-review'&&this.now().getTime()-Date.parse(reservation.created)>=5*60*60_000)
            throw new BackendError('REFUND_REPLAY_EXPIRED','An uncertain refund needs merchant review before another provider request.',409);
          const allocation=proposal.snapshot.allocations.find(allocation=>allocation.captureId===reservation.capture_id)!;
          this.verifyCapture(await this.dependencies.fetchCapture(reservation.capture_id),allocation);
          await saveProviderRequestIntent(this.database,{operationId:reservation.id,owner:scope.owner,planId:scope.planId,
            path:`/v2/payments/captures/${encodeURIComponent(reservation.capture_id)}/refund`,
            body:recoveryRefundBody(reservation.amount,reservation.currency),requestKey:reservation.id},this.now());
          const intent=await this.database.prepare('SELECT plan_id,replay_before FROM provider_request_intents WHERE operation_id=? AND owner=?')
            .bind(reservation.id,scope.owner).first<{plan_id:string;replay_before:string}>();
          // A process may die after POST while the reservation still says reserved.
          // The immutable intent bounds every retry, including that crash window.
          if(!intent||intent.plan_id!==scope.planId||!Number.isFinite(Date.parse(intent.replay_before))||Date.parse(intent.replay_before)<=this.now().getTime())
            throw new BackendError('REFUND_REPLAY_EXPIRED','The saved refund request needs merchant review before another provider request.',409);
          await this.assertSubmissionCurrent(scope,proposal,token);
          refund=await this.dependencies.createRefund(reservation.capture_id,reservation.amount,reservation.currency,reservation.id);
          if(!refund.id||!/^[A-Z0-9]{1,128}$/.test(refund.id))throw new BackendError('REFUND_MISMATCH','The saved refund needs merchant review.',409);
          // Persist returned identity even if the amount/status still needs canonical review.
          await this.database.batch([
            this.database.prepare("UPDATE refund_reservations SET refund_id=?,status='submitted',updated=? WHERE id=? AND refund_id IS NULL")
              .bind(refund.id,this.now().toISOString(),reservation.id),
            this.database.prepare("UPDATE provider_operations SET provider_id=?,status='pending' WHERE id=? AND owner=? AND provider_id IS NULL")
              .bind(refund.id,reservation.id,scope.owner)]);
          reservation.refund_id=refund.id;reservation.status='submitted';
          refund=await this.dependencies.fetchRefund(refund.id);
        }
        await this.renewExecution(scope,proposal.id,token);
        this.verifyRefund(refund,reservation);await this.settle(scope,proposal,reservation,refund);
      }catch {
        // An expired worker cannot alter the new executor's progress. A returned
        // provider identity above is still retained for canonical reconciliation.
        await this.renewExecution(scope,proposal.id,token);
        await this.database.prepare("UPDATE refund_reservations SET status='manual-review',updated=? WHERE id=? AND status<>'confirmed'")
          .bind(this.now().toISOString(),reservation.id).run();
        await this.database.prepare("UPDATE recovery_proposals SET status='manual-review',updated=? WHERE id=?")
          .bind(this.now().toISOString(),proposal.id).run();
        // Never release a possibly successful provider mutation or expose its raw response.
        return this.get(scope,proposal.id);
      }
    }
    proposal=await this.get(scope,proposal.id);
    if(proposal.reservations.some(reservation=>reservation.status!=='confirmed'))return proposal;
    await this.renewExecution(scope,proposal.id,token);
    const guard=crypto.randomUUID(),statements=[this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(
      SELECT 1 FROM recovery_proposals WHERE id=? AND execution_token=? AND execution_until>?) THEN 1 ELSE 0 END)`)
      .bind(guard,proposal.id,token,this.now().getTime()),
      this.database.prepare("UPDATE recovery_proposals SET status='completed',updated=? WHERE id=? AND status IN ('executing','manual-review')")
      .bind(this.now().toISOString(),proposal.id),this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard)];
    await this.dependencies.cancelBooking({scope,itemId:proposal.snapshot.policy.itemId,fingerprint:proposal.snapshot.fingerprint,proposalId:proposal.id,statements});
    return this.get(scope,proposal.id);
  }
}

export async function reconcileRecoveryRefund(database:D1Database,operation:PaymentOperation,refund:ProviderRefund) {
  const disabled=async()=>{throw new BackendError('READ_ONLY_RECONCILIATION','Recovery reconciliation cannot submit a provider request.');};
  return new RecoveryService({database,fetchOrder:disabled,fetchCapture:disabled,fetchRefund:disabled,createRefund:disabled,
    cancelBooking:disabled,commitRefund:input=>commitFinancialEffect(database,{owner:input.owner,planId:input.planId,event:input.event,statements:input.statements})})
    .reconcileSavedRefund(operation,refund);
}

/** Complete previously authorized cancellations after read-only reconciliation.
 * This worker neither submits provider requests nor records new money. */
export async function finalizeConfirmedRecoveries(database:D1Database,input:{owner:string;limit?:number}) {
  const limit=input.limit??5;
  if(!input.owner||!Number.isInteger(limit)||limit<1||limit>20)throw invalid('Choose a bounded recovery completion batch.');
  const candidates=await database.prepare(`SELECT p.* FROM recovery_proposals p WHERE p.owner=?
    AND p.status IN ('executing','manual-review') AND NOT EXISTS(
      SELECT 1 FROM refund_reservations r WHERE r.proposal_id=p.id AND r.status<>'confirmed')
    ORDER BY p.updated,p.id LIMIT ?`).bind(input.owner,limit+1).all<ProposalRow>();
  const proposals:{proposalId:string;status:string}[]=[];
  // Move unsuccessful attempts beyond the following candidate even if a prior
  // worker's clock ran ahead. A stale booking must not starve later recoveries.
  let rotationAfter=Math.max(Date.now(),...candidates.results.map(row=>Date.parse(row.updated)).filter(Number.isFinite))+1;
  for(const row of candidates.results.slice(0,limit)) {
    try{
      const snapshot=JSON.parse(row.body) as ProposalBody;
      if(snapshot.policy.merchant!=='fictional-sandbox')throw captureMismatch();
      if(!await invoiceRecoveryReady(database,row.owner,row.plan_id,snapshot))throw new BackendError('INVOICE_REFUND_PENDING','The saved invoice refund or collection closure is still pending.',409);
      const reservations=await database.prepare('SELECT * FROM refund_reservations WHERE proposal_id=?').bind(row.id).all<ReservationRow>();
      const expected=snapshot.allocations.filter(allocation=>allocation.amount>0);
      if(reservations.results.length!==expected.length||expected.some(allocation=>!reservations.results.some(reservation=>
        reservation.capture_id===allocation.captureId&&reservation.member_id===allocation.memberId&&reservation.amount===allocation.amount&&
        reservation.currency===allocation.currency&&reservation.status==='confirmed'&&!!reservation.refund_id)))throw captureMismatch();
      const approvals=await database.prepare('SELECT member_id FROM recovery_approvals WHERE proposal_id=? AND version=?')
        .bind(row.id,row.version).all<{member_id:string}>();
      if(snapshot.required.some(member=>!approvals.results.some(approval=>approval.member_id===member)))throw captureMismatch();
      const plan=await database.prepare('SELECT body,version,status FROM plans WHERE owner=? AND id=?')
        .bind(row.owner,row.plan_id).first<{body:string;version:number;status:string}>();if(!plan)throw missingPlan();
      const state=JSON.parse(plan.body) as State,item=state.items.find(item=>item.id===snapshot.policy.itemId);
      assertDependenciesReviewed(state.items,state.items.filter(item=>item.status!=='cancelled').map(item=>item.id));
      if(!item||recoveryItemFingerprint(item)!==snapshot.fingerprint||!hasMerchantCheckout(item))throw conflict();
      const currentOwner=await database.prepare(`SELECT m.member_id,profile.display_name FROM plan_members m
        JOIN profiles profile ON profile.id=m.member_id WHERE m.owner=? AND m.plan_id=? AND m.role='owner'
        ORDER BY CASE WHEN m.member_id=? THEN 0 ELSE 1 END,m.member_id LIMIT 1`)
        .bind(row.owner,row.plan_id,row.created_by).first<{member_id:string;display_name:string}>();if(!currentOwner)throw forbidden();
      const now=new Date().toISOString(),complete=database.prepare("UPDATE recovery_proposals SET status='completed',updated=? WHERE id=? AND version=? AND status IN ('executing','manual-review')")
        .bind(now,row.id,row.version);
      if(plan.status==='deleted') {
        // Financial tombstones remain exactly as retained; completion does not
        // put a deleted plan back into any owner's visible workspace.
        const guard=crypto.randomUUID();
        await database.batch([database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN
          EXISTS(SELECT 1 FROM plans WHERE owner=? AND id=? AND status='deleted' AND version=?)
          AND EXISTS(SELECT 1 FROM recovery_proposals WHERE id=? AND owner=? AND plan_id=? AND version=? AND status IN ('executing','manual-review'))
          AND NOT EXISTS(SELECT 1 FROM refund_reservations WHERE proposal_id=? AND status<>'confirmed')
          THEN 1 ELSE 0 END)`).bind(guard,row.owner,row.plan_id,plan.version,row.id,row.owner,row.plan_id,row.version,row.id),
          complete,database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard)]);
      }else{
        await cancelRecoveredBooking(database,{scope:{owner:row.owner,planId:row.plan_id,memberId:currentOwner.member_id},
          itemId:item.id,fingerprint:snapshot.fingerprint,proposalId:row.id,statements:[complete]});
      }
      proposals.push({proposalId:row.id,status:'completed'});
    }catch {
      const current=await database.prepare('SELECT status FROM recovery_proposals WHERE id=? AND owner=?').bind(row.id,row.owner).first<{status:string}>();
      if(current?.status==='completed')proposals.push({proposalId:row.id,status:'already-completed'});
      else {
        // Only ordering metadata changes; approved terms, versions, money and
        // proposal status remain intact. Concurrent progress keeps its own order.
        await database.prepare(`UPDATE recovery_proposals SET updated=? WHERE id=? AND owner=? AND version=?
          AND status IN ('executing','manual-review') AND updated=?`)
          .bind(new Date(rotationAfter++).toISOString(),row.id,row.owner,row.version,row.updated).run();
        proposals.push({proposalId:row.id,status:'requires-review'});
      }
    }
  }
  return {proposals,moreMayRemain:candidates.results.length>limit,providerMutations:false as const};
}
