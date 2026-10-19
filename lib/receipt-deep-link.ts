import {blankReceipt,isDemoTrip,tripList,type State,type Receipt} from './model.ts';

export type ReceiptDeepLink = { planId?: string; key: string };
export function receiptDeepLink(search: string): ReceiptDeepLink | null {
  if (typeof search!=='string'||search.length>2048) return null;
  const query=new URLSearchParams(search);
  if (query.getAll('receipt').length!==1||query.get('receipt')!=='scan'||query.getAll('plan').length>1) return null;
  const planId=query.get('plan')??undefined;
  if (planId!==undefined&&!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(planId)) return null;
  return {planId,key:`receipt-scan:${planId??'current'}`};
}
export type ReceiptLinkWorkspace = {state: State|null; visitorDemo: boolean; shared: boolean;
  signedIn: boolean; canEdit: boolean; memberId?: string; hasShareToken: boolean};

/** A receipt link can navigate and open an empty review; it cannot upload, save, approve or pay. */
export async function followReceiptDeepLink(link: ReceiptDeepLink, handled: Set<string>, dependencies: {
  current:()=>ReceiptLinkWorkspace;
  selectPlan:(planId:string)=>Promise<State|undefined>;
  openBlank:(receipt:Receipt,planId:string)=>void;
}):Promise<'ignored'|'opened'|'unavailable'> {
  const before=dependencies.current();
  if (handled.has(link.key)||!before.state||before.visitorDemo||!before.signedIn||!before.canEdit) return 'ignored';
  const target=link.planId??before.state.plan.id;
  if (!target||before.state.empty) return 'ignored';
  handled.add(link.key); // Consume before awaiting selection so re-renders cannot repeat it.
  if ((before.shared||before.hasShareToken)&&target!==before.state.plan.id) return 'unavailable';
  const available=tripList(before.state).find(plan=>plan.id===target);
  if (!available) return 'unavailable';
  const source=target===before.state.plan.id?before.state:before.state.archives?.find(plan=>plan.workspace.plan.id===target)?.workspace;
  if (!source||isDemoTrip(source as State)) return 'unavailable';
  if (target!==before.state.plan.id) {
    const selected=await dependencies.selectPlan(target);
    if (selected?.plan.id!==target) return 'unavailable';
  }
  // Use the refreshed collaboration identity and workspace, never the earlier demo actor.
  const after=dependencies.current(),state=after.state,member=state?.people?.find(person=>person.id===after.memberId);
  if (!state||state.plan.id!==target||state.empty||isDemoTrip(state)||after.visitorDemo||!after.signedIn||!after.canEdit
    ||!member||!['owner','editor'].includes(member.role)) return 'unavailable';
  dependencies.openBlank(blankReceipt(state,member.id),target);
  return 'opened';
}
