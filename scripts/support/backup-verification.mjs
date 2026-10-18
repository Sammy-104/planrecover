import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {resolve,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot=fileURLToPath(new URL('../../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const normalizedSql=value=>(value??'').split(/('(?:''|[^'])*')/).map((part,index)=>index%2?part:part.replace(/[\s`"\[\]]/g,'').toLowerCase()).join('');
const stable=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,JSON.parse(stable(item))])):Array.isArray(value)?value.map(item=>JSON.parse(stable(item))):value??null);
const scoped=(owner,planId,id)=>JSON.stringify([owner,planId,id]);
const objectKey=/^[a-f0-9]{64}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const maxReceiptBytes=8*1024*1024;
function financialFacts(event){return {id:event.id,itemId:event.itemId,kind:event.kind,amount:event.amount,shares:event.shares,contributions:event.contributions,
 mode:event.mode,providerId:event.providerId??null,from:event.from??null,to:event.to??null};}
function mimeOf(bytes){
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
 if(bytes.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
 return null;
}

/** Read an explicitly supplied standalone SQLite export and object-byte mirror.
 * All schema construction occurs in a separate in-memory database. */
export function verifyBackup({databasePath,objectsDirectory,manifestPath,requireManifest=false,migrationsDirectory=resolve(repositoryRoot,'drizzle')}){
 const findings=new Map(),add=(code,message,example,severity='error')=>{let issue=findings.get(code);if(!issue){issue={code,severity,message,count:0,examples:[]};findings.set(code,issue);}issue.count++;if(example!==undefined&&issue.examples.length<12)issue.examples.push(example);};
 const report={format:'planrecover-backup-verification',version:1,scope:'offline-export-only',verifiedAt:new Date().toISOString(),ok:false,
  inputs:{database:resolve(databasePath),objectsDirectory:resolve(objectsDirectory),manifest:manifestPath?resolve(manifestPath):null,readOnly:true},schema:{},financial:{},objects:{hashBaselineProvided:!!manifestPath,inventory:[]},findings:[],summary:{errors:0,warnings:0}};
 let database,expected;
 const parse=(text,context)=>{try{return JSON.parse(text);}catch{add('INVALID_JSON','Stored JSON cannot be decoded.',context);return null;}};
 try{
  const source=report.inputs.database,objectRoot=report.inputs.objectsDirectory;
  if(!existsSync(source)||!lstatSync(source).isFile()||lstatSync(source).isSymbolicLink())throw Error('The database must be an existing regular exported SQLite file, not a symbolic link.');
  if(!existsSync(objectRoot)||!lstatSync(objectRoot).isDirectory())throw Error('The receipt object mirror must be an existing directory.');
  const sidecars=['-wal','-shm','-journal'].filter(suffix=>existsSync(source+suffix));
  if(sidecars.length){add('SQLITE_SIDECARS','Provide a consistent standalone SQLite export without WAL, shared-memory or journal sidecars. The supplied database was not opened.',sidecars);return finish();}
  const sourceBytes=readFileSync(source);report.inputs.databaseBytes=sourceBytes.length;report.inputs.databaseSha256=hash(sourceBytes);
  if(sourceBytes.subarray(0,16).toString()!=='SQLite format 3\u0000')throw Error('The provided file does not have a SQLite database header. Export the database as SQLite, not SQL text.');
  let manifest=null,manifestEntries=new Map();
  if(manifestPath){
   manifest=parse(readFileSync(report.inputs.manifest,'utf8'),'object manifest');
   if(!manifest||manifest.version!==1||!Array.isArray(manifest.objects))add('INVALID_MANIFEST','Use a version 1 object manifest with an objects array.');
   else for(const entry of manifest.objects){
    if(!entry||typeof entry.key!=='string'||!objectKey.test(entry.key)||!Number.isSafeInteger(entry.size)||entry.size<1||entry.size>maxReceiptBytes||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(entry.sha256)||entry.contentType!==undefined&&!['image/png','image/jpeg','image/webp','application/pdf'].includes(entry.contentType)){add('INVALID_MANIFEST_ENTRY','Manifest entries require a valid object key, byte size and SHA-256 digest.',entry?.key);continue;}
    if(manifestEntries.has(entry.key)){add('DUPLICATE_MANIFEST_KEY','The expected manifest repeats an object key.',entry.key);continue;}manifestEntries.set(entry.key,entry);
   }
   if(manifest?.databaseSha256!==undefined){if(typeof manifest.databaseSha256!=='string'||!/^[a-f0-9]{64}$/i.test(manifest.databaseSha256))add('INVALID_MANIFEST','The optional databaseSha256 must be a SHA-256 digest.');else if(manifest.databaseSha256.toLowerCase()!==report.inputs.databaseSha256)add('DATABASE_HASH_MISMATCH','The database bytes differ from the independent manifest digest.');}
  }else add(requireManifest?'MANIFEST_REQUIRED':'NO_INDEPENDENT_OBJECT_HASHES','No independent object manifest was supplied. Size and MIME checks cannot detect every same-size content substitution.',undefined,requireManifest?'error':'warning');
  expected=new DatabaseSync(':memory:');
  const migrationNames=readdirSync(migrationsDirectory).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort();
  for(const name of migrationNames)expected.exec(readFileSync(resolve(migrationsDirectory,name),'utf8'));
  const migrationJournal=parse(readFileSync(resolve(migrationsDirectory,'meta/_journal.json'),'utf8'),'migration journal');
  if(stable((migrationJournal?.entries??[]).map(entry=>entry.tag+'.sql'))!==stable(migrationNames))add('MIGRATION_SOURCE_MISMATCH','The local migration journal and SQL files do not describe the same chain.');
  database=new DatabaseSync(source,{readOnly:true,allowExtension:false,enableForeignKeyConstraints:true,timeout:1000});
  database.exec('PRAGMA query_only=ON');database.exec('PRAGMA trusted_schema=OFF');
  const integrity=database.prepare('PRAGMA integrity_check').all();report.schema.integrity=integrity.map(row=>Object.values(row)[0]);
  if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')add('SQLITE_INTEGRITY','SQLite integrity verification failed.',report.schema.integrity);
  const foreignKeys=database.prepare('PRAGMA foreign_key_check').all();report.schema.foreignKeyViolations=foreignKeys.length;if(foreignKeys.length)add('FOREIGN_KEY_VIOLATIONS','The export contains broken foreign-key references.',foreignKeys.slice(0,12));
  const expectedSchema=expected.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(),actualSchema=database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(),actualByName=new Map(actualSchema.map(row=>[row.name,row]));
  const expectedTables=expectedSchema.filter(row=>row.type==='table'),actualTables=actualSchema.filter(row=>row.type==='table');
  report.schema={...report.schema,migrationCount:migrationNames.length,latestMigration:migrationNames.at(-1),expectedTables:expectedTables.length,actualTables:actualTables.length,tableCounts:{}};
  const tables=new Set();
  for(const entry of expectedSchema){const actual=actualByName.get(entry.name);if(!actual||actual.type!==entry.type){add('MISSING_SCHEMA_OBJECT','An application table, index or protective trigger is missing.',{type:entry.type,name:entry.name});continue;}
   if(normalizedSql(entry.sql)!==normalizedSql(actual.sql))add('SCHEMA_DEFINITION_MISMATCH','A schema definition differs from the complete application migration chain.',{type:entry.type,name:entry.name});
   if(entry.type==='table'){
    const wanted=expected.prepare(`PRAGMA table_info(${quote(entry.name)})`).all(),got=database.prepare(`PRAGMA table_info(${quote(entry.name)})`).all();
    if(stable(wanted)!==stable(got)){add('TABLE_COLUMN_MISMATCH','An application table has missing or changed columns.',entry.name);continue;}tables.add(entry.name);
    report.schema.tableCounts[entry.name]=database.prepare(`SELECT COUNT(*) AS n FROM ${quote(entry.name)}`).get().n;
   }
  }
  for(const entry of actualTables)if(!expectedTables.some(table=>table.name===entry.name))add('ADDITIONAL_TABLE','An extra table is present; it is outside application invariant checks.',entry.name,'warning');
  if(!actualByName.has('d1_migrations')&&!actualByName.has('__drizzle_migrations'))add('NO_MIGRATION_LEDGER','No provider migration ledger is present. Completeness is established structurally against the bundled migrations, not by deployment provenance.',undefined,'warning');
  const rows=table=>tables.has(table)?database.prepare(`SELECT * FROM ${quote(table)}`).all():[];
  const plans=rows('plans'),events=rows('financial_events'),history=rows('financial_event_history'),eventByScope=new Map(),historyByScope=new Map(),providerEffects=new Map();
  const decodedPlans=new Map();
  for(const row of plans){const state=parse(row.body,{table:'plans',planId:row.id});if(!state)continue;decodedPlans.set(scoped(row.owner,row.id,''),state);if(state.plan?.id!==row.id)add('PLAN_IDENTITY_MISMATCH','A saved plan body has a different plan identity.',row.id);}
  for(const row of history){const key=scoped(row.owner,row.plan_id,row.event_id);if(!historyByScope.has(key))historyByScope.set(key,[]);historyByScope.get(key).push(row);}
  for(const row of events){const context={planId:row.plan_id,eventId:row.event_id},facts=parse(row.facts,context),body=parse(row.body,context);if(!facts||!body)continue;
   const key=scoped(row.owner,row.plan_id,row.event_id);eventByScope.set(key,{row,facts});
   if(stable(facts)!==stable(financialFacts(body))||body.id!==row.event_id||body.kind!==row.kind)add('FINANCIAL_FACT_MISMATCH','Immutable event facts differ from their original evidence body or identity.',context);
   if(!['expense','refund','adjustment','settlement'].includes(facts.kind)||!['fixture','simulation','manual','sandbox'].includes(facts.mode)||!['pending','reported','confirmed'].includes(body.status)||facts.kind==='expense'&&facts.amount<0||facts.kind==='refund'&&facts.amount>=0)add('INVALID_FINANCIAL_EVENT','A financial event has an unsupported kind, source, status or amount sign.',context);
   if(!Number.isSafeInteger(facts.amount)||!facts.shares||!facts.contributions||Object.values(facts.shares).some(n=>!Number.isSafeInteger(n))||Object.values(facts.contributions).some(n=>!Number.isSafeInteger(n)))add('INVALID_FINANCIAL_UNITS','Financial values must be exact integer minor units.',context);
   else if(facts.kind!=='settlement'&&(Object.values(facts.shares).reduce((a,b)=>a+b,0)!==facts.amount||Object.values(facts.contributions).reduce((a,b)=>a+b,0)!==facts.amount))add('FINANCIAL_ALLOCATION_MISMATCH','Event cost shares and cash contributions do not reconcile to its amount.',context);
   const plan=decodedPlans.get(scoped(row.owner,row.plan_id,''));if(!plan)add('FINANCIAL_PLAN_MISSING','Retained financial evidence has no saved owning plan.',context);else if(row.currency!==(plan.plan?.currency??'CAD'))add('FINANCIAL_CURRENCY_MISMATCH','An immutable event has a different currency from its owning plan.',context);
   if(facts.mode==='sandbox'&&facts.providerId){if(row.provider!=='paypal-sandbox'||row.provider_id!==facts.providerId||row.currency!=='CAD')add('PROVIDER_IDENTITY_MISMATCH','A sandbox event has inconsistent canonical provider identity or currency.',context);}
   else if(facts.mode==='sandbox')add('PROVIDER_IDENTITY_MISMATCH','A sandbox financial event has no canonical provider identity.',context);
   else if(row.provider!==null||row.provider_id!==null)add('PROVIDER_IDENTITY_MISMATCH','A non-provider event claims a canonical provider identity.',context);
   if(row.provider&&row.provider_id){const providerKey=scoped(row.provider,row.provider_id,row.kind);if(providerEffects.has(providerKey))add('DUPLICATE_PROVIDER_EFFECT','One canonical provider effect was credited more than once.',{providerId:row.provider_id,kind:row.kind});providerEffects.set(providerKey,{row,facts});}
   const transitions=historyByScope.get(key)??[];if(!transitions.length)add('FINANCIAL_HISTORY_MISSING','An immutable event is missing retained status/evidence history.',context);
   for(const transition of transitions){const prior=parse(transition.body,{...context,historyId:transition.id});if(prior&&(hash(transition.body)!==transition.fingerprint||stable(financialFacts(prior))!==stable(facts)||prior.status!==transition.status))add('FINANCIAL_HISTORY_MISMATCH','A retained transition has changed facts, status or content fingerprint.',{...context,historyId:transition.id});}
  }
  for(const row of history)if(!eventByScope.has(scoped(row.owner,row.plan_id,row.event_id)))add('ORPHAN_FINANCIAL_HISTORY','A retained financial transition has no immutable base event.',row.event_id);
  for(const row of plans){const state=decodedPlans.get(scoped(row.owner,row.id,''));for(const event of state?.events??[]){const existing=eventByScope.get(scoped(row.owner,row.id,event.id));if(!existing||stable(existing.facts)!==stable(financialFacts(event)))add('PLAN_FINANCIAL_PROJECTION_MISMATCH','A plan projection contains financial facts that do not match retained history.',{planId:row.id,eventId:event.id});else if(!(historyByScope.get(scoped(row.owner,row.id,event.id))??[]).some(h=>h.status===event.status))add('PLAN_FINANCIAL_STATUS_MISMATCH','A projected event status has no retained transition.',{planId:row.id,eventId:event.id});}}
  const revisions=rows('approval_revisions'),members=rows('approval_members'),revisionByScope=new Map(revisions.map(row=>[scoped(row.owner,row.plan_id,`${row.item_id}:${row.revision}`),row]));
  for(const row of members)if(!revisionByScope.has(scoped(row.owner,row.plan_id,`${row.item_id}:${row.revision}`)))add('APPROVAL_SNAPSHOT_MISSING','A retained member approval has no immutable exact revision snapshot.',{planId:row.plan_id,itemId:row.item_id,revision:row.revision});
  for(const row of plans){const state=decodedPlans.get(scoped(row.owner,row.id,''));for(const item of state?.items??[]){if(!item.approvals?.length||item.price===null)continue;const revision=revisionByScope.get(scoped(row.owner,row.id,`${item.id}:${item.revision}`)),snapshot=revision?parse(revision.snapshot,{itemId:item.id,revision:item.revision}):null;
   if(!snapshot||snapshot.id!==item.id||snapshot.revision!==item.revision||snapshot.price!==item.price||stable(snapshot.shares)!==stable(item.shares)||stable([...(snapshot.participants??[])].sort())!==stable([...item.participants].sort())||snapshot.source!==item.source)add('PLAN_APPROVAL_TERMS_MISMATCH','Current approved item terms differ from their preserved exact revision.',{planId:row.id,itemId:item.id});
   for(const memberId of item.approvals)if(!members.some(a=>a.owner===row.owner&&a.plan_id===row.id&&a.item_id===item.id&&a.revision===item.revision&&a.member_id===memberId))add('PLAN_APPROVAL_HISTORY_MISSING','A projected approval has no retained member approval record.',{planId:row.id,itemId:item.id,memberId});
  }}
  for(const intent of rows('provider_request_intents')){const body=parse(intent.request_body,{operationId:intent.operation_id}),fingerprint=hash(JSON.stringify({path:intent.path,body,requestKey:intent.request_key}));if(body===null||fingerprint!==intent.fingerprint||intent.method!=='POST')add('PROVIDER_INTENT_MISMATCH','An immutable provider request body/key no longer matches its saved fingerprint.',intent.operation_id);}
  const operations=rows('provider_operations');let unresolved=0;
  for(const row of operations){if(!['captured','refunded','cancelled','failed','completed'].includes(row.status))unresolved++;
   if(!['captured','refunded'].includes(row.status))continue;const payload=parse(row.payload??'{}',{table:'provider_operations',operationId:row.id});if(!payload)continue;
   const providerId=row.kind==='order'?payload.purchase_units?.[0]?.payments?.captures?.[0]?.id:row.kind==='refund'?payload.id:null,kind=row.kind==='order'?'expense':'refund';
   if(!providerId){add('PROVIDER_CANONICAL_EVIDENCE_MISSING','A settled provider operation has no canonical capture/refund identity in its saved response.',row.id);continue;}
   const unit=payload.purchase_units?.[0],amount=row.kind==='order'?unit?.payments?.captures?.[0]?.amount:payload.amount;
   if(payload.id!==row.provider_id||!Number.isSafeInteger(row.amount)||row.amount<=0||amount?.currency_code!=='CAD'||typeof amount?.value!=='string'||!/^\d+\.\d{2}$/.test(amount.value)||Number(amount.value.replace('.',''))!==row.amount||row.kind==='order'&&(payload.purchase_units.length!==1||unit.reference_id!==row.item_id||(unit.custom_id??unit.payments.captures[0].custom_id)!==row.id))add('PROVIDER_CANONICAL_SCOPE_MISMATCH','Saved canonical provider response differs from the original order/refund identity, item or exact CAD amount.',row.id);
   const effect=providerEffects.get(scoped('paypal-sandbox',providerId,kind));if(!effect||effect.row.owner!==row.owner||effect.row.plan_id!==payload.planrecoverTripId||effect.facts.itemId!==row.item_id||effect.facts.amount!==(kind==='refund'?-row.amount:row.amount))add('PROVIDER_LEDGER_MISMATCH','A settled provider operation does not match exactly one retained financial effect in the original plan.',row.id);
  }
  if(unresolved)add('UNRESOLVED_PROVIDER_OPERATIONS','The snapshot contains pending or uncertain provider operations; reconcile canonical IDs in an isolated authorized environment after restore.',unresolved,'warning');
  const invoices=rows('plan_invoices'),payments=rows('plan_invoice_payments'),refunds=rows('invoice_refunds'),requests=rows('invoice_refund_requests'),allocations=rows('invoice_refund_allocations');
  for(const invoice of invoices){const paid=payments.filter(row=>row.invoice_id===invoice.id).reduce((sum,row)=>sum+row.amount,0),refunded=refunds.filter(row=>row.invoice_id===invoice.id).reduce((sum,row)=>sum+row.amount,0);if(paid!==invoice.paid||paid>invoice.amount||refunded>paid)add('INVOICE_BALANCE_MISMATCH','Gross invoice payments, refunds and stored collection totals do not reconcile.',invoice.id);}
  for(const [collection,kind,prefix]of [[payments,'expense','invoice-payment-'],[refunds,'refund','invoice-refund-']])for(const row of collection){const id=kind==='refund'?row.refund_id:row.id,event=eventByScope.get(scoped(row.owner,row.plan_id,prefix+id)),invoice=invoices.find(i=>i.id===row.invoice_id);if(!invoice||invoice.owner!==row.owner||invoice.plan_id!==row.plan_id||!event||event.facts.itemId!==invoice.item_id||event.facts.amount!==(kind==='refund'?-row.amount:row.amount)||event.facts.providerId!==id)add('INVOICE_LEDGER_MISMATCH','A canonical invoice transaction has no matching retained financial event in its original invoice/plan.',id);}
  for(const refund of refunds)if(allocations.filter(a=>a.refund_id===refund.refund_id).reduce((sum,a)=>sum+a.amount,0)>refund.amount)add('REFUND_EVIDENCE_OVERALLOCATED','Refund evidence was assigned beyond the canonical amount.',refund.refund_id);
  for(const request of requests){const used=allocations.filter(a=>a.request_id===request.id).reduce((sum,a)=>sum+a.amount,0);if(used>request.amount||request.status==='completed'&&used!==request.amount)add('REFUND_REQUEST_PROOF_MISMATCH','A completed refund intent lacks full distinct evidence, or its allocation exceeds its approved amount.',request.id);}
  for(const allocation of allocations){const request=requests.find(q=>q.id===allocation.request_id),refund=refunds.find(r=>r.refund_id===allocation.refund_id),terms=request?parse(request.terms,{refundRequest:request.id}):null;if(!request||!refund||request.invoice_id!==refund.invoice_id||request.owner!==refund.owner||request.plan_id!==refund.plan_id||!request.approved_owner||!request.approved_member||terms?.previousRefunds?.includes(refund.refund_id)||!Number.isSafeInteger(allocation.amount)||allocation.amount<=0)add('INVALID_REFUND_EVIDENCE_ALLOCATION','A finite refund allocation is outside its approved scope or reuses prior evidence.',allocation.request_id);}
  const capacities=rows('capture_refund_capacity'),claims=rows('capture_refund_claims');for(const capacity of capacities){const reserved=claims.filter(c=>c.capture_id===capacity.capture_id&&c.status==='reserved').reduce((n,c)=>n+c.amount,0),refunded=claims.filter(c=>c.capture_id===capacity.capture_id&&c.status==='confirmed').reduce((n,c)=>n+c.amount,0);if(capacity.reserved!==reserved||capacity.refunded!==refunded||reserved+refunded>capacity.captured)add('CAPTURE_REFUND_CAPACITY_MISMATCH','Capture refund claims do not reconcile to preserved capacity.',capacity.capture_id);}
  report.financial={immutableEvents:events.length,statusTransitions:history.length,approvalRevisions:revisions.length,memberApprovals:members.length,providerEffects:providerEffects.size,providerOperations:operations.length,unresolvedProviderOperations:unresolved,invoices:invoices.length,invoicePayments:payments.length,invoiceRefunds:refunds.length,refundEvidenceAllocations:allocations.length};
  const managed=rows('receipt_objects'),drafts=rows('receipt_drafts'),objects=new Map(),managedByKey=new Map(managed.map(row=>[row.file_key,row]));
  function reference(key,owner,planId,source,required=true,size,mime){if(typeof key!=='string'||!objectKey.test(key)||!key.startsWith(hash(owner)+'/')){add('INVALID_RECEIPT_OBJECT_IDENTITY','A receipt source key does not match its owning workspace.',{key,source});return;}let entry=objects.get(key);if(!entry){entry={key,owner,planId,required:false,sizes:new Set(),mimes:new Set(),references:[]};objects.set(key,entry);}if(entry.owner!==owner||entry.planId!==planId)add('RECEIPT_OBJECT_SCOPE_MISMATCH','One object is associated with different plan identities.',key);entry.required ||=required;if(size!==undefined)entry.sizes.add(size);if(mime)entry.mimes.add(mime);entry.references.push(source);}
  for(const row of managed){reference(row.file_key,row.owner,row.plan_id,'receipt_objects',row.status==='ready');if(!['ready','deleted','staged','deleting'].includes(row.status))add('INVALID_RECEIPT_OBJECT_STATE','A receipt lifecycle row contains an unsupported state.',row.file_key);else if(!['ready','deleted'].includes(row.status))add('UNRESOLVED_RECEIPT_OBJECT','A staged/deleting source requires explicit storage-state review after restore.',{key:row.file_key,status:row.status},'warning');}
  for(const row of drafts){const object=managedByKey.get(row.file_key);reference(row.file_key,row.owner,row.plan_id,'receipt_drafts',row.status==='reviewed'||object?.status!=='deleted',row.size,row.mime);}
  for(const row of plans){const state=decodedPlans.get(scoped(row.owner,row.id,''));for(const receipt of state?.receipts??[])if(receipt.fileKey)reference(receipt.fileKey,row.owner,row.id,'plans.receipts');}
  const rootReal=realpathSync(objectRoot),expectedKeys=new Set([...objects.keys(),...manifestEntries.keys()]);let visited=0;const seenFiles=new Set();
  function inventory(directory,prefix=''){
   for(const name of readdirSync(directory)){if(++visited>100000){add('OBJECT_INVENTORY_LIMIT','The mirror exceeds 100000 filesystem entries; partition an export before verification.');return;}const filename=resolve(directory,name),key=prefix+name,stat=lstatSync(filename);if(stat.isSymbolicLink()){add('OBJECT_SYMLINK','Receipt byte mirrors must contain regular files and directories, not links or junctions.',key);continue;}if(stat.isDirectory())inventory(filename,key+'/');else if(stat.isFile()){seenFiles.add(key);if(!expectedKeys.has(key))add('UNREFERENCED_OBJECT_FILE','A byte file has no database reference or expected manifest entry; review it before restoring.',key,'warning');}else add('OBJECT_NOT_REGULAR','An object mirror entry is not a regular byte file.',key);}
  }
  inventory(rootReal);
  for(const key of expectedKeys){const entry=objects.get(key),manifestEntry=manifestEntries.get(key),managedObject=managedByKey.get(key),filename=resolve(rootReal,...key.split('/')),rel=relative(rootReal,filename);
   if(rel.startsWith('..'+sep)||rel==='..'||isAbsolute(rel)){add('OBJECT_PATH_ESCAPE','A source key resolves outside the explicit object mirror.',key);continue;}
   if(!existsSync(filename)){if(entry?.required||manifestEntry)add('MISSING_RECEIPT_OBJECT','A required receipt source or expected inventory object is missing.',key);continue;}
   if(managedObject?.status==='deleted'){add('RETIRED_RECEIPT_OBJECT_PRESENT','Deleted object bytes are present; restoring them could revive intentionally retired source access.',key);continue;}
   if(entry?.required&&managedObject&&managedObject.status!=='ready')add('RECEIPT_OBJECT_STATE_MISMATCH','A retained receipt reference points to a non-ready managed object.',key);
   let pathSafe=true,cursor=rootReal;for(const segment of key.split('/')){cursor=resolve(cursor,segment);if(lstatSync(cursor).isSymbolicLink()){pathSafe=false;break;}}if(!pathSafe){add('OBJECT_SYMLINK','A required source resolves through a link or junction.',key);continue;}
   const stat=lstatSync(filename);if(!stat.isFile()||stat.size<1||stat.size>maxReceiptBytes){add('INVALID_RECEIPT_OBJECT_SIZE','Receipt objects must be regular nonempty files under 8 MiB.',key);continue;}
   const bytes=readFileSync(filename),digest=hash(bytes),mime=mimeOf(bytes);report.objects.inventory.push({key,size:bytes.length,sha256:digest,detectedContentType:mime,required:entry?.required??false});
   if(entry&&[...entry.sizes].some(size=>size!==bytes.length)||manifestEntry&&manifestEntry.size!==bytes.length)add('RECEIPT_SIZE_MISMATCH','Restored bytes differ from the saved draft or independent inventory size.',key);
   if(!mime||entry&&[...entry.mimes].some(value=>value!==mime)||manifestEntry?.contentType&&manifestEntry.contentType!==mime)add('RECEIPT_MIME_MISMATCH','Receipt file signatures differ from their saved media type.',key);
   if(manifestEntry&&manifestEntry.sha256.toLowerCase()!==digest)add('RECEIPT_HASH_MISMATCH','Restored receipt content differs from the independent SHA-256 inventory.',key);
   if(manifestPath&&entry?.required&&!manifestEntry)add('MANIFEST_COVERAGE_MISSING','A required receipt source is absent from the independent inventory.',key);
   if(entry&&!managedObject)add('UNMANAGED_RECEIPT_SOURCE','A retained legacy receipt source has no lifecycle row; its bytes were checked but lifecycle provenance needs review.',key,'warning');
  }
  report.objects={...report.objects,databaseReferences:objects.size,required:[...objects.values()].filter(entry=>entry.required).length,manifestEntries:manifestEntries.size,byteFiles:seenFiles.size,checked:report.objects.inventory.length};
  if(hash(readFileSync(source))!==report.inputs.databaseSha256)add('DATABASE_CHANGED_DURING_VERIFICATION','The exported database changed during verification. Repeat against an isolated consistent snapshot.');
 }catch(error){add('VERIFICATION_ERROR',error instanceof Error?error.message:'Verification could not finish.');}
 finally{database?.close();expected?.close();}
 return finish();
 function finish(){report.findings=[...findings.values()].sort((a,b)=>a.code.localeCompare(b.code));report.summary={errors:report.findings.filter(row=>row.severity==='error').reduce((n,row)=>n+row.count,0),warnings:report.findings.filter(row=>row.severity==='warning').reduce((n,row)=>n+row.count,0)};report.ok=report.summary.errors===0;return report;}
}
