#!/usr/bin/env node
import {verifyBackup} from './support/backup-verification.mjs';

const usage='node scripts/verify-backup.mjs --database <export.sqlite> --objects <receipt-byte-directory> [--manifest <inventory.json>] [--require-manifest]';
const args=process.argv.slice(2),options={};let invalid=false;
for(let index=0;index<args.length;index++){
 const name=args[index];if(name==='--require-manifest'){options.requireManifest=true;continue;}
 if(name==='--help'){process.stdout.write(usage+'\n');process.exit(0);}
 const field={'--database':'databasePath','--objects':'objectsDirectory','--manifest':'manifestPath'}[name];
 if(!field||options[field]!==undefined||!args[index+1]||args[index+1].startsWith('--')){invalid=true;break;}options[field]=args[++index];
}
if(invalid||!options.databasePath||!options.objectsDirectory){process.stdout.write(JSON.stringify({format:'planrecover-backup-verification',version:1,ok:false,error:'Explicit database and receipt object paths are required; options cannot repeat.',usage},null,2)+'\n');process.exitCode=2;}
else{const report=verifyBackup(options);process.stdout.write(JSON.stringify(report,null,2)+'\n');process.exitCode=report.ok?0:1;}
