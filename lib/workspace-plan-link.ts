import {isDemoTrip,type State} from './model.ts';
import {receiptDeepLink} from './receipt-deep-link.ts';

type Access={signedIn:boolean;shared:boolean;hasShareToken:boolean;canEdit:boolean;memberId?:string};
/** The existing workspace selector can only open retained plans in its authenticated scope. */
export function workspacePlanSelection(search:string,state:State,access:Access):{planId:string;status:'current'|'select'|'unavailable'}|null{
 if(!access.signedIn||search.length>2048||receiptDeepLink(search))return null;
 const query=new URLSearchParams(search),planId=query.get('plan');
 if(query.getAll('plan').length!==1||!planId||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(planId))return null;
 const unavailable={planId,status:'unavailable' as const},source=planId===state.plan.id&&!state.empty?state:state.archives?.find(plan=>plan.workspace.plan.id===planId)?.workspace;
 if(!source||((access.shared||access.hasShareToken)&&planId!==state.plan.id))return unavailable;
 const member=source.people?.find(person=>person.id===access.memberId),role=member?.role;
 if(source.people&&!['owner','editor','viewer'].includes(role??'')||!source.people&&!isDemoTrip(source as State))return unavailable;
 if(planId===state.plan.id)return {planId,status:'current'};
 if(!access.canEdit||source.people&&!['owner','editor'].includes(role??''))return unavailable;
 return {planId,status:'select'};
}
