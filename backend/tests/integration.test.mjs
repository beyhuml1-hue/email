import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(),'tidalmail-'));
const cwd=process.cwd();
const pw='this-is-a-long-example-secret';
const recipients=['one@example.com','two@example.com'];
let app, mock;

function openPort(server) {
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
}
async function waitForApp(port) {
  for (let i=0;i<100;i++) {
    try {const r=await fetch(`http://127.0.0.1:${port}/healthz`); if (r.ok) return;}catch{}
    await new Promise(r=>setTimeout(r,60));
  }
  throw new Error('Server failed to start');
}
function runNode(args,env,input) {
  return new Promise((resolve,reject)=>{
    const c=spawn('node',args,{cwd,env,stdio:['pipe','pipe','pipe']});
    let err=''; c.stderr.on('data',b=>err+=b);
    c.stdin.end(input);
    c.on('exit',code=>code===0?resolve():reject(new Error(err)));
  });
}
let origin,sec;
async function request(path,options={}) {
  return fetch(origin+path,{...options,headers:{...(options.body ? {'content-type':'application/json'}:{}),...(options.headers||{})}});
}
async function authUser(email) {
  const result=await request('/api/login',{method:'POST',body:JSON.stringify({email,password:pw})});
  assert.equal(result.status,200);
  return result.headers.get('set-cookie').split(';')[0];
}

test('signed live receiving -> each private mailbox -> JSON APIs',async () => {
  const key = randomBytes(24),whsec='whsec_'+key.toString('base64');
  const mockPort=await openPort(mock=createServer((_req,res)=>{
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({id:'test-email-100', from:'Accounts <noreply@example.org>', subject:'Your verification code',text:'Your verification code is 123456',created_at:new Date().toISOString()}));
  }));
  const env={...process.env, DB_PATH:join(dir,'test.sqlite'), MAIL_DOMAIN:'example.com',NODE_ENV:'test',RESEND_API_KEY:'re_testing',RESEND_WEBHOOK_SECRET:whsec,TEST_RESEND_API_BASE:`http://127.0.0.1:${mockPort}`};
  try {
    for (const email of recipients) await runNode(['scripts/create-mailbox.mjs',email],env,pw+'\n');
    const port=39180+Math.floor(Math.random()*2000);
    origin=`http://127.0.0.1:${port}`;
    env.PORT=String(port); env.PUBLIC_ORIGIN=origin;
    app=spawn('node',['server.mjs'],{cwd,env,stdio:['ignore','pipe','pipe']});
    await waitForApp(port);
    const unauthorized=await request('/api/messages'); assert.equal(unauthorized.status,401);
    const unverified=await request('/webhooks/resend',{method:'POST',body:JSON.stringify({type:'email.received'})});assert.equal(unverified.status,401);
    const data={type:'email.received',data:{email_id:'test-email-100',to:recipients,from:'noreply@example.org',subject:'Your code'}};
    const raw=JSON.stringify(data),timestamp=String(Math.floor(Date.now()/1000)),id='event-1';
    const signature=createHmac('sha256',key).update(`${id}.${timestamp}.${raw}`).digest('base64');
    const headers={'content-type':'application/json','svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature};
    const incoming=await request('/webhooks/resend',{method:'POST',headers,body:raw});
    assert.equal(incoming.status,200,await incoming.text());
    // Resend may retry webhook messages: duplicates must not show in the inbox.
    const duplicate=await request('/webhooks/resend',{method:'POST',headers,body:raw}); assert.equal(duplicate.status,200);
    for (const email of recipients) {
      const cookie=await authUser(email);
      const inbox=await request('/api/messages',{headers:{cookie}});
      const {messages}=await inbox.json();
      assert.equal(messages.length,1);
      assert.equal(messages[0].subject,'Your verification code');
      const specific=await request(`/api/messages/${messages[0].id}`,{headers:{cookie}});
      assert.equal((await specific.json()).message.body,'Your verification code is 123456');
      const update=await request(`/api/messages/${messages[0].id}`,{method:'PATCH',headers:{cookie},body:JSON.stringify({is_starred:true})});
      assert.equal(update.status,200);
      const folder=await request('/api/messages?folder=starred',{headers:{cookie}});
      assert.equal((await folder.json()).messages.length,1);
    }
  } finally { app?.kill();await new Promise(r=>mock.close(r));rmSync(dir,{force:true,recursive:true}); }
});
