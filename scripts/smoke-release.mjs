import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import net from 'node:net';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qijian-smoke-')),socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),STAY_DB_PATH:path.join(temp,'stay.sqlite'),DASHSCOPE_API_KEY:'',FLYAI_API_KEY:''},stdio:['ignore','ignore','ignore']});const base='http://127.0.0.1:'+port;
try{
 let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('Server stopped');try{ready=(await fetch(base+'/api/health')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'Startup timed out');
 const response=await fetch(base+'/api/boot'),cookie=response.headers.get('set-cookie').split(';')[0],boot=await response.json();assert.equal(boot.hotel.id,'lohkah-xiamen');assert.ok(boot.places.some(p=>p.id==='oli-fish'));
 const headers={'Content-Type':'application/json',Cookie:cookie};
 const planResponse=await fetch(base+'/api/plan/rules',{method:'POST',headers,body:JSON.stringify({date:boot.clock.date,start:'14:00',minutes:120,selected:['garden','tea']})});assert.ok(planResponse.ok);const plan=await planResponse.json();assert.equal(plan.hotelId,boot.hotel.id);assert.ok(plan.items.length>0);assert.equal(plan.engine,'rules');
 const saved=await fetch(base+'/api/boot',{headers:{Cookie:cookie}}).then(r=>r.json());assert.deepEqual(saved.state.plan,plan);
 const other=await fetch(base+'/api/boot?hotel=andaz-xiamen',{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(other.state.plan||null,null);assert.ok(other.places.some(p=>p.id==='andaz-spa'&&p.mapAvailable===false));
 assert.ok((await fetch(base+'/tryout.html')).ok);assert.equal((await fetch(base+'/.env.local')).status,404);
 console.log('PASS: clean database startup, source packs, rules-only plan/save, hotel isolation, trial page and credential-file denial');
 console.log('No external model or FlyAI success is claimed by this smoke check.');
}finally{child.kill('SIGTERM');await new Promise(r=>{child.once('exit',r);setTimeout(r,1000);});if(child.exitCode===null)child.kill('SIGKILL');fs.rmSync(temp,{recursive:true,force:true});}
