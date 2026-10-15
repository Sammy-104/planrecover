import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
export function onlineConfig(base,accountId){
 if(!/^[a-f0-9]{32}$/.test(accountId??''))throw Error('Provide the selected Cloudflare account ID (32 lowercase hexadecimal characters). No credentials are accepted.');
 if(base.main!=='worker.mjs'||base.name!=='planrecover-paypal-webhook-relay'||!base.ratelimits?.some(binding=>binding.name==='RATE_LIMITER'))throw Error('The expected relay configuration and rate limiter are required.');
 return {...base,account_id:accountId,workers_dev:true,vars:{RELAY_ENABLED:'true'}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const root=new URL('../',import.meta.url),config=onlineConfig(JSON.parse(await readFile(new URL('wrangler.json',root),'utf8')),process.argv[2]);await writeFile(new URL('wrangler.online.json',root),JSON.stringify(config,null,2)+'\n',{flag:'wx'});console.log('Prepared '+fileURLToPath(new URL('wrangler.online.json',root))+'. No deployment or credential changes were performed.');}
 catch(error){console.error(error.code==='EEXIST'?'An online configuration already exists. Review it before replacing it.':error.message);process.exitCode=1;}
}
