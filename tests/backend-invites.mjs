import assert from 'node:assert/strict';
import {createTestD1,applyMigrations} from './helpers/d1.mjs';
import {PlanRepository} from '../lib/plan-repository.ts';
import {addPerson} from '../lib/people.ts';

const owner={id:'person-invite-owner',name:'Invite owner'};
const editor={id:'person-invite-editor',name:'Invite editor'};
const plan={name:'Invitation test',destination:'Toronto, Ontario, Canada',start:'2027-05-01',end:'2027-05-03',budget:30000};
const conflict=error=>error?.status===409;
const token='a'.repeat(64),hash='b'.repeat(64);
let checks=0;
async function check(label,callback){await callback();checks++;console.log(`PASS ${label}`);}

await check('Invitation expiry migration preserves legacy tokens with nullable expiry',async()=>{
 const database=createTestD1({migrations:{through:'0004_pretty_lester.sql'}});
 try{
  await database.prepare('INSERT INTO trip_links(token_hash,token,owner,trip_id,created,role) VALUES (?,?,?,?,?,?)')
   .bind(hash,token,'invite-account','legacy-plan','2026-10-01T12:00:00Z','editor').run();
  applyMigrations(database);
  const row=await database.prepare('SELECT * FROM trip_links WHERE token_hash=?').bind(hash).first();
  assert.equal(row.token,token);
  assert.equal(row.role,'editor');
  assert.equal(row.expires,null);
  const column=database.sqlite.prepare('PRAGMA table_info(trip_links)').all().find(value=>value.name==='expires');
  assert.equal(column.notnull,0,'The additive column stays nullable for deployed databases.');
  assert.equal(column.dflt_value,null,'Runtime expiry is set by the application, without a dynamic schema default.');
 }finally{database.close();}
});

async function sharedPlan(){
 const database=createTestD1(),repository=new PlanRepository(database);
 const record=await repository.createPlan('invite-account',owner,plan);
 let root=await repository.loadWorkspace('invite-account');
 addPerson(root,editor,'editor');
 root=await repository.saveWorkspace('invite-account',root,root.version);
 await database.prepare('INSERT INTO trip_links(token_hash,token,owner,trip_id,created,role,expires) VALUES (?,?,?,?,?,?,?)')
  .bind(hash,token,'invite-account',record.state.plan.id,new Date().toISOString(),'editor',new Date(Date.now()+7*86_400_000).toISOString()).run();
 return {database,repository,root,link:{tokenHash:hash,tripId:record.state.plan.id,role:'editor'}};
}

await check('An invitation expiring after access lookup cannot commit plan or preference writes',async()=>{
 const {database,repository,root,link}=await sharedPlan();
 try{
  const observed=await database.prepare('SELECT expires FROM trip_links WHERE token_hash=?').bind(hash).first();
  assert.ok(Date.parse(observed.expires)>Date.now(),'The invitation was valid when access was read.');
  const beforePreference=await repository.getPreferences(link.tripId,editor);
  const beforePlan=await repository.getPlan(link.tripId,editor);
  await database.prepare('UPDATE trip_links SET expires=? WHERE token_hash=?').bind(new Date(Date.now()-1000).toISOString(),hash).run();
  await assert.rejects(()=>repository.saveWorkspace('invite-account',{...root,plan:{...root.plan,name:'Expired link changed this'}},root.version,undefined,link),conflict);
  await assert.rejects(()=>repository.updatePreferences(link.tripId,editor,{...beforePreference.preferences,budget:1},beforePreference.version,{workspaceVersion:root.version,link}),conflict);
  const after=await repository.loadWorkspace('invite-account');
  assert.equal(after.version,root.version);
  assert.equal(after.plan.name,root.plan.name);
  assert.deepEqual(await repository.getPreferences(link.tripId,editor),beforePreference);
  assert.equal((await repository.getPlan(link.tripId,editor)).version,beforePlan.version);
  assert.equal((await database.prepare('SELECT count(*) AS count FROM backend_write_guards').first()).count,0);
 }finally{database.close();}
});

await check('Legacy links still work, while revocation preserves historical membership and preferences',async()=>{
 const {database,repository,root,link}=await sharedPlan();
 try{
  await database.prepare('UPDATE trip_links SET expires=NULL WHERE token_hash=?').bind(hash).run();
  const saved=await repository.saveWorkspace('invite-account',{...root,plan:{...root.plan,name:'Legacy link still valid'}},root.version,undefined,link);
  assert.equal(saved.plan.name,'Legacy link still valid');
  const prefs=await repository.getPreferences(link.tripId,editor);
  await database.prepare('DELETE FROM trip_links WHERE token_hash=?').bind(hash).run();
  await assert.rejects(()=>repository.saveWorkspace('invite-account',{...saved,plan:{...saved.plan,name:'Revoked link changed this'}},saved.version,undefined,link),conflict);
  assert.equal((await repository.getPlan(link.tripId,editor)).role,'editor','Revocation removes the invitation, preserving account membership.');
  assert.deepEqual(await repository.getPreferences(link.tripId,editor),prefs);
  assert.equal((await repository.loadWorkspace('invite-account')).plan.name,'Legacy link still valid');
 }finally{database.close();}
});

await check('Malformed expiry and changed link roles fail the same transaction guard',async()=>{
 const {database,repository,root,link}=await sharedPlan();
 try{
  await database.prepare('UPDATE trip_links SET expires=? WHERE token_hash=?').bind('invalid-date',hash).run();
  await assert.rejects(()=>repository.saveWorkspace('invite-account',root,root.version,undefined,link),conflict);
  await database.prepare('UPDATE trip_links SET expires=NULL,role=? WHERE token_hash=?').bind('viewer',hash).run();
  await assert.rejects(()=>repository.saveWorkspace('invite-account',root,root.version,undefined,link),conflict);
  assert.equal((await repository.loadWorkspace('invite-account')).version,root.version);
 }finally{database.close();}
});
console.log(`${checks} invitation migration and transactional access checks passed.`);
