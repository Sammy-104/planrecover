import {createClient,type Client,type InStatement,type InValue,type ResultSet} from '@libsql/client';

/** The native client and the local test client use the same transactional API. */
export type TursoD1Client=Pick<Client,'execute'|'batch'|'executeMultiple'>;
type Settings=Record<string,string|undefined>;
type Result<T>={success:true;results:T[];meta:{changes:number;last_row_id:number;changed_db:boolean;duration:number;rows_read:number;rows_written:number;size_after:number}};
const MAX_SAFE_BIGINT=BigInt(Number.MAX_SAFE_INTEGER),MIN_SAFE_BIGINT=BigInt(Number.MIN_SAFE_INTEGER);
// CASE is lazy in SQLite. Invalid JSON aborts the transaction before application
// statements when this exact connection does not enforce foreign keys.
const FOREIGN_KEYS_ASSERT="SELECT CASE WHEN (SELECT foreign_keys FROM pragma_foreign_keys)=1 THEN 1 ELSE json('PlanRecover requires foreign key enforcement') END AS enforced";

function safeNumber(value:number|bigint,label:string){
 if(typeof value==='bigint'){
  if(value>MAX_SAFE_BIGINT||value<MIN_SAFE_BIGINT)throw new RangeError(`${label} cannot be represented safely as a JavaScript number.`);
  return Number(value);
 }
 if(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value))throw new RangeError(`${label} cannot be represented safely as a JavaScript number.`);
 return value;
}

function boundValue(value:unknown):InValue{
 if(value===null||typeof value==='string')return value;
 if(typeof value==='number')return safeNumber(value,'Bound number');
 if(value instanceof ArrayBuffer)return value.slice(0);
 if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice();
 // D1 does not accept undefined, booleans, objects or bigint parameters.
 throw new TypeError('Unsupported D1 bound value. Use a string, finite safe number, null or binary value.');
}

function returnedValue(value:unknown):unknown{
 if(typeof value==='bigint'||typeof value==='number')return safeNumber(value,'Database number');
 // D1 exposes blobs as byte arrays, without Node Buffer or libSQL Row internals.
 if(value instanceof ArrayBuffer)return Array.from(new Uint8Array(value));
 if(ArrayBuffer.isView(value))return Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
 return value;
}

function resultRows<T>(result:ResultSet):T[]{
 return result.rows.map(row=>Object.fromEntries(result.columns.map((column,index)=>[column,returnedValue(row[index])])) as T);
}

function d1Result<T>(result:ResultSet,started:number,includeRows=true):Result<T>{
 const changes=safeNumber(result.rowsAffected??0,'Changed row count');
 const lastRowId=safeNumber(result.lastInsertRowid??0,'Inserted row identifier');
 // libSQL exposes affected/returned rows, not D1's scan counters or storage size.
 // Those compatibility fields are informational; only changes drives app write guards.
 return {success:true,results:includeRows?resultRows<T>(result):[],meta:{changes,last_row_id:lastRowId,changed_db:changes>0,
  duration:Math.max(0,performance.now()-started),rows_read:result.rows.length,rows_written:changes,size_after:0}};
}

/** Count script statements for exec metadata only; SQL is sent unchanged to libSQL. */
function statementCount(sql:string){
 let count=0,hasSql=false,quote='',lineComment=false,blockComment=false,word='',keywords:string[]=[],trigger=false,body=false,caseDepth=0,triggerEnded=false;
 const token=()=>{if(!word)return;const key=word.toUpperCase();keywords.push(key);if(keywords.length<=4&&keywords[0]==='CREATE'&&key==='TRIGGER')trigger=true;
  if(trigger){if(!body&&key==='BEGIN')body=true;else if(body&&key==='CASE')caseDepth++;else if(body&&key==='END'){if(caseDepth)caseDepth--;else triggerEnded=true;}}
  word='';};
 for(let index=0;index<sql.length;index++){
  const char=sql[index],next=sql[index+1];
  if(lineComment){if(char==='\n')lineComment=false;continue;}
  if(blockComment){if(char==='*'&&next==='/'){blockComment=false;index++;}continue;}
  if(quote){if(char===quote){if(next===quote&&quote!==']')index++;else quote='';}continue;}
  if(char==='-'&&next==='-'){token();lineComment=true;index++;continue;}
  if(char==='/'&&next==='*'){token();blockComment=true;index++;continue;}
  if(char==="'"||char==='"'||char==='`'||char==='['){token();quote=char==='['?']':char;hasSql=true;continue;}
  if(/[A-Za-z_]/.test(char)){word+=char;hasSql=true;continue;}
  token();
  if(char===';'&&(!trigger||!body||triggerEnded)){if(hasSql)count++;hasSql=false;keywords=[];trigger=false;body=false;caseDepth=0;triggerEnded=false;}
  else if(!/\s/.test(char)&&char!==';')hasSql=true;
 }
 token();return count+(hasSql?1:0);
}

class TursoStatement{
 constructor(readonly database:TursoDatabase,readonly sql:string,readonly values:InValue[]=[]){
  if(typeof sql!=='string'||!sql.trim())throw new TypeError('Provide a SQL statement.');
 }
 bind(...values:unknown[]){return new TursoStatement(this.database,this.sql,values.map(boundValue));}
 input():InStatement{return {sql:this.sql,args:this.values};}
 async first<T=Record<string,unknown>>(column?:string):Promise<T|null>{
  const result=await this.database.execute(this.input()),row=resultRows<Record<string,unknown>>(result)[0];
  if(!row)return null;
  if(column===undefined)return row as T;
  if(!Object.prototype.hasOwnProperty.call(row,column))throw new Error('D1 column not found.');
  return row[column] as T;
 }
 async all<T=Record<string,unknown>>(){const started=performance.now();return d1Result<T>(await this.database.execute(this.input()),started);}
 async run<T=Record<string,unknown>>(){const started=performance.now();return d1Result<T>(await this.database.execute(this.input()),started,false);}
 async raw<T=unknown[]>(options:{columnNames?:boolean}={}){
  const result=await this.database.execute(this.input());
  const rows=result.rows.map(row=>result.columns.map((_,index)=>returnedValue(row[index])) as T);
  return options.columnNames?[result.columns.slice(),...rows]:rows;
 }
}

class TursoDatabase{
 constructor(readonly client:TursoD1Client){}
 prepare(sql:string){return new TursoStatement(this,sql);}
 async checkedBatch(inputs:InStatement[],mode:'write'|'deferred'){
  try{
   const results=await this.client.batch([FOREIGN_KEYS_ASSERT,...inputs],mode);
   if(results.length!==inputs.length+1)throw new Error('Database returned an incomplete batch result.');
   return results.slice(1);
  }catch(error){
   if(error instanceof Error&&'statementIndex' in error&&error.statementIndex===0&&/malformed json|foreign_keys|pragma_foreign_keys/i.test(error.message)){
    throw Object.assign(new Error('Database foreign key enforcement is unavailable. Check the database connection configuration.',{cause:error}),{code:'D1_FOREIGN_KEYS_REQUIRED',status:503});
   }
   throw error;
  }
 }
 async execute(input:InStatement){return (await this.checkedBatch([input],'deferred'))[0];}
 async batch<T=Record<string,unknown>>(statements:D1PreparedStatement[]){
  // A foreign statement cannot silently run against another tenant/database.
  const inputs=statements.map(statement=>{
   if(!(statement instanceof TursoStatement)||statement.database!==this)throw new TypeError('Batch statements must belong to this database.');
   return statement.input();
  });
  if(!inputs.length)return [];
  const started=performance.now();
  // This is one libSQL transaction, not Promise.all or a sequence of execute calls.
  // Constraint/guard failure rejects with the original client error and rolls back all writes.
  const results=await this.checkedBatch(inputs,'write');
  return results.map(result=>d1Result<T>(result,started));
 }
 async exec(sql:string){
  if(typeof sql!=='string')throw new TypeError('Provide a SQL script.');
  const started=performance.now();await this.client.executeMultiple(sql);
  return {count:statementCount(sql),duration:Math.max(0,performance.now()-started)};
 }
}

/** Implements the D1 surface used by repositories and Drizzle; no auto-migrations. */
export function createTursoD1(client:TursoD1Client):D1Database{
 return new TursoDatabase(client) as unknown as D1Database;
}

/** Missing configuration fails closed through the existing unavailable-DB path. */
export function tursoDatabaseFromEnv(settings:Settings=process.env):D1Database|undefined{
 const url=settings.TURSO_DATABASE_URL,authToken=settings.TURSO_AUTH_TOKEN;
 if(!url&&!authToken)return undefined;
 if(typeof url!=='string'||typeof authToken!=='string'||!authToken||authToken.trim()!==authToken||/[\u0000-\u0020\u007f]/.test(authToken))throw new Error('Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in private server settings.');
 let parsed:URL;try{parsed=new URL(url);}catch{throw new Error('Configure a valid private Turso database URL.');}
 if(!['libsql:','https:'].includes(parsed.protocol)||!parsed.hostname||parsed.username||parsed.password||parsed.search||parsed.hash||url.trim()!==url)throw new Error('Use a TLS Turso database URL without embedded credentials or query parameters.');
 // The SDK rejects unsafe SQLite integers instead of silently rounding financial values.
 return createTursoD1(createClient({url,authToken,intMode:'number',concurrency:10}));
}
