import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

try { process.loadEnvFile('.env'); } catch { /* Deployment secrets come from environment. */ }
const { db, normalizedEmail, matchesPassword, getMailboxFromToken, hashToken, saveInbound } = await import('./db.mjs');

const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE = 'tidal_session';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const base = join(dirname(fileURLToPath(import.meta.url)), 'public');
const site = readFileSync(join(base,'index.html'));
const script = readFileSync(join(base,'app.js'));

const loginBuckets = new Map();
function json(res, status, value, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(JSON.stringify(value));
}
function text(res, status, msg) { res.writeHead(status, {'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}); res.end(msg); }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim().split(/=(.*)/s).slice(0,2)).filter(([key, val]) => key && val)); }
function getAuth(req) { return getMailboxFromToken(cookies(req)[COOKIE]); }
function setSessionCookie(res, value, expired = false) {
  const secure = PROD ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; ${expired ? 'Max-Age=0' : `Max-Age=${Math.round(SESSION_TTL / 1000)}`}`);
}
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // tools / non-browser webhook requests
  const expected = process.env.PUBLIC_ORIGIN || `http${PROD ? 's' : ''}://${req.headers.host}`;
  return origin === expected;
}
async function readBody(req, maxBytes=64*1024) {
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    if (size > maxBytes) { req.destroy(); throw new Error('Request too large'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function verification(raw, headers, secret) {
  const id=headers['svix-id'], stamp=headers['svix-timestamp'], signature=headers['svix-signature'];
  if (!secret?.startsWith('whsec_') || typeof id !== 'string' || typeof stamp !== 'string' || typeof signature !== 'string') return false;
  if (!/^\d+$/.test(stamp) || Math.abs(Date.now()/1000 - Number(stamp)) > 300) return false;
  const key=Buffer.from(secret.slice(6), 'base64');
  if (!key.length) return false;
  const signed=`${id}.${stamp}.${raw}`;
  const expected=createHmac('sha256',key).update(signed).digest();
  return signature.split(' ').some(piece => {
    if (!piece.startsWith('v1,')) return false;
    const got=Buffer.from(piece.slice(3),'base64');
    return got.length===expected.length && timingSafeEqual(got,expected);
  });
}
function plainTextFromHtml(html) {
  return String(html || '')
    .replace(/<(script|style|head|svg)[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<\/(p|div|li|h[1-6])\s*>/gi,'\n')
    .replace(/<[^>]*>/g,'')
    .replace(/&(?:nbsp|#160);/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'");
}
async function fetchReceivedEmail(id) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const apiBase = process.env.NODE_ENV === 'test' && process.env.TEST_RESEND_API_BASE ? process.env.TEST_RESEND_API_BASE : 'https://api.resend.com';
    const response = await fetch(`${apiBase}/emails/receiving/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` }, signal: controller.signal
    });
    if (!response.ok) throw new Error(`Resend receiving API status ${response.status}`);
    const body = await response.json();
    return body.data || body;
  } finally { clearTimeout(timeout); }
}
async function handleInbound(req, res) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_WEBHOOK_SECRET) return text(res, 503, 'Incoming email not configured');
  const raw = await readBody(req, 1024*1024);
  if (!verification(raw, req.headers, process.env.RESEND_WEBHOOK_SECRET)) return text(res,401,'Invalid webhook signature');
  let event;
  try { event=JSON.parse(raw); } catch { return text(res,400,'Malformed webhook'); }
  if (event.type !== 'email.received') return text(res,200,'Ignored');
  const id=event?.data?.email_id;
  if (typeof id !== 'string' || !/^[a-z0-9-]{8,100}$/i.test(id)) return text(res,400,'Invalid email ID');
  const recipients = Array.isArray(event.data.to) ? event.data.to : [];
  if (!recipients.length) return text(res,200,'No recipients');
  // Do not retrieve or store incoming mail if no local mailbox owns a recipient.
  const owned = recipients.filter(v=>{
    try { return !!db.prepare('SELECT 1 FROM mailboxes WHERE email=?').get(normalizedEmail(v)); } catch { return false; }
  });
  if (!owned.length) return text(res,200,'No registered recipient');
  const retrieved = await fetchReceivedEmail(id);
  const body = String(retrieved.text || plainTextFromHtml(retrieved.html) || '');
  let inserted = 0;
  for (const recipient of new Set(owned.map(v=>v.toLowerCase()))) {
    inserted += Number(saveInbound(recipient, {
      id,
      from: retrieved.from || event.data.from,
      subject: retrieved.subject || event.data.subject,
      body,
      created_at: retrieved.created_at || event.data.created_at
    }));
  }
  text(res,200,`Accepted ${inserted} message(s)`);
}
function limitLogin(req, email) {
  const key = String(req.socket.remoteAddress || '?') + ':' + email;
  const now = Date.now();
  for (const [k, v] of loginBuckets) if (v.reset < now) loginBuckets.delete(k);
  const bucket = loginBuckets.get(key) || {tries:0,reset:now+15*60*1000};
  bucket.tries++;
  loginBuckets.set(key,bucket);
  return bucket.tries > 10;
}
function serveMessages(res, mailbox, url) {
  const starred=url.searchParams.get('folder') === 'starred';
  const rows=db.prepare(`SELECT id,sender,subject,substr(body,1,160) AS preview,arrived_at,is_read,is_starred
    FROM messages WHERE mailbox_id=? AND deleted_at IS NULL ${starred ? 'AND is_starred=1' : ''} ORDER BY arrived_at DESC, id DESC LIMIT 200`).all(mailbox.id);
  json(res,200,{ messages:rows });
}
const server = createServer(async (req, res) => {
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  const url=new URL(req.url,'http://localhost');
  const path=url.pathname;
  try {
    if (path === '/healthz' && req.method === 'GET') return text(res,200,'ok');
    if (path === '/webhooks/resend' && req.method === 'POST') return await handleInbound(req,res);
    if (path === '/' && req.method === 'GET') { res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'}); return res.end(site); }
    if (path === '/app.js' && req.method === 'GET') { res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-cache'}); return res.end(script); }
    if (path === '/api/session' && req.method === 'GET') { const u = getAuth(req); return json(res,200,{ mailbox: u?.email || null }); }
    if (!path.startsWith('/api/')) return text(res,404,'Not found');
    if (['POST','PATCH','DELETE'].includes(req.method) && (!checkOrigin(req) || (path !== '/api/logout' && !(req.headers['content-type'] || '').startsWith('application/json')))) return json(res,403,{error:'Request not allowed'});
    if (path === '/api/login' && req.method === 'POST') {
      const body=JSON.parse(await readBody(req));
      let email='';
      try { email=normalizedEmail(body.email); } catch { return json(res,400,{error:'Invalid email address'}); }
      if (limitLogin(req,email)) return json(res,429,{error:'Too many attempts. Try again later.'});
      const user = db.prepare('SELECT id,email,password_hash FROM mailboxes WHERE email=?').get(email);
      if (!user || typeof body.password !== 'string' || !matchesPassword(body.password,user.password_hash)) return json(res,401,{error:'Incorrect email or password'});
      const token=randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO sessions (token_hash,mailbox_id,expires_at) VALUES (?,?,?)').run(hashToken(token),user.id,Date.now()+SESSION_TTL);
      setSessionCookie(res,token);
      return json(res,200,{mailbox:user.email});
    }
    if (path === '/api/logout' && req.method === 'POST') {
      const token=cookies(req)[COOKIE];
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
      setSessionCookie(res,'',true);
      return json(res,200,{ok:true});
    }
    const user=getAuth(req);
    if (!user) return json(res,401,{error:'Sign in required'});
    if (path === '/api/messages' && req.method === 'GET') return serveMessages(res,user,url);
    const m=path.match(/^\/api\/messages\/(\d+)$/);
    if (m) {
      const id=Number(m[1]);
      if (req.method === 'GET') {
        const msg=db.prepare('SELECT id,sender,recipient,subject,body,arrived_at,is_read,is_starred FROM messages WHERE id=? AND mailbox_id=? AND deleted_at IS NULL').get(id,user.id);
        return msg ? json(res,200,{message:msg}) : json(res,404,{error:'Message not found'});
      }
      if (req.method === 'PATCH') {
        const data=JSON.parse(await readBody(req));
        const values=[]; const sets=[];
        if (typeof data.is_read === 'boolean') {sets.push('is_read=?'); values.push(data.is_read?1:0);}
        if (typeof data.is_starred === 'boolean') {sets.push('is_starred=?'); values.push(data.is_starred?1:0);}
        if (!sets.length) return json(res,400,{error:'No valid changes'});
        const result=db.prepare(`UPDATE messages SET ${sets.join(',')} WHERE id=? AND mailbox_id=? AND deleted_at IS NULL`).run(...values,id,user.id);
        return result.changes ? json(res,200,{ok:true}) : json(res,404,{error:'Message not found'});
      }
      if (req.method === 'DELETE') {
        const result=db.prepare("UPDATE messages SET deleted_at=datetime('now') WHERE id=? AND mailbox_id=? AND deleted_at IS NULL").run(id,user.id);
        return result.changes ? json(res,200,{ok:true}) : json(res,404,{error:'Message not found'});
      }
    }
    return json(res,404,{error:'Not found'});
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${path}:`,error?.message || error);
    if (!res.headersSent) json(res,500,{error:'Server error'});
  }
});
server.listen(PORT,HOST, () => console.log(`TidalMail listening on http://${HOST}:${PORT}`));
