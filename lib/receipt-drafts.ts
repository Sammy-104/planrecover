import { z } from 'zod';
import { BackendError, conflict } from './backend-errors.ts';
import { blankReceipt, splitReceipt, planMembers, type Receipt, type State } from './model.ts';
import { planCurrency } from './money.ts';
import { parseWorkspaceMutation, MAX_MONEY_UNITS } from './action-contracts.ts';

const amount = z.number().int().min(0).max(MAX_MONEY_UNITS).nullable();
export const receiptExtractionSchema = z.object({
  merchant: z.string().trim().min(1).max(200).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  items: z.array(z.object({ name: z.string().trim().min(1).max(200), amountCents: amount,
    quantityMilli:z.number().int().min(1).max(1e9).nullable().optional(),unitPriceCents:amount.optional(),lineDiscountCents:amount.optional(),
  }).strict()).max(100),
  taxCents: amount, tipCents: amount, discountCents: amount, totalCents: amount,
  flags: z.array(z.string().max(500)).max(30),taxIncluded:z.boolean().optional(),
  detections:z.array(z.object({field:z.string().max(120),text:z.string().max(500),confidence:z.number().min(0).max(100).nullable()}).strict()).max(200).optional(),
}).strict();
export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;
export type ReceiptDraftStatus = 'uploaded' | 'extracting' | 'review-required' | 'failed' | 'reviewed';
export type ReceiptDraft = {
  id: string; planId: string; uploadedBy: string; fileKey: string; mime: string;
  status: ReceiptDraftStatus; version: number; sourceFacts: ReceiptExtraction | null;
  unknownFields: string[]; warnings: string[]; reviewedReceipt: Receipt | null;
  provider: string | null; modelId: string | null; created: string; updated: string;
};
type DraftRow = {
  id: string; plan_id: string; uploaded_by: string; file_key: string; mime: string;
  status: ReceiptDraftStatus; version: number; source_facts: string | null;
  unknown_fields: string; warnings: string; reviewed_receipt: string | null;
  provider: string | null; model_id: string | null; created: string; updated: string;
};
export type ReceiptScope = { owner: string; planId: string; memberId: string };
export function unknownReceiptFields(facts: ReceiptExtraction | null) {
  if (!facts) return ['merchant', 'date', 'currency', 'items', 'taxCents', 'tipCents', 'discountCents', 'totalCents'];
  const missing = ['merchant', 'date', 'currency', 'taxCents', 'tipCents', 'discountCents', 'totalCents']
    .filter(key => facts[key as keyof ReceiptExtraction] === null);
  if (!facts.items.length) missing.push('items');
  facts.items.forEach((item, index) => { if (item.amountCents === null) missing.push(`items.${index}.amountCents`); });
  return missing;
}
export function receiptReviewFields(draft: ReceiptDraft, currency: string) {
  if(!draft.sourceFacts)return unknownReceiptFields(null);
  if(draft.sourceFacts.currency!==null&&draft.sourceFacts.currency!==currency)return [...new Set([
    ...unknownReceiptFields(draft.sourceFacts),'currency','items','taxCents','tipCents','discountCents','totalCents',
    ...draft.sourceFacts.items.map((_,index)=>`items.${index}.amountCents`),
  ])];
  return draft.unknownFields;
}
function decode(row: DraftRow): ReceiptDraft {
  return { id: row.id, planId: row.plan_id, uploadedBy: row.uploaded_by, fileKey: row.file_key, mime: row.mime,
    status: row.status, version: row.version, sourceFacts: row.source_facts ? JSON.parse(row.source_facts) : null,
    unknownFields: JSON.parse(row.unknown_fields), warnings: JSON.parse(row.warnings),
    reviewedReceipt: row.reviewed_receipt ? JSON.parse(row.reviewed_receipt) : null,
    provider: row.provider, modelId: row.model_id, created: row.created, updated: row.updated };
}
const accessCondition = (edit = false) => `EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
  WHERE p.owner=? AND p.id=? AND p.status<>'deleted' AND m.member_id=? AND m.role ${edit ? "IN ('owner','editor')" : "IN ('owner','editor','viewer')"})`;
const unavailable = () => new BackendError('RECEIPT_UNAVAILABLE', 'This receipt draft is unavailable.', 404);

/** Drafts are separate from approved receipts and never change financial events. */
export class ReceiptDraftRepository {
  constructor(private database: D1Database) {}
  async create(scope: ReceiptScope, file: { fileKey: string; mime: string; size: number }) {
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const result = await this.database.prepare(`INSERT INTO receipt_drafts
      (id,owner,plan_id,uploaded_by,file_key,mime,size,status,version,unknown_fields,warnings,created,updated)
      SELECT ?,?,?,?,?,?,?,'uploaded',0,?,?,?,? WHERE ${accessCondition(true)}`)
      .bind(id, scope.owner, scope.planId, scope.memberId, file.fileKey, file.mime, file.size,
        JSON.stringify(unknownReceiptFields(null)), JSON.stringify(['Saved source; enter and review all receipt values.']), now, now,
        scope.owner, scope.planId, scope.memberId).run();
    if (!result.meta.changes) throw new BackendError('FORBIDDEN', 'Editing access is required to upload a receipt.', 403);
    return this.get(scope, id);
  }
  async get(scope: ReceiptScope, id: string) {
    const row = await this.database.prepare(`SELECT * FROM receipt_drafts WHERE id=? AND owner=? AND plan_id=? AND ${accessCondition()}`)
      .bind(id, scope.owner, scope.planId, scope.owner, scope.planId, scope.memberId).first<DraftRow>();
    if (!row) throw unavailable();
    return decode(row);
  }
  async list(scope: ReceiptScope) {
    const rows = await this.database.prepare(`SELECT * FROM receipt_drafts WHERE owner=? AND plan_id=? AND ${accessCondition()}
      ORDER BY updated DESC,id DESC LIMIT 50`)
      .bind(scope.owner, scope.planId, scope.owner, scope.planId, scope.memberId).all<DraftRow>();
    return rows.results.map(decode);
  }
  async extracting(scope: ReceiptScope, id: string, version: number) {
    const prior=await this.get(scope,id);
    if(prior.status==='reviewed')throw new BackendError('RECEIPT_REVIEWED','This source was reviewed. Upload a new source to change its evidence.',409);
    if(prior.status==='extracting'&&Date.parse(prior.updated)+60000>Date.now())throw new BackendError('RECEIPT_EXTRACTING','Wait for the current extraction to finish.',409);
    return this.transition(scope, id, version, 'extracting', prior.sourceFacts, ['Extraction in progress; earlier values are retained for comparison.'],prior.provider??undefined,prior.modelId??undefined);
  }
  async byFile(scope: ReceiptScope, fileKey: string) {
    const row = await this.database.prepare(`SELECT * FROM receipt_drafts WHERE file_key=? AND owner=? AND plan_id=? AND ${accessCondition()}`)
      .bind(fileKey, scope.owner, scope.planId, scope.owner, scope.planId, scope.memberId).first<DraftRow>();
    if (!row) throw unavailable();
    return decode(row);
  }
  async extracted(scope: ReceiptScope, id: string, version: number, result: {
    facts: ReceiptExtraction | null; warnings: string[]; provider?: string; modelId?: string; failed?: boolean;
  }) {
    const prior=await this.get(scope,id),preserve=!result.facts&&!!prior.sourceFacts;
    return this.transition(scope, id, version, result.failed ? 'failed' : 'review-required', preserve?prior.sourceFacts:result.facts,
      preserve?[...result.warnings,'Previous extracted values are retained. The latest attempt did not replace them; review the source.',...prior.sourceFacts!.flags].slice(0,40):result.warnings,
      result.provider??(preserve?prior.provider??undefined:undefined),result.modelId??(preserve?prior.modelId??undefined:undefined));
  }
  async history(scope:ReceiptScope,id:string,before?:number){
    const current=await this.get(scope,id);
    const rows=await this.database.prepare(`SELECT version,body,created FROM receipt_revisions WHERE draft_id=? ${before===undefined?'':'AND version<?'} ORDER BY version DESC LIMIT 21`).bind(id,...before===undefined?[]:[before]).all<{version:number;body:string;created:string}>();
    const revisions=rows.results.slice(0,20).map(row=>({version:row.version,created:row.created,...JSON.parse(row.body),current:row.version===current.version}));
    if(!revisions.length&&before===undefined)revisions.push({...this.snapshot(current),version:current.version,created:current.updated,current:true,legacySnapshot:true});
    return {draftId:id,version:current.version,revisions,hasMore:rows.results.length>20,nextBefore:rows.results.length>20?revisions.at(-1)?.version:null};
  }
  private snapshot(draft:ReceiptDraft){return {status:draft.status,sourceFacts:draft.sourceFacts,warnings:draft.warnings,reviewedReceipt:draft.reviewedReceipt,provider:draft.provider,modelId:draft.modelId};}
  private async writeWithHistory(scope:ReceiptScope,prior:ReceiptDraft,statement:D1PreparedStatement){
    const guard=crypto.randomUUID();
    try{await this.database.batch([statement,
      this.database.prepare('INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)').bind(guard),
      this.database.prepare('INSERT OR IGNORE INTO receipt_revisions(draft_id,version,body,created) VALUES (?,?,?,?)').bind(prior.id,prior.version,JSON.stringify(this.snapshot(prior)),prior.updated),
      this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(guard),
    ]);}catch(error){if(/constraint|backend_write_guard/i.test(String(error)))throw conflict();throw error;}
    return this.get(scope,prior.id);
  }
  private async transition(scope: ReceiptScope, id: string, version: number, status: ReceiptDraftStatus,
    facts: ReceiptExtraction | null, warnings: string[], provider?: string, modelId?: string) {
    const prior=await this.get(scope,id);
    const statement = this.database.prepare(`UPDATE receipt_drafts SET status=?,source_facts=?,unknown_fields=?,warnings=?,
      provider=?,model_id=?,reviewed_receipt=NULL,version=version+1,updated=?
      WHERE id=? AND owner=? AND plan_id=? AND version=? AND status<>'reviewed' AND ${accessCondition(true)} AND NOT EXISTS(SELECT 1 FROM receipt_objects o WHERE o.file_key=receipt_drafts.file_key AND o.status<>'ready')`)
      .bind(status, facts ? JSON.stringify(facts) : null, JSON.stringify(unknownReceiptFields(facts)), JSON.stringify(warnings),
        provider ?? null, modelId ?? null, new Date().toISOString(), id, scope.owner, scope.planId, version,
        scope.owner, scope.planId, scope.memberId);
    return this.writeWithHistory(scope,prior,statement);
  }
  async review(scope: ReceiptScope, id: string, version: number, state: State, input: unknown, resolvedFields: string[], currency: string) {
    const draft = await this.get(scope, id);
    if (draft.version !== version) throw conflict();
    if (draft.status === 'extracting' && Date.parse(draft.updated) + 60_000 > Date.now())
      throw new BackendError('RECEIPT_EXTRACTING', 'Wait for extraction before reviewing this source.', 409);
    const parsed = parseWorkspaceMutation({version: 0, action: {type: 'receipt', receipt: input}}).action;
    if (parsed.type !== 'receipt') throw new BackendError('INVALID_RECEIPT', 'Enter the reviewed receipt values.');
    const receipt = parsed.receipt as Receipt;
    if (receipt.fileKey !== draft.fileKey || currency !== planCurrency(state.plan))
      throw new BackendError('RECEIPT_SOURCE', 'Review this source in the plan currency; no automatic conversion is applied.');
    if (receiptReviewFields(draft, currency).some(field => !resolvedFields.includes(field)))
      throw new BackendError('RECEIPT_UNKNOWN', 'Enter or explicitly verify every unclear source field before saving.');
    if (draft.sourceFacts?.currency && draft.sourceFacts.currency !== currency && !resolvedFields.includes('currency'))
      throw new BackendError('RECEIPT_CURRENCY', 'The source currency differs from the plan. Review a documented conversion manually.');
    const members = planMembers(state).map(person => person.id);
    if (!members.includes(receipt.payer)) throw new BackendError('INVALID_RECEIPT', 'Choose the person who paid.');
    splitReceipt(receipt, members, currency);
    const statement = this.database.prepare(`UPDATE receipt_drafts SET status='reviewed',reviewed_receipt=?,version=version+1,updated=?
      WHERE id=? AND owner=? AND plan_id=? AND version=? AND ${accessCondition(true)} AND NOT EXISTS(SELECT 1 FROM receipt_objects o WHERE o.file_key=receipt_drafts.file_key AND o.status<>'ready')`)
      .bind(JSON.stringify(receipt), new Date().toISOString(), id, scope.owner, scope.planId, version,
        scope.owner, scope.planId, scope.memberId);
    return this.writeWithHistory(scope,draft,statement);
  }
}

export function draftReceipt(draft: ReceiptDraft, state: State, payer: string): Receipt {
  if (draft.reviewedReceipt) return structuredClone(draft.reviewedReceipt);
  const blank = {...blankReceipt(state, payer), rows: [], fileKey: draft.fileKey, source: 'Saved receipt draft · unknown values need review'};
  const facts = draft.sourceFacts;
  // The legacy editor uses numbers. These are flagged placeholders, never approved source facts.
  if (!facts) return blank;
  if(facts.currency!==null&&facts.currency!==planCurrency(state.plan))return {...blank,merchant:facts.merchant??'',date:facts.date??blank.date,rows:facts.items.map((item,index)=>({id:`line-${index}`,name:item.name,amount:0,claims:[]}))};
  return {...blank, merchant: facts.merchant ?? '', date: facts.date ?? blank.date,
    rows: facts.items.map((item, index) => ({id: `line-${index}`, name: item.name, amount: item.amountCents ?? 0, claims: [],...sourceLineDetails(item,facts.currency===planCurrency(state.plan))})),
    tax: facts.taxIncluded?0:facts.taxCents ?? 0, tip: facts.tipCents ?? 0, discount: facts.discountCents ?? 0, total: facts.totalCents ?? 0};
}
function sourceLineDetails(item:ReceiptExtraction['items'][number],sameCurrency:boolean){
  if(!sameCurrency||item.amountCents===null||item.quantityMilli==null||item.unitPriceCents==null||item.lineDiscountCents==null)return {};
  const net=(BigInt(item.quantityMilli)*BigInt(item.unitPriceCents)+BigInt(500))/BigInt(1000)-BigInt(item.lineDiscountCents);
  return net===BigInt(item.amountCents)?{quantityMilli:item.quantityMilli,unitPrice:item.unitPriceCents,lineDiscount:item.lineDiscountCents}:{};
}
function receiptFingerprint(receipt: Receipt) {
  return JSON.stringify({merchant: receipt.merchant, date: receipt.date,
    rows: receipt.rows.map(row => ({id: row.id, name: row.name, amount: row.amount, claims: [...row.claims].sort(),allocation:row.allocation,values:row.values,quantityMilli:row.quantityMilli,unitPrice:row.unitPrice,lineDiscount:row.lineDiscount})),
    tax: receipt.tax, tip: receipt.tip, discount: receipt.discount, total: receipt.total, payer: receipt.payer,
    paymentConfirmed: receipt.paymentConfirmed, tipRule: receipt.tipRule, fileKey: receipt.fileKey, linkedItemId: receipt.linkedItemId,recording:receipt.recording,correctionReason:receipt.correctionReason});
}
/** Old receipts without a persisted draft retain their existing review flow. */
export async function requireReviewedReceiptDraft(database: D1Database, owner: string, planId: string, receipt: Receipt) {
  if (!receipt.fileKey) return;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner));
  const prefix=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(!receipt.fileKey.startsWith(`${prefix}/`))throw new BackendError('RECEIPT_ACCESS','This receipt attachment is unavailable.',403);
  const object=await database.prepare('SELECT owner,plan_id,status FROM receipt_objects WHERE file_key=?').bind(receipt.fileKey).first<{owner:string;plan_id:string;status:string}>();
  if(object&&(object.owner!==owner||object.plan_id!==planId||object.status!=='ready'))throw new BackendError('RECEIPT_SOURCE_RETIRED','This receipt source is unavailable for accounting. Upload a new source.',409);
  const row = await database.prepare('SELECT * FROM receipt_drafts WHERE file_key=?').bind(receipt.fileKey).first<DraftRow & {owner: string}>();
  if (!row) return;
  if (row.owner !== owner || row.plan_id !== planId) throw new BackendError('RECEIPT_ACCESS', 'This source belongs to another plan.', 403);
  const draft = decode(row);
  if (draft.status !== 'reviewed' || !draft.reviewedReceipt || receiptFingerprint(receipt) !== receiptFingerprint(draft.reviewedReceipt))
    throw new BackendError('RECEIPT_REVIEW_REQUIRED', 'Review and save the current receipt draft before requesting group approval.', 409);
}
