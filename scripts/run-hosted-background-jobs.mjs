// Service credentials enter through hidden stdin only; never arguments, files or output.
const input=await new Promise((resolve,reject)=>{
 let value='',finished=false;const terminal=process.stdin.isTTY;
 const finish=error=>{if(finished)return;finished=true;process.stdin.removeListener('data',onData);process.stdin.removeListener('end',onEnd);
  if(terminal)process.stdin.setRawMode(false);process.stdin.pause();error?reject(error):resolve(value);};
 const onData=chunk=>{value+=chunk;if(value.includes('\u0003'))finish(Error('Cancelled.'));else if(value.length>16384)finish(Error('Input too large.'));else if(/[\r\n]/.test(value))finish();};
 const onEnd=()=>finish();if(terminal){process.stdin.setRawMode(true);process.stderr.write('Ready for hosted job credentials on hidden stdin.\n');}
 process.stdin.setEncoding('utf8');process.stdin.on('data',onData);process.stdin.once('end',onEnd);process.stdin.resume();
});
try{
 const config=JSON.parse(input),url=new URL(config.url);
 if(url.origin!=='https://planrecover-sandbox-oct12.solar-bee-7228.chatgpt.site'||url.username||url.password||typeof config.token!=='string'||config.token.length<16)
  throw Error('Use the configured private Site and supported service credential.');
 const response=await fetch(new URL('/api/jobs/scheduled',url.origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(55000),
  headers:{'content-type':'application/json','OAI-Sites-Authorization':`Bearer ${config.token}`,Authorization:`Bearer ${config.token}`},body:'{}'});
 if(!response.ok)throw Error(`Hosted background writer returned HTTP ${response.status}.`);
 const result=await response.json();
 console.log(JSON.stringify({processed:result.processed,statuses:result.results?.map(run=>run.status),
  notificationsDelivered:result.results?.reduce((sum,run)=>sum+(run.delivery?.delivered??0),0)}));
}catch(error){console.error(error.message?.startsWith('Hosted background writer')?error.message:'Hosted job verification could not complete. Credentials were not logged.');process.exitCode=1;}
