import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {parseReceiptText} from '../lib/receipt-ocr.ts';
import {receiptPaperBounds} from '../lib/receipt-image.ts';
import {createTestD1} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {accountPersonId,addPerson} from '../lib/people.ts';
import {ReceiptDraftRepository,draftReceipt,receiptReviewFields} from '../lib/receipt-drafts.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{build}=require(createRequire(require.resolve('vite')).resolve('esbuild'));
const origin='https://planrecover.test',owner='scanner-owner',identity={id:await accountPersonId(owner),name:'Scanner owner'};
let checks=0,calls=0;globalThis.fetch=async()=>{calls++;throw Error('Device OCR text parsing must not call any external provider.');};
const cad='TEST KITCHEN\n2027-04-04\nBurger 12.00\nPasta 8.00\nSubtotal 20.00\nHST 2.60\nTip 0.00\nDiscount 0.00\nTOTAL CAD 22.60\nVISA 22.60\nChange 0.00';
const swiss='Berghotel\nGrosse Scheidegg\n30.07.2007/13:29:17\n2xLatte Macchiato à 4.50 CHF 9.00\n1xGloki à 5.00 CHF 5.00\n1xSchweineschnitzel à 22.00 CHF 22.00\n1xChasspatzli à 18.50 CHF 18.50\nTotal : CHF 54.50\nInc. 7.6% MwSt 54.50 CHF: 3.85\nEntspricht in Euro 36.33 EUR';
function check(name,run){run();checks++;console.log('PASS '+name);}
check('Paper detection keeps text and margins while ambiguous or tiny regions retain the full photo',()=>{
 const width=100,height=120,pixels=new Uint8ClampedArray(width*height*4);
 for(let y=15;y<105;y++)for(let x=20;x<80;x++){const i=(y*width+x)*4;pixels.set([240,240,240,255],i);}
 // Dark print inside the page must not shrink its outer bounds.
 for(let y=35;y<90;y+=10)for(let x=30;x<70;x++){const i=(y*width+x)*4;pixels.set([20,20,20,255],i);}
 const bounds=receiptPaperBounds(pixels,width,height);assert.ok(bounds.x<20&&bounds.y<15);assert.ok(bounds.x+bounds.width>80&&bounds.y+bounds.height>105);
 assert.deepEqual(receiptPaperBounds(new Uint8ClampedArray(width*height*4),width,height),{x:0,y:0,width,height});
 assert.deepEqual(receiptPaperBounds(new Uint8ClampedArray(4),width,height),{x:0,y:0,width,height});
});
check('Item rows and exact cents exclude subtotals, payments and change',()=>{const facts=parseReceiptText(cad);assert.deepEqual(facts.items,[{name:'Burger',amountCents:1200},{name:'Pasta',amountCents:800}]);assert.equal(facts.totalCents,2260);assert.equal(facts.taxCents,260);assert.equal(facts.currency,'CAD');assert.equal(facts.date,'2027-04-04');});
check('The Swiss receipt keeps CHF, four item totals, its date and inclusive tax without counting the EUR equivalent',()=>{const facts=parseReceiptText(swiss);assert.equal(facts.currency,'CHF');assert.equal(facts.items.length,4);assert.equal(facts.items.reduce((sum,item)=>sum+item.amountCents,0),5450);assert.equal(facts.totalCents,5450);assert.equal(facts.date,'2007-07-30');assert.equal(facts.taxIncluded,true);assert.equal(facts.taxCents,385);});
check('Missing and ambiguous source facts stay unknown rather than zero or assumed CAD',()=>{const facts=parseReceiptText('COFFEE SHOP\n04/05/2027\nCoffee $4.50\nTotal $4.50');assert.equal(facts.currency,null);assert.equal(facts.date,null);assert.equal(facts.taxCents,null);assert.equal(facts.tipCents,null);assert.equal(facts.discountCents,null);assert.equal(facts.items.length,1);});
check('A stray receipt border does not hide a readable price, and mismatched totals warn even when tip is unknown',()=>{const facts=parseReceiptText('SHOP\nCoffee CHF 9.00 =\nMeal CHF 22.00\nTotal CHF 94.50\nIncl. 7.6% MwSt CHF 3.85');assert.equal(facts.items.length,2);assert.equal(facts.items[0].amountCents,900);assert.equal(facts.tipCents,null);assert.ok(facts.flags.some(flag=>flag.includes('do not match')));});
mkdirSync(resolve(root,'build'),{recursive:true});const directory=mkdtempSync(join(root,'build','backend-scanner-'));globalThis.scannerTestEnv={DB:undefined};
try{
 const outfile=join(directory,'route.mjs');await build({entryPoints:[resolve(root,'app/api/receipt/scan/route.ts')],outfile,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent',tsconfig:resolve(root,'tsconfig.json'),plugins:[{name:'workers',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.scannerTestEnv;',loader:'js'}));}}]});
 const route=await import(pathToFileURL(outfile).href);
 async function fixture(run){const database=createTestD1();globalThis.scannerTestEnv.DB=database;try{const repository=new PlanRepository(database),record=await repository.createPlan(owner,identity,{name:'Scanner verification',destination:'Toronto',start:'2027-04-04',end:'2027-04-04',timezone:'America/Toronto',currency:'CAD',budget:5000});
  const drafts=new ReceiptDraftRepository(database),draft=await drafts.create({owner,planId:record.state.plan.id,memberId:identity.id},{fileKey:'fixture-photo',mime:'image/jpeg',size:100});
  const request=(overrides={},options={})=>new Request(origin+'/api/receipt/scan',{method:'POST',headers:{'content-type':'application/json',origin:options.origin??origin,...(options.account===null?{}:{'oai-authenticated-user-id':options.account??owner}),...(options.token?{'x-trip-share':options.token}:{})},body:JSON.stringify({tripId:record.state.plan.id,draftId:draft.id,version:draft.version,text:cad,...overrides})});
  await run({database,repository,record,drafts,draft,request});checks++;}finally{database.close();}}
 await fixture(async({database,repository,record,draft,request})=>{const before=await repository.loadWorkspace(owner),response=await route.POST(request()),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.draft.sourceFacts.items.length,2);assert.equal(data.receipt.rows.length,2);assert.equal(data.draft.provider,'device-ocr');assert.equal(data.receipt.paymentConfirmed,false);assert.deepEqual(data.receipt.rows[0].claims,[]);assert.deepEqual(await repository.loadWorkspace(owner),before);assert.equal(database.sqlite.prepare('SELECT COUNT(*) AS n FROM financial_events WHERE plan_id=?').get(record.state.plan.id).n,0);
  const again=await route.POST(request());assert.equal(again.status,409);console.log('PASS Device scan persists editable items without financial effects and fences stale scans');});
 await fixture(async({record,draft,request})=>{const response=await route.POST(request({text:swiss})),data=await response.json();assert.equal(response.status,200);assert.equal(data.receipt.rows.length,4);assert.ok(data.receipt.rows.every(row=>row.amount===0));assert.equal(data.draft.sourceFacts.currency,'CHF');assert.ok(data.reviewFields.includes('currency'));assert.ok(data.reviewFields.includes('items.3.amountCents'));assert.equal(data.receipt.merchant,'Berghotel');assert.equal(data.receipt.date,'2007-07-30');console.log('PASS Foreign-currency names populate but every converted amount still requires review');});
 await fixture(async({record,drafts,draft,request})=>{const unknown=parseReceiptText('COFFEE SHOP\nCoffee 4.50\nTotal 4.50'),saved=await drafts.extracted({owner,planId:record.state.plan.id,memberId:identity.id},draft.id,draft.version,{facts:unknown,warnings:[]});
  assert.equal(draftReceipt(saved,record.state,identity.id).rows[0].amount,450);assert.ok(receiptReviewFields(saved,'CAD').includes('currency'));
  const inclusive={...parseReceiptText(cad),items:[{name:'Coffee',amountCents:1000}],taxCents:115,taxIncluded:true,totalCents:1000};assert.equal(draftReceipt({...saved,sourceFacts:inclusive},record.state,identity.id).tax,0);console.log('PASS Unknown currency stays flagged while readable items survive; inclusive tax is not added twice');});
 await fixture(async({request,database,record,repository,drafts,draft})=>{for(const [body,options,status]of [[{}, {account:null},401],[{}, {account:'outsider'},404],[{}, {origin:'https://bad.test'},400],[{text:'x'.repeat(32001)}, {},400],[{actor:'other'}, {},400]])assert.equal((await route.POST(request(body,options))).status,status);
  const state=await repository.loadWorkspace(owner),viewer={id:await accountPersonId('viewer'),name:'Viewer'};addPerson(state,viewer,'viewer');await repository.saveWorkspace(owner,state,state.version);const token='a'.repeat(64),hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');await database.prepare('INSERT INTO trip_links(token_hash,token,owner,trip_id,role,created,expires) VALUES (?,?,?,?,?,?,?)').bind(hash,token,owner,record.state.plan.id,'viewer',new Date().toISOString(),new Date(Date.now()+3600000).toISOString()).run();assert.equal((await route.POST(request({}, {account:'viewer',token}))).status,403);
  database.sqlite.prepare("UPDATE receipt_drafts SET status='reviewed' WHERE id=?").run(draft.id);assert.equal((await route.POST(request())).status,409);console.log('PASS Scan endpoint protects identity, owner scope, viewer roles, origin, body limits and reviewed records');});
 assert.equal(calls,0);console.log(`${checks} receipt scanner checks passed with no provider calls.`);
}finally{rmSync(directory,{recursive:true,force:true});delete globalThis.scannerTestEnv;}
