const encoder=new TextEncoder(),SESSION='tidal_session',ADMIN='tidal_admin';
const ready=new WeakMap();let lastCleanup=0;
const hex=bytes=>[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
const token=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const digest=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const equal=(a,b)=>{let mismatch=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return mismatch===0;};
export async function passwordHash(password,salt=token().slice(0,32)){
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000},key,256);
  return `pbkdf2$${salt}$${hex(bits)}`;
}
async function passwordMatches(password,hash){if(typeof password!=='string'||password.length>512)return false;const parts=String(hash).split('$');return parts[0]==='pbkdf2'&&parts[1]&&equal(await passwordHash(password,parts[1]),hash);}
export async function initDatabase(db){
  if(!ready.has(db))ready.set(db,db.batch([
    `CREATE TABLE IF NOT EXISTS mailboxes(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,is_disabled INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id),expires_at INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,device TEXT NOT NULL DEFAULT 'Browser')`,
    `CREATE TABLE IF NOT EXISTS admin_sessions(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id),provider_id TEXT NOT NULL,sender TEXT NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,arrived_at TEXT NOT NULL,is_read INTEGER NOT NULL DEFAULT 0,is_starred INTEGER NOT NULL DEFAULT 0,deleted_at TEXT,UNIQUE(mailbox_id,provider_id))`,
    `CREATE INDEX IF NOT EXISTS inbox_by_owner ON messages(mailbox_id,arrived_at)`,
    `CREATE TABLE IF NOT EXISTS site_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,tries INTEGER NOT NULL,expires_at INTEGER NOT NULL)`,
    `INSERT OR IGNORE INTO site_settings(key,value) VALUES('biome','ocean'),('updatedAt','0')`,
  ].map(sql=>db.prepare(sql))).catch(error=>{ready.delete(db);throw error;}));
  await ready.get(db);
}
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const cookie=(req,name,value,seconds)=>`${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${new URL(req.url).protocol==='https:'?'; Secure':''}`;
const getCookie=(req,name)=>new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{64})(?:;|$)`).exec(req.headers.get('cookie')||'')?.[1];
async function body(req){if(Number(req.headers.get('content-length'))>4096)throw Error('Request too large');const text=await req.text();if(text.length>4096)throw Error('Request too large');return JSON.parse(text);}
async function limited(req,kind,db){const now=Date.now(),window=Math.floor(now/900000),key=await digest((req.headers.get('CF-Connecting-IP')||'local')+':'+kind+':'+window);if(now-lastCleanup>300000){await db.prepare('DELETE FROM login_attempts WHERE expires_at<?').bind(now).run();lastCleanup=now;}const row=await db.prepare('INSERT INTO login_attempts(key,tries,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET tries=tries+1 RETURNING tries').bind(key,(window+1)*900000).first();return row.tries>15;}
function validAddress(value,domain){const email=String(value||'').trim().toLowerCase();if(email.length>254||!/^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)||domain&&!email.endsWith('@'+domain))throw Error('Enter an address on your receiving domain.');return email;}
async function auth(req,db){const t=getCookie(req,SESSION);if(!t)return null;return db.prepare('SELECT m.id,m.email,s.token_hash FROM sessions s JOIN mailboxes m ON m.id=s.mailbox_id WHERE s.token_hash=? AND s.expires_at>? AND m.is_disabled=0').bind(await digest(t),Date.now()).first();}
async function admin(req,db){const t=getCookie(req,ADMIN);return t&&await db.prepare('SELECT 1 AS ok FROM admin_sessions WHERE token_hash=? AND expires_at>?').bind(await digest(t),Date.now()).first();}
async function session(req,db,user){const t=token();await db.prepare('INSERT INTO sessions(token_hash,mailbox_id,expires_at,device) VALUES(?,?,?,?)').bind(await digest(t),user.id,Date.now()+604800000,(req.headers.get('user-agent')||'Browser').slice(0,180)).run();return cookie(req,SESSION,t,604800);}
export async function mailApi(req,env){
  const path=new URL(req.url).pathname,method=req.method;
  if(!env.DB)return json({error:'Mailbox storage is not connected yet.'},503);
  if(['POST','PATCH','DELETE'].includes(method)){
    if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Request not allowed'},403);
    if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
  }
  await initDatabase(env.DB);const db=env.DB;
  try{
    if(path==='/api/site'&&method==='GET'){const {results}=await db.prepare('SELECT key,value FROM site_settings').all();return json(Object.fromEntries(results.map(r=>[r.key,r.value])));}
    if(path==='/api/session'&&method==='GET'){const user=await auth(req,db);return json({mailbox:user?.email||null});}
    if(path==='/api/login'&&method==='POST'){
      if(await limited(req,'login',db))return json({error:'Too many attempts. Try again later.'},429);
      const data=await body(req),email=validAddress(data.email),user=await db.prepare('SELECT * FROM mailboxes WHERE email=? AND is_disabled=0').bind(email).first();
      if(!user||!await passwordMatches(data.password,user.password_hash))return json({error:'Incorrect email or password'},401);
      return json({mailbox:user.email},200,{'Set-Cookie':await session(req,db,user)});
    }
    if(path==='/api/logout'&&method==='POST'){const t=getCookie(req,SESSION);if(t)await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(t)).run();return json({ok:true},200,{'Set-Cookie':cookie(req,SESSION,'',0)});}
    if(path==='/api/admin/session'&&method==='GET')return json({admin:!!await admin(req,db),configured:!!env.ADMIN_CODE});
    if(path==='/api/admin/login'&&method==='POST'){
      if(!env.ADMIN_CODE)return json({error:'Admin access is not configured yet.'},503);
      if(await limited(req,'admin',db))return json({error:'Too many attempts. Try again later.'},429);
      const data=await body(req);if(typeof data.code!=='string'||!equal(await digest(data.code),await digest(env.ADMIN_CODE)))return json({error:'Incorrect admin code'},401);
      const t=token();await db.prepare('INSERT INTO admin_sessions(token_hash,expires_at) VALUES(?,?)').bind(await digest(t),Date.now()+3600000).run();return json({admin:true},200,{'Set-Cookie':cookie(req,ADMIN,t,3600)});
    }
    if(path==='/api/admin/logout'&&method==='POST'){const t=getCookie(req,ADMIN);if(t)await db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await digest(t)).run();return json({ok:true},200,{'Set-Cookie':cookie(req,ADMIN,'',0)});}
    if(path.startsWith('/api/admin/')){
      if(!await admin(req,db))return json({error:'Admin sign-in required'},401);
      if(path==='/api/admin/site'&&method==='PATCH'){
        const data=await body(req);if(!['ocean','grass','nether','end','desert','snow','cherry','mushroom'].includes(data.biome))return json({error:'Choose a valid website style.'},400);
        const updatedAt=String(Date.now());await db.batch([db.prepare('UPDATE site_settings SET value=? WHERE key=?').bind(data.biome,'biome'),db.prepare('UPDATE site_settings SET value=? WHERE key=?').bind(updatedAt,'updatedAt')]);return json({biome:data.biome,updatedAt});
      }
      if(path==='/api/admin/mailboxes'&&method==='GET'){
        const {results}=await db.prepare('SELECT m.id,m.email,m.created_at,m.is_disabled,(SELECT COUNT(*) FROM messages e WHERE e.mailbox_id=m.id AND e.deleted_at IS NULL) AS message_count,(SELECT COUNT(*) FROM sessions s WHERE s.mailbox_id=m.id AND s.expires_at>?) AS session_count FROM mailboxes m ORDER BY m.id DESC LIMIT 250').bind(Date.now()).all();return json({mailboxes:results,domain:env.MAIL_DOMAIN||'lb000.xyz'});
      }
      if(path==='/api/admin/mailboxes'&&method==='POST'){
        const data=await body(req),domain=(env.MAIL_DOMAIN||'lb000.xyz').trim().toLowerCase(),name=data.name||'inbox-'+token().slice(0,12),email=validAddress(`${name}@${domain}`,domain),password=token().slice(0,32);
        if(await db.prepare('SELECT id FROM mailboxes WHERE email=?').bind(email).first())return json({error:'This mailbox already exists'},409);
        await db.prepare('INSERT INTO mailboxes(email,password_hash) VALUES(?,?)').bind(email,await passwordHash(password)).run();return json({email,password},201);
      }
      const inbox=path.match(/^\/api\/admin\/mailboxes\/(\d+)\/messages$/);
      if(inbox&&method==='GET'){const {results}=await db.prepare('SELECT id,sender,recipient,subject,substr(body,1,160) AS preview,arrived_at,is_read,deleted_at FROM messages WHERE mailbox_id=? ORDER BY arrived_at DESC,id DESC LIMIT 250').bind(Number(inbox[1])).all();return json({messages:results});}
      const sessionsPath=path.match(/^\/api\/admin\/mailboxes\/(\d+)\/sessions$/);
      if(sessionsPath&&method==='DELETE'){await db.prepare('DELETE FROM sessions WHERE mailbox_id=?').bind(Number(sessionsPath[1])).run();return json({ok:true});}
      const item=path.match(/^\/api\/admin\/messages\/(\d+)$/);
      if(item&&method==='GET'){const message=await db.prepare('SELECT id,mailbox_id,sender,recipient,subject,body,arrived_at,deleted_at FROM messages WHERE id=?').bind(Number(item[1])).first();return message?json({message}):json({error:'Message not found'},404);}
      if(item&&method==='PATCH'){const data=await body(req);if(typeof data.deleted!=='boolean')return json({error:'Choose trash or restore'},400);await db.prepare('UPDATE messages SET deleted_at=? WHERE id=?').bind(data.deleted?new Date().toISOString():null,Number(item[1])).run();return json({ok:true});}
      const m=path.match(/^\/api\/admin\/mailboxes\/(\d+)$/);
      if(m&&method==='PATCH'){
        const id=Number(m[1]),data=await body(req),existing=await db.prepare('SELECT id,email FROM mailboxes WHERE id=?').bind(id).first();if(!existing)return json({error:'Mailbox not found'},404);
        if(data.resetPassword===true){const password=token().slice(0,32);await db.batch([db.prepare('UPDATE mailboxes SET password_hash=? WHERE id=?').bind(await passwordHash(password),id),db.prepare('DELETE FROM sessions WHERE mailbox_id=?').bind(id)]);return json({email:existing.email,password});}
        if(typeof data.disabled==='boolean'){await db.batch([db.prepare('UPDATE mailboxes SET is_disabled=? WHERE id=?').bind(data.disabled?1:0,id),db.prepare('DELETE FROM sessions WHERE mailbox_id=?').bind(id)]);return json({ok:true});}
        return json({error:'No valid change'},400);
      }
      return json({error:'Not found'},404);
    }
    const user=await auth(req,db);if(!user)return json({error:'Sign in required'},401);
    if(path==='/api/account/sessions'&&method==='GET'){const{results}=await db.prepare('SELECT token_hash,created_at,expires_at,device FROM sessions WHERE mailbox_id=? AND expires_at>? ORDER BY expires_at DESC').bind(user.id,Date.now()).all();return json({sessions:results.map(s=>({...s,current:s.token_hash===user.token_hash}))});}
    if(path==='/api/account/sessions'&&method==='DELETE'){const data=await body(req);if(data.others===true)await db.prepare('DELETE FROM sessions WHERE mailbox_id=? AND token_hash<>?').bind(user.id,user.token_hash).run();else if(typeof data.id==='string')await db.prepare('DELETE FROM sessions WHERE mailbox_id=? AND token_hash=? AND token_hash<>?').bind(user.id,data.id,user.token_hash).run();return json({ok:true});}
    if(path==='/api/account/password'&&method==='POST'){
      const data=await body(req);if(typeof data.newPassword!=='string'||data.newPassword.length<12||data.newPassword.length>256)return json({error:'Use a password of 12–256 characters.'},400);
      if(await limited(req,'password-'+user.id,db))return json({error:'Too many attempts. Try again later.'},429);
      const existing=await db.prepare('SELECT password_hash FROM mailboxes WHERE id=?').bind(user.id).first();if(!await passwordMatches(data.currentPassword,existing.password_hash))return json({error:'Current password is incorrect'},401);
      await db.batch([db.prepare('UPDATE mailboxes SET password_hash=? WHERE id=?').bind(await passwordHash(data.newPassword),user.id),db.prepare('DELETE FROM sessions WHERE mailbox_id=?').bind(user.id)]);
      return json({ok:true},200,{'Set-Cookie':await session(req,db,user)});
    }
    if(path==='/api/messages'&&method==='GET'){const{results}=await db.prepare('SELECT id,sender,subject,substr(body,1,160) AS preview,arrived_at,is_read,is_starred FROM messages WHERE mailbox_id=? AND deleted_at IS NULL ORDER BY arrived_at DESC,id DESC LIMIT 200').bind(user.id).all();return json({messages:results});}
    const message=path.match(/^\/api\/messages\/(\d+)$/);
    if(message){const id=Number(message[1]);
      if(method==='GET'){const item=await db.prepare('SELECT id,sender,recipient,subject,body,arrived_at,is_read,is_starred FROM messages WHERE id=? AND mailbox_id=? AND deleted_at IS NULL').bind(id,user.id).first();return item?json({message:item}):json({error:'Message not found'},404);}
      if(method==='PATCH'){const data=await body(req),sets=[],values=[];for(const key of ['is_read','is_starred'])if(typeof data[key]==='boolean'){sets.push(key+'=?');values.push(data[key]?1:0);}if(!sets.length)return json({error:'No valid change'},400);const result=await db.prepare(`UPDATE messages SET ${sets.join(',')} WHERE id=? AND mailbox_id=? AND deleted_at IS NULL`).bind(...values,id,user.id).run();return result.meta.changes?json({ok:true}):json({error:'Message not found'},404);}
      if(method==='DELETE'){await db.prepare('UPDATE messages SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND mailbox_id=?').bind(id,user.id).run();return json({ok:true});}
    }
    return json({error:'Not found'},404);
  }catch(error){if(error instanceof SyntaxError)return json({error:'Invalid request'},400);if(/address|Request too large/.test(error.message))return json({error:error.message},400);throw error;}
}
