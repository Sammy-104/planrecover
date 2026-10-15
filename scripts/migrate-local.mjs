import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const builtConfig=resolve(root,'dist/server/wrangler.json');
if(!existsSync(builtConfig))throw new Error('Run pnpm build before applying local database migrations.');
const config=JSON.parse(readFileSync(builtConfig,'utf8'));
const databases=(config.d1_databases??[]).map(database=>({...database,migrations_dir:resolve(root,'drizzle')}));
const binding=JSON.parse(readFileSync(resolve(root,'.openai/hosting.json'),'utf8')).d1;
if(!binding||!databases.some(database=>database.binding===binding))throw new Error('The built app has no configured D1 binding.');
const localDirectory=resolve(root,'.sites-runtime');
mkdirSync(localDirectory,{recursive:true});
const localConfig=resolve(localDirectory,'wrangler.migrations.json');
writeFileSync(localConfig,JSON.stringify({name:'planrecover-local-migrations',compatibility_date:config.compatibility_date??'2026-05-15',d1_databases:databases},null,2));
// This command deliberately has no remote mode and uses the dev app's state.
const result=spawnSync(process.execPath,[
  '--import',pathToFileURL(resolve(root,'scripts/sites-env.mjs')).href,resolve(root,'node_modules/wrangler/bin/wrangler.js'),
  'd1','migrations','apply',binding,'--local','--config',localConfig,'--persist-to',resolve(root,'.wrangler/state'),
],{cwd:root,stdio:['ignore','inherit','inherit'],env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',CLOUDFLARE_CF_FETCH_ENABLED:'false'}});
if(result.error)throw result.error;
process.exitCode=result.status??1;
