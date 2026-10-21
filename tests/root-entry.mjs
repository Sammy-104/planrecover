import assert from 'node:assert/strict';
import {rootWorkspaceDestination} from '../lib/root-entry.ts';
import {receiptDeepLink} from '../lib/receipt-deep-link.ts';

const token='a'.repeat(64),hash='#trip='+token;
assert.equal(rootWorkspaceDestination('',hash),'/workspace'+hash,'Existing invitations reach the original membership/join UI.');
assert.equal(rootWorkspaceDestination('?plan=target&view=money',hash),'/workspace?plan=target&view=money'+hash,'Invitation scope wins over a generic OneStep query.');
const invitation=new URL(rootWorkspaceDestination('?source=invitation',hash),'https://planrecover.example');
assert.equal(invitation.searchParams.has('trip'),false,'A private invitation token must never be promoted into server query parameters.');assert.equal(invitation.hash,hash);
assert.equal(rootWorkspaceDestination('?receipt=scan',''),'/workspace?receipt=scan');
assert.equal(rootWorkspaceDestination('?plan=saved-plan-1&receipt=scan','#source-review'),'/workspace?plan=saved-plan-1&receipt=scan#source-review');
assert.deepEqual(receiptDeepLink(new URL(rootWorkspaceDestination('?plan=saved-plan-1&receipt=scan',''),'https://planrecover.example').search),{planId:'saved-plan-1',key:'receipt-scan:saved-plan-1'},'The original receipt review parser sees the same exact plan and intent.');
for(const search of ['','?plan=saved-plan-1','?view=money&plan=saved-plan-1','?receipt=other','?receipt=scan&receipt=scan','?plan=one&plan=two&receipt=scan','?token=paypal-token&PayerID=buyer','?proposal=agent-preview'])assert.equal(rootWorkspaceDestination(search,''),null,search+' does not invent a legacy Workbench action.');
assert.equal(rootWorkspaceDestination('','#how-it-works'),null,'OneStep landing anchors stay in the new frontend.');
assert.equal(rootWorkspaceDestination('?next=https://outside.example',hash),'/workspace?next=https://outside.example'+hash,'The compatibility target always remains a fixed local route.');
console.log('PASS Root routing: OneStep by default and for plan/view queries; private invitation fragments and valid receipt reviews preserve full legacy URL context without provider actions.');
