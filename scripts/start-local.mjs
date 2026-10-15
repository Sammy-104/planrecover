import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import './sites-env.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const config=resolve(root,'dist/server/wrangler.json');
if(!existsSync(config))throw Error('Build the app before starting the local preview.');
const secrets=resolve(root,'.dev.vars');
const cli=resolve(root,'node_modules/wrangler/bin/wrangler.js');
const child=spawn(process.execPath,['--import',pathToFileURL(resolve(root,'scripts/sites-env.mjs')).href,
  cli,'dev','--config',config,
  ...(existsSync(secrets)?['--env-file',secrets]:[]),
  '--local','--persist-to',resolve(root,'.wrangler/state'),
  '--ip','127.0.0.1','--inspector-port','0',...process.argv.slice(2)],{cwd:root,stdio:'inherit',env:process.env});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
