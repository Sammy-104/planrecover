import { applyAction, initialState, isDemoTrip, type Action, type Preferences, type Receipt, type State } from './model.ts';
import { accountPersonId, defaultPreferences, initializePeople, makePerson, type Identity } from './people.ts';
import { BackendError, conflict, forbidden, missingPlan } from './backend-errors.ts';
import { sharedTripView } from './trip-sharing.ts';
import { requireReviewedReceiptDraft } from './receipt-drafts.ts';
import {financialSnapshotWrites} from './financial-history.ts';
import {hasFinalizedReceiptPurchase} from './receipt-accounting.ts';

type PlanStatus = 'active' | 'archived' | 'deleted';
type PlanRow = {owner:string; id:string; body:string; version:number; status:PlanStatus; ordinal:number};
export type PlanRecord = {owner:string; state:State; version:number; role:string};
export type PlanSummary = {id:string; name:string; kind:string; currency:string; start:string; end:string; version:number; role:string};
type Guard = {planId:string; version:number; memberId:string};
type LinkGuard = {tokenHash:string;tripId:string;role:'viewer'|'editor'};

function snapshots(state:State) {
  const entries: {state:State; status:PlanStatus; ordinal:number}[] = [];
  if (!state.empty) entries.push({state,status:'active',ordinal:0});
  for (const [ordinal, value] of (state.archives ?? []).entries()) entries.push({state:value.workspace as State,status:'archived',ordinal});
  for (const [ordinal, value] of (state.deletedTrips ?? []).entries()) entries.push({state:value.workspace as State,status:'deleted',ordinal});
  return entries;
}

function planBody(state:State): State {
  const result = structuredClone(state);
  delete result.archives;
  delete result.deletedTrips;
  result.version = 0;
  if (!isDemoTrip(result)) result.preferences = {};
  return result;
}

function privateFreeWorkspace(state:State):State {
  const result = structuredClone(state);
  for (const entry of snapshots(result)) if (!isDemoTrip(entry.state)) entry.state.preferences = {};
  if (result.empty) result.preferences = {};
  return result;
}

/** The server keeps full preferences for calculations; this is the only client projection. */
export function visibleWorkspace(state:State, memberId?:string):State {
  const result = structuredClone(state);
  for (const entry of snapshots(result)) {
    entry.state.reimbursementLinks=Object.fromEntries(Object.entries(entry.state.preferences).filter(([,pref])=>pref.paypalMe).map(([id,pref])=>[id,pref.paypalMe]));
    if (!isDemoTrip(entry.state)) entry.state.preferences = memberId && entry.state.preferences[memberId]
      ? {[memberId]:entry.state.preferences[memberId]} : {};
  }
  if (result.empty) result.preferences = {};
  return result;
}

export class PlanRepository {
  private database:D1Database;
  constructor(database:D1Database) {this.database=database;}

  private async root(owner:string) {
    return this.database.prepare('SELECT body, version FROM workspaces WHERE owner = ?').bind(owner)
      .first<{body:string;version:number}>();
  }

  private async memberRows(owner:string, state:State, identity?:Identity) {
    if (state.people) return state.people;
    // Demo personas remain fixtures. The real account owns the plan, not the seeded payments.
    const actual = identity ?? {id:await accountPersonId(owner),name:'Plan owner'};
    return [makePerson(actual.id,actual.name,'owner')];
  }

  private async snapshotWrites(owner:string, state:State, insertOnly:boolean, identity?:Identity) {
    const commands:D1PreparedStatement[] = [];
    const now = new Date().toISOString();
    // Also revoke legacy deleted-plan links before a restore changes its status.
    commands.push(this.database.prepare("DELETE FROM trip_links WHERE owner=? AND trip_id IN (SELECT id FROM plans WHERE owner=? AND status='deleted')").bind(owner,owner));
    if(!insertOnly)commands.push(this.database.prepare("UPDATE plans SET status='deleted',version=version+1,updated=? WHERE owner=? AND status<>'deleted' AND id NOT IN (SELECT value FROM json_each(?))")
      .bind(now,owner,JSON.stringify(snapshots(state).map(entry=>entry.state.plan.id))));
    for (const entry of snapshots(state)) {
      const id = entry.state.plan.id;
      if (!id) throw new BackendError('INVALID_PLAN', 'The saved plan needs an identifier.');
      // A previously recorded standalone receipt can reconcile an estimate, but
      // it must not race an already reserved checkout/invoice for that purchase.
      for(const receipt of entry.state.receipts){
        const target=receipt.status==='approved'?receipt.linkedItemId:receipt.reconciledItemId;
        if(!target||!receipt.accountingItemId||receipt.accountingItemId===target||!hasFinalizedReceiptPurchase(entry.state,target))continue;
        const receiptGuard=crypto.randomUUID();
        commands.push(this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN
          NOT EXISTS(SELECT 1 FROM payment_funding_claims WHERE owner=? AND plan_id=? AND item_id=?) OR
          EXISTS(SELECT 1 FROM plans p,json_each(p.body,'$.receipts') r WHERE p.owner=? AND p.id=? AND json_extract(r.value,'$.id')=?
           AND json_extract(r.value,'$.accountingItemId')=? AND (json_extract(r.value,'$.reconciledItemId')=? OR
            json_extract(r.value,'$.status')='approved' AND json_extract(r.value,'$.linkedItemId')=?)) THEN 1 ELSE 0 END)`)
          .bind(receiptGuard,owner,id,target,owner,id,receipt.id,receipt.accountingItemId,target,target));
        commands.push(this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(receiptGuard));
      }
      const body = JSON.stringify(planBody(entry.state));
      commands.push(this.database.prepare(insertOnly
        ? 'INSERT OR IGNORE INTO plans (owner,id,name,body,version,status,ordinal,updated) VALUES (?,?,?,?,0,?,?,?)'
        : `INSERT INTO plans (owner,id,name,body,version,status,ordinal,updated) VALUES (?,?,?,?,0,?,?,?)
           ON CONFLICT(owner,id) DO UPDATE SET name=excluded.name,body=excluded.body,status=excluded.status,ordinal=excluded.ordinal,
           version=plans.version+CASE WHEN plans.body<>excluded.body OR plans.status<>excluded.status THEN 1 ELSE 0 END,updated=excluded.updated`)
        .bind(owner,id,entry.state.plan.name,body,entry.status,entry.ordinal,now));
      const people = await this.memberRows(owner,entry.state,identity);
      // Membership is a server-managed projection of the existing tested plan aggregate.
      if (!insertOnly) commands.push(this.database.prepare("UPDATE plan_members SET role='legacy',body=json_set(body,'$.role','legacy') WHERE owner=? AND plan_id=? AND member_id NOT IN (SELECT value FROM json_each(?))")
        .bind(owner,id,JSON.stringify(people.map(person=>person.id))));
      for (const person of people) {
        commands.push(this.database.prepare('INSERT INTO profiles (id,display_name,updated) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,updated=excluded.updated')
          .bind(person.id,person.name,now));
        commands.push(this.database.prepare(insertOnly
          ? 'INSERT OR IGNORE INTO plan_members (owner,plan_id,member_id,role,body) VALUES (?,?,?,?,?)'
          : 'INSERT INTO plan_members (owner,plan_id,member_id,role,body) VALUES (?,?,?,?,?) ON CONFLICT(owner,plan_id,member_id) DO UPDATE SET role=excluded.role,body=excluded.body')
          .bind(owner,id,person.id,person.role,JSON.stringify(person)));
        if (!isDemoTrip(entry.state)) commands.push(this.database.prepare('INSERT OR IGNORE INTO member_preferences (owner,plan_id,member_id,body,version,updated) VALUES (?,?,?,?,0,?)')
          .bind(owner,id,person.id,JSON.stringify(entry.state.preferences[person.id] ?? defaultPreferences(entry.state.plan.budget)),now));
      }
    }
    // Deletion and link revocation share the workspace compare-and-swap batch.
    commands.push(this.database.prepare("DELETE FROM trip_links WHERE owner=? AND trip_id IN (SELECT id FROM plans WHERE owner=? AND status='deleted')").bind(owner,owner));
    commands.push(...await financialSnapshotWrites(this.database,owner,snapshots(state).map(entry=>entry.state)));
    return commands;
  }

  /** Lazy, idempotent import; existing approved IDs and provider tables are preserved. */
  async importWorkspace(owner:string, state:State, identity?:Identity) {
    const root=await this.root(owner);
    // Structural normalization must use saveWorkspace's versioned transaction first.
    if(!root||root.version!==state.version||JSON.stringify(privateFreeWorkspace({...JSON.parse(root.body),version:root.version}))!==JSON.stringify(privateFreeWorkspace(state)))throw conflict();
    const commands = await this.snapshotWrites(owner,state,true,identity);
    const token=crypto.randomUUID();
    commands.unshift(this.database.prepare('INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND version=? AND body=?) THEN 1 ELSE 0 END)')
      .bind(token,owner,state.version,root.body));
    commands.push(this.database.prepare('UPDATE workspaces SET body=? WHERE owner=? AND version=?')
      .bind(JSON.stringify(privateFreeWorkspace(state)),owner,state.version));
    commands.push(this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token));
    try {await this.database.batch(commands);}
    catch(error){if(String(error).includes('CHECK constraint failed'))throw conflict();throw error;}
  }

  async loadWorkspace(owner:string):Promise<State|null> {
    const row = await this.root(owner);
    if (!row) return null;
    const state = {...JSON.parse(row.body),version:row.version} as State;
    const preferences = await this.database.prepare('SELECT plan_id,member_id,body FROM member_preferences WHERE owner=?')
      .bind(owner).all<{plan_id:string;member_id:string;body:string}>();
    for (const entry of snapshots(state)) if (!isDemoTrip(entry.state)) {
      for (const pref of preferences.results.filter(pref=>pref.plan_id===entry.state.plan.id)) entry.state.preferences[pref.member_id]=JSON.parse(pref.body);
    }
    return state;
  }

  async saveWorkspace(owner:string, state:State, expectedVersion:number, guard?:Guard, link?:LinkGuard, effects:D1PreparedStatement[]=[]):Promise<State> {
    const next = {...state,version:expectedVersion+1};
    const token = crypto.randomUUID();
    const conditions = guard
      ? `EXISTS(SELECT 1 FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
           WHERE p.owner=? AND p.id=? AND p.version=? AND p.status<>'deleted' AND m.member_id=? AND m.role IN ('owner','editor'))`
      : '1';
    const linkCondition=link?"EXISTS(SELECT 1 FROM trip_links WHERE token_hash=? AND owner=? AND trip_id=? AND role=? AND (expires IS NULL OR julianday(expires)>julianday('now')))":'1';
    const guarded = this.database.prepare(`INSERT INTO backend_write_guards (id,valid) VALUES (?,CASE WHEN
      EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND version=?) AND ${conditions} AND ${linkCondition} THEN 1 ELSE 0 END)`)
      .bind(token,owner,expectedVersion,...(guard?[owner,guard.planId,guard.version,guard.memberId]:[]),...(link?[link.tokenHash,owner,link.tripId,link.role]:[]));
    const commands = [guarded,
      this.database.prepare('UPDATE workspaces SET body=?,version=?,updated=? WHERE owner=?')
        .bind(JSON.stringify(privateFreeWorkspace(next)),next.version,new Date().toISOString(),owner),
      ...await this.snapshotWrites(owner,next,false),
      ...effects,
      this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token)];
    try {await this.database.batch(commands);}
    catch (error) {
      if (String(error).includes('backend_write_guard_valid') || String(error).includes('CHECK constraint failed')) throw conflict();
      throw error;
    }
    return (await this.loadWorkspace(owner))!;
  }

  async listPlans(memberId:string):Promise<PlanSummary[]> {
    const rows = await this.database.prepare(`SELECT p.*,m.role FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
      WHERE m.member_id=? AND m.role<>'legacy' AND p.status<>'deleted' ORDER BY p.updated DESC,p.id`)
      .bind(memberId).all<PlanRow & {role:string}>();
    return rows.results.map(row=>{const state=JSON.parse(row.body) as State;return {
      id:row.id,name:state.plan.name,kind:state.plan.kind??'trip',currency:state.plan.currency??'CAD',
      start:state.plan.start,end:state.plan.end,version:row.version,role:row.role};});
  }

  private async accessible(planId:string,identity:Identity) {
    const row = await this.database.prepare(`SELECT p.*,m.role FROM plans p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.id
      WHERE p.id=? AND m.member_id=? AND m.role<>'legacy' AND p.status<>'deleted'`)
      .bind(planId,identity.id).first<PlanRow & {role:string}>();
    if (!row) throw missingPlan();
    return row;
  }

  async getPlan(planId:string, identity:Identity):Promise<PlanRecord> {
    const row = await this.accessible(planId,identity);
    const state = {...JSON.parse(row.body),version:row.version} as State;
    if (!isDemoTrip(state)) {
      const preferences=await this.database.prepare('SELECT body FROM member_preferences WHERE owner=? AND plan_id=? AND member_id=?')
        .bind(row.owner,planId,identity.id).first<{body:string}>();
      state.preferences=preferences?{[identity.id]:JSON.parse(preferences.body)}:{};
      const links=await this.database.prepare('SELECT member_id,body FROM member_preferences WHERE owner=? AND plan_id=?')
        .bind(row.owner,planId).all<{member_id:string;body:string}>();
      state.reimbursementLinks=Object.fromEntries(links.results.map(link=>[link.member_id,(JSON.parse(link.body) as Preferences).paypalMe]).filter(([,link])=>!!link));
    }
    return {owner:row.owner,state,version:row.version,role:row.role};
  }

  async createPlan(owner:string,identity:Identity,plan:Partial<State['plan']>,effects:((next:State)=>D1PreparedStatement[])=()=>[]):Promise<PlanRecord> {
    for(let attempt=0;attempt<3;attempt++) {
      let root=await this.loadWorkspace(owner);
      if(!root) {
        root=initialState();
        await this.database.prepare('INSERT OR IGNORE INTO workspaces (owner,body,version,updated) VALUES (?,?,0,?)')
          .bind(owner,JSON.stringify(root),new Date().toISOString()).run();
        root=(await this.loadWorkspace(owner))!;
      }
      await this.importWorkspace(owner,root,identity);
      const next=applyAction(initialState(),{type:'create_trip',actor:'sam',plan});
      delete next.people; next.preferences={}; initializePeople(next,identity);
      next.archives=[...(!root.empty?[{id:root.plan.id!,archivedAt:new Date().toISOString(),workspace:planBody(root)}]:[]),...(root.archives??[])];
      // Preserve internal preferences when moving an existing plan to history.
      if(!root.empty) next.archives[0].workspace.preferences=structuredClone(root.preferences);
      next.deletedTrips=root.deletedTrips??[];
      next.demoRemoved=root.demoRemoved;
      try {await this.saveWorkspace(owner,next,root.version,undefined,undefined,effects(next));return this.getPlan(next.plan.id!,identity);}
      catch(error){if(!(error instanceof BackendError)||error.status!==409)throw error;}
    }
    throw conflict();
  }

  /** Saved caller-scoped decisions only: this method never synchronizes jobs or contacts providers. */
  async getDecisionExtras(planId:string,identity:Identity){
    const plan=await this.accessible(planId,identity);
    const invoiceRows=await this.database.prepare(`SELECT id,item_id,member_id,amount,paid,status,version,approved_members FROM plan_invoices
      WHERE owner=? AND plan_id=? AND status IN ('draft','sending','sent','partially-paid','needs-review')
      AND (member_id=? OR ?='owner') ORDER BY updated DESC LIMIT 100`)
      .bind(plan.owner,planId,identity.id,plan.role).all<{id:string;item_id:string;member_id:string;amount:number;paid:number;status:string;version:number;approved_members:string}>();
    const invoices=invoiceRows.results.map(row=>({id:row.id,itemId:row.item_id,memberId:row.member_id,
      amount:row.amount,outstanding:row.amount-row.paid,status:row.status,version:row.version,
      action:row.status==='needs-review'?'merchant-review':row.status==='draft'&&!JSON.parse(row.approved_members).includes(row.member_id)?
        row.member_id===identity.id?'approve-terms':'await-recipient-approval':row.status==='draft'&&plan.role==='owner'?'send-after-review':
        ['sent','partially-paid'].includes(row.status)&&row.member_id===identity.id?'review-payment':'await-provider'}));
    const recoveryRows=await this.database.prepare(`SELECT r.id,r.version,r.status,r.body FROM recovery_proposals r
      WHERE r.owner=? AND r.plan_id=? AND r.status IN ('review','executing','manual-review')
      AND EXISTS(SELECT 1 FROM json_each(r.body,'$.required') WHERE value=?)
      AND NOT EXISTS(SELECT 1 FROM recovery_approvals a WHERE a.proposal_id=r.id AND a.version=r.version AND a.member_id=?)
      ORDER BY r.updated DESC LIMIT 100`).bind(plan.owner,planId,identity.id,identity.id)
      .all<{id:string;version:number;status:string;body:string}>();
    const recoveries=recoveryRows.results.map(row=>{const body=JSON.parse(row.body);return {id:row.id,version:row.version,status:row.status,
      itemId:body.policy.itemId,reason:body.reason,ownRefund:body.allocations.filter((a:{memberId:string})=>a.memberId===identity.id)
        .reduce((sum:number,a:{amount:number})=>sum+a.amount,0),requiresReview:true};});
    const notifications=await this.database.prepare(`SELECT id,title,body,created FROM plan_notifications
      WHERE owner=? AND plan_id=? AND member_id=? AND read_at IS NULL ORDER BY created DESC LIMIT 100`)
      .bind(plan.owner,planId,identity.id).all<{id:string;title:string;body:string;created:string}>();
    const changes=await this.database.prepare(`SELECT c.id,c.body FROM plan_changes c WHERE c.owner=? AND c.plan_id=? AND c.status='review' AND EXISTS(SELECT 1 FROM json_each(c.body,'$.required') WHERE value=?) AND NOT EXISTS(SELECT 1 FROM plan_change_approvals a WHERE a.change_id=c.id AND a.member_id=?) ORDER BY c.created DESC LIMIT 50`).bind(plan.owner,planId,identity.id,identity.id).all<{id:string;body:string}>();
    return {invoices,recoveries,notifications:notifications.results,...(changes.results.length?{changes:changes.results.map(row=>{const terms=JSON.parse(row.body);return {id:row.id,kind:terms.kind,ownImpact:terms.figures.memberImpacts?.[identity.id]??null,reviewUrl:`/flows?plan=${encodeURIComponent(planId)}`,requiresReview:true};})}:{})};
  }

  async updatePlan(planId:string,identity:Identity,expectedVersion:number,action:Action,effects:D1PreparedStatement[]=[]):Promise<PlanRecord> {
    if(['create_trip','select_trip','delete_trip','restore_trip','reset','preferences'].includes(action.type))
      throw new BackendError('INVALID_PLAN_ACTION','Use the dedicated plan or preferences endpoint for this action.');
    for(let attempt=0;attempt<3;attempt++) {
      const record=await this.accessible(planId,identity);
      if(!['owner','editor'].includes(record.role))throw forbidden();
      if(record.version!==expectedVersion)throw conflict();
      const root=(await this.loadWorkspace(record.owner))!;
      const target=sharedTripView(root,planId);
      if(!target)throw missingPlan();
      if(!target.people)throw new BackendError('DEMO_ONLY','Use the labelled demo workspace for fixture actions.');
      if(action.type==='receipt')await requireReviewedReceiptDraft(this.database,record.owner,planId,action.receipt as Receipt);
      const next=applyAction(target,{...action,actor:identity.id,tripId:planId});
      if(next.plan.id!==planId)throw new BackendError('PLAN_ID_CHANGED','Create a separate plan for a different destination.');
      let merged:State;
      if(root.plan.id===planId&&!root.empty) merged={...next,archives:root.archives,deletedTrips:root.deletedTrips,demoRemoved:root.demoRemoved,version:root.version};
      else {merged=structuredClone(root);const archive=merged.archives!.find(value=>value.workspace.plan.id===planId)!;archive.workspace=next;}
      try {await this.saveWorkspace(record.owner,merged,root.version,{planId,version:expectedVersion,memberId:identity.id},undefined,effects);return this.getPlan(planId,identity);}
      catch(error){if(!(error instanceof BackendError)||error.status!==409)throw error;}
    }
    throw conflict();
  }

  async getPreferences(planId:string,identity:Identity) {
    const plan=await this.accessible(planId,identity);
    const row=await this.database.prepare('SELECT body,version FROM member_preferences WHERE owner=? AND plan_id=? AND member_id=?')
      .bind(plan.owner,planId,identity.id).first<{body:string;version:number}>();
    if(!row)throw new BackendError('PREFERENCES_UNAVAILABLE','Personal preferences are available on personal plans.',404);
    return {preferences:JSON.parse(row.body) as Preferences,version:row.version};
  }

  async updatePreferences(planId:string,identity:Identity,preferences:Preferences,expectedVersion:number,options?:{workspaceVersion:number;link?:LinkGuard}) {
    const plan=await this.accessible(planId,identity);
    if(!['owner','editor'].includes(plan.role))throw forbidden();
    const root=(await this.loadWorkspace(plan.owner))!;
    const target=snapshots(root).find(entry=>entry.state.plan.id===planId)?.state;
    if(!target?.people)throw new BackendError('PREFERENCES_UNAVAILABLE','Use demo settings for fixture preferences.');
    // Reuse the deterministic domain validation, with a server-bound actor.
    const validated=applyAction(target,{type:'preferences',actor:identity.id,preferences}).preferences[identity.id];
    const token=crypto.randomUUID();
    try {
      await this.database.batch([
        this.database.prepare(`INSERT INTO backend_write_guards(id,valid) VALUES (?,CASE WHEN EXISTS(
          SELECT 1 FROM member_preferences p JOIN plan_members m ON m.owner=p.owner AND m.plan_id=p.plan_id AND m.member_id=p.member_id
          JOIN plans t ON t.owner=p.owner AND t.id=p.plan_id
          WHERE p.owner=? AND p.plan_id=? AND p.member_id=? AND p.version=? AND m.role IN ('owner','editor') AND t.status<>'deleted')
          ${options?'AND EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND version=?)':''}
          ${options?.link?"AND EXISTS(SELECT 1 FROM trip_links WHERE token_hash=? AND owner=? AND trip_id=? AND role=? AND (expires IS NULL OR julianday(expires)>julianday('now')))":''}
          THEN 1 ELSE 0 END)`)
          .bind(token,plan.owner,planId,identity.id,expectedVersion,...(options?[plan.owner,options.workspaceVersion]:[]),
            ...(options?.link?[options.link.tokenHash,plan.owner,options.link.tripId,options.link.role]:[])),
        this.database.prepare('UPDATE member_preferences SET body=?,version=version+1,updated=? WHERE owner=? AND plan_id=? AND member_id=?')
          .bind(JSON.stringify(validated),new Date().toISOString(),plan.owner,planId,identity.id),
        this.database.prepare('UPDATE workspaces SET version=version+1,updated=? WHERE owner=?').bind(new Date().toISOString(),plan.owner),
        this.database.prepare('DELETE FROM backend_write_guards WHERE id=?').bind(token),
      ]);
    }catch(error){if(String(error).includes('CHECK constraint failed'))throw conflict();throw error;}
    return {preferences:validated,version:expectedVersion+1};
  }
}
