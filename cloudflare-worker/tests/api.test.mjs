import test from 'node:test';
import assert from 'node:assert/strict';
import {mailApi} from '../src/mail-api.js';
import {createDatabase} from './database-adapter.mjs';
test('admin provisioning, private inboxes, password changes and session revocation',async()=>{
  const DB=createDatabase(),env={DB,ADMIN_CODE:'private-test-admin',MAIL_DOMAIN:'example.com'};
  const call=(path,method='GET',data,cookie)=>mailApi(new Request('https://mail.example.com'+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined}),env);
  const savedCookie=response=>response.headers.get('set-cookie').split(';')[0];
  try{
    assert.equal((await call('/api/admin/mailboxes')).status,401);
    assert.equal((await call('/api/admin/login','POST',{code:'wrong'})).status,401);
    const adminLogin=await call('/api/admin/login','POST',{code:env.ADMIN_CODE});assert.equal(adminLogin.status,200);const adminCookie=savedCookie(adminLogin);
    assert.equal((await call('/api/admin/site','PATCH',{biome:'end'})).status,401);
    assert.equal((await call('/api/admin/site','PATCH',{biome:'end'},adminCookie)).status,200);
    assert.equal((await(await call('/api/site')).json()).biome,'end');
    assert.equal((await call('/api/admin/site','PATCH',{biome:'invalid'},adminCookie)).status,400);
    const created=await call('/api/admin/mailboxes','POST',{name:'player'},adminCookie);assert.equal(created.status,201);const mailbox=await created.json();assert.equal(mailbox.email,'player@example.com');assert.ok(mailbox.password.length>=24);
    assert.equal((await call('/api/admin/mailboxes','POST',{name:'player'},adminCookie)).status,409);
    const raw=await DB.prepare('SELECT * FROM mailboxes').first();assert.ok(!raw.password_hash.includes(mailbox.password));
    const login=await call('/api/login','POST',mailbox);assert.equal(login.status,200);let userCookie=savedCookie(login);
    assert.equal((await call('/api/admin/mailboxes','GET',undefined,userCookie)).status,401);
    await DB.prepare('INSERT INTO messages(mailbox_id,provider_id,sender,recipient,subject,body,arrived_at) VALUES(?,?,?,?,?,?,?)').bind(raw.id,'test-message','Accounts <hello@example.org>',mailbox.email,'Your single-use code','Your verification code is 123456',new Date().toISOString()).run();
    const inbox=await(await call('/api/messages','GET',undefined,userCookie)).json();assert.equal(inbox.messages.length,1);
    assert.equal((await call('/api/admin/messages/1','GET',undefined,userCookie)).status,401);
    assert.match((await(await call('/api/admin/messages/1','GET',undefined,adminCookie)).json()).message.body,/123456/);
    await call('/api/admin/messages/1','PATCH',{deleted:true},adminCookie);assert.equal((await(await call('/api/messages','GET',undefined,userCookie)).json()).messages.length,0);
    await call('/api/admin/messages/1','PATCH',{deleted:false},adminCookie);assert.equal((await(await call('/api/messages','GET',undefined,userCookie)).json()).messages.length,1);
    const second=await(await call('/api/admin/mailboxes','POST',{name:'other'},adminCookie)).json();const otherCookie=savedCookie(await call('/api/login','POST',second));assert.equal((await call('/api/messages/1','GET',undefined,otherCookie)).status,404);
    const extraCookie=savedCookie(await call('/api/login','POST',mailbox));
    assert.equal((await call('/api/account/sessions','DELETE',{others:true},userCookie)).status,200);
    assert.equal((await call('/api/messages','GET',undefined,extraCookie)).status,401);
    const newPassword='a-strong-new-password';const changed=await call('/api/account/password','POST',{currentPassword:mailbox.password,newPassword},userCookie);assert.equal(changed.status,200);userCookie=savedCookie(changed);
    assert.equal((await call('/api/login','POST',mailbox)).status,401);assert.equal((await call('/api/login','POST',{email:mailbox.email,password:newPassword})).status,200);
    assert.equal((await call('/api/admin/mailboxes/1','PATCH',{disabled:true},adminCookie)).status,200);assert.equal((await call('/api/messages','GET',undefined,userCookie)).status,401);
    await call('/api/admin/logout','POST',{},adminCookie);assert.equal((await call('/api/admin/mailboxes','GET',undefined,adminCookie)).status,401);
    const hostile=new Request('https://mail.example.com/api/admin/login',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({code:env.ADMIN_CODE})});assert.equal((await mailApi(hostile,env)).status,403);
  }finally{DB.close();}
});
