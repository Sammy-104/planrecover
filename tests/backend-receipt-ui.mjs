import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {initialState,fixtureReceipt,planMembers} from '../lib/model.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),viteRequire=createRequire(require.resolve('vite')),{build}=viteRequire(viteRequire.resolve('esbuild'));
mkdirSync(resolve(root,'build'),{recursive:true});const temporary=mkdtempSync(join(root,'build','receipt-terms-'));
try{
 const output=join(temporary,'components.mjs');await build({stdin:{contents:"export {ReceiptReviewTerms} from './components/receipt-review-terms';export {ReceiptSplitPayers} from './components/receipt-split-payers';",resolveDir:root,loader:'tsx'},outfile:output,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',jsx:'automatic',tsconfig:resolve(root,'tsconfig.json'),logLevel:'silent'});
 const {ReceiptReviewTerms,ReceiptSplitPayers}=await import(pathToFileURL(output).href),state=initialState(),members=planMembers(state),receipt={...fixtureReceipt(),id:'review-1',recording:'expense',total:6000,shares:{sam:3000,alex:3000},previousTotal:8000,previousShares:{sam:4000,alex:4000},previousContributions:{sam:3000,maya:5000},originalContributions:{sam:3000,maya:5000},contributions:{sam:2000,maya:4000},correctionReason:'Verified original tender correction'};
 const html=renderToStaticMarkup(React.createElement(ReceiptReviewTerms,{receipt,state,members,currency:'CAD'})).replaceAll('\u00a0',' ');
 assert.match(html,/<td>Sam<\/td><td>CAD 40\.00<\/td><td>CAD 30\.00<\/td><td>CAD 30\.00<\/td><td>CAD 20\.00<\/td>/);
 assert.match(html,/<td>Maya<\/td><td>CAD 0\.00<\/td><td>CAD 0\.00<\/td><td>CAD 50\.00<\/td><td>CAD 40\.00<\/td>/);
 console.log('PASS Actual approval table shows proposed tender amounts beside the previous contribution, with all original contributors.');
 const correction=renderToStaticMarkup(React.createElement(ReceiptSplitPayers,{receipt,members,currency:'CAD',locked:true,onChange(){}}));
 assert.ok(!correction.startsWith('<fieldset disabled'));assert.match(correction,/<input type="checkbox" disabled=""/);assert.ok(correction.includes('Sam paid on this receipt'));assert.ok(correction.includes('Maya paid on this receipt'));assert.ok(!correction.includes('Alex paid on this receipt'));
 console.log('PASS A recorded manual correction allows amounts for original payers while locking payer identities and mode.');
 const evidence=renderToStaticMarkup(React.createElement(ReceiptSplitPayers,{receipt,members,currency:'CAD',locked:true,readOnly:true,onChange(){}}));assert.match(evidence,/<fieldset[^>]*disabled=""/);
 const evidenceTerms=renderToStaticMarkup(React.createElement(ReceiptReviewTerms,{receipt:{...receipt,recording:'evidence'},state,members,currency:'CAD'})).replaceAll('\u00a0',' ');assert.match(evidenceTerms,/<td>Sam<\/td><td>CAD 40\.00<\/td><td>CAD 30\.00<\/td><td>CAD 30\.00<\/td><td>CAD 30\.00<\/td>/);
 console.log('PASS Provider-linked evidence locks contribution inputs and displays retained provider contributions.');
}finally{rmSync(temporary,{recursive:true,force:true});}
