import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './database-adapter.mjs';
import {initDatabase,passwordHash} from '../src/mail-api.js';
import {receiveEmail} from '../src/receive-email.js';
test('real MIME stream decoding, private recipient matching and duplicate protection',async()=>{
  const DB=createDatabase();await initDatabase(DB);await DB.prepare('INSERT INTO mailboxes(email,password_hash) VALUES(?,?)').bind('player@example.com',await passwordHash('private-mail-password')).run();
  const raw='From: Account Team <accounts@example.org>\r\nTo: player@example.com\r\nSubject: Your single-use code\r\nMessage-ID: <test-message@example.org>\r\nDate: Sat, 24 Oct 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="part-boundary"\r\n\r\n--part-boundary\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nYour verification code is =31=32=33=34=35=36.\r\n--part-boundary\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Your code is <b>123456</b>.</p>\r\n--part-boundary--';
  let rejection='';const message=to=>({to,from:'accounts@example.org',rawSize:raw.length,raw:new Blob([raw]).stream(),setReject(reason){rejection=reason;}});
  try{await receiveEmail(message('player@example.com'),{DB});await receiveEmail(message('player@example.com'),{DB});const{results}=await DB.prepare('SELECT * FROM messages').all();assert.equal(results.length,1);assert.match(results[0].body,/123456/);assert.equal(results[0].subject,'Your single-use code');assert.equal(rejection,'');await receiveEmail(message('unknown@example.com'),{DB});assert.equal(rejection,'Mailbox unavailable');}finally{DB.close();}
});
