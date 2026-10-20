import {copyFileSync,existsSync,readFileSync,unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
for(const name of ['.env','.env.local']){
 const path=new URL(`../${name}`,import.meta.url);if(existsSync(path))process.loadEnvFile(path);
}
const required=['TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','CLERK_SECRET_KEY','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','BLOB_READ_WRITE_TOKEN'];
if(process.env.VERCEL==='1'){
 const missing=required.filter(name=>!process.env[name]);
 if(missing.length)throw Error(`Configure private Vercel environment settings before deploying: ${missing.join(', ')}.`);
}
process.env.PLANRECOVER_HOSTING='vercel';
process.env.NEXT_PUBLIC_HOSTING_PLATFORM='vercel';
process.env.NEXT_PUBLIC_AUTH_PROVIDER='clerk';
const generated=new URL('../proxy.ts',import.meta.url),template=new URL('../platform/vercel/proxy.ts',import.meta.url);
if(existsSync(generated))throw Error('Root proxy.ts already exists. Review it before building for Vercel.');
const source=readFileSync(template,'utf8');
copyFileSync(template,generated);
try{
 for(const args of [[fileURLToPath(new URL('./prepare-booking-pdf.mjs',import.meta.url))],
  [fileURLToPath(new URL('../node_modules/next/dist/bin/next',import.meta.url)),'build','--webpack']]){
  const result=spawnSync(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0){process.exitCode=result.status??1;break;}
 }
 if(!process.exitCode){
  const manifest=new URL('../.next-vercel/server/app/page_client-reference-manifest.js',import.meta.url);
  if(!existsSync(manifest)||!readFileSync(manifest,'utf8').includes('identity-provider.tsx'))throw Error('Vercel build did not include the verified sign-in provider. Refusing to publish the default identity stub.');
 }
}finally{
 if(existsSync(generated)&&readFileSync(generated,'utf8')===source)unlinkSync(generated);
}
