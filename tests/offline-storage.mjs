import assert from 'node:assert/strict';
import {openOfflineDb} from '../lib/offline-plans.ts';
function fixture(){let closed=0;const request={result:{close(){closed++;},objectStoreNames:{contains:()=>true}},error:Error('Storage denied')};return {request,factory:{open:()=>request},closed:()=>closed};}
let value=fixture();const pending=openOfflineDb({factory:value.factory,timeoutMs:100});value.request.onsuccess();assert.equal(await pending,value.request.result);value.request.result.onversionchange();assert.equal(value.closed(),1);
value=fixture();const blocked=openOfflineDb({factory:value.factory,timeoutMs:100});value.request.onblocked();await assert.rejects(blocked,/blocking/);value.request.onsuccess();assert.equal(value.closed(),1,'A late connection must close after blocked rejection.');
value=fixture();const failed=openOfflineDb({factory:value.factory,timeoutMs:100});value.request.onerror();await assert.rejects(failed,/Storage denied/);
value=fixture();await assert.rejects(openOfflineDb({factory:value.factory,timeoutMs:5}),/did not respond/);value.request.onsuccess();assert.equal(value.closed(),1,'A late connection must close after timeout.');
await assert.rejects(openOfflineDb({factory:{open(){throw Error('Denied synchronously');}},timeoutMs:100}),/Denied synchronously/);
console.log('Offline storage: success, blocked/error/synchronous denial, bounded waiting and late connection cleanup passed.');
