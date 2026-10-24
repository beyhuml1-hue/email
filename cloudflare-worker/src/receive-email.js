import PostalMime from 'postal-mime';
import {initDatabase} from './mail-api.js';
function textFromHtml(html){return String(html||'').replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>|<\/(p|div|li)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
export async function receiveEmail(message,env){
  if(!env.DB){message.setReject('Mailbox storage is unavailable');return;}
  if(message.rawSize>10*1024*1024){message.setReject('Message exceeds the 10 MB inbox limit');return;}
  await initDatabase(env.DB);
  const address=String(message.to).trim().toLowerCase(),mailbox=await env.DB.prepare('SELECT id FROM mailboxes WHERE email=? AND is_disabled=0').bind(address).first();
  if(!mailbox){message.setReject('Mailbox unavailable');return;}
  const raw=await new Response(message.raw).arrayBuffer();
  if(raw.byteLength>10*1024*1024){message.setReject('Message exceeds the 10 MB inbox limit');return;}
  const parsed=await PostalMime.parse(raw),content=String(parsed.text||textFromHtml(parsed.html)).slice(0,500000);
  const from=parsed.from?.name?`${parsed.from.name} <${parsed.from.address}>`:parsed.from?.address||message.from;
  const id=parsed.messageId||[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const timestamp=Date.parse(parsed.date);
  await env.DB.prepare('INSERT OR IGNORE INTO messages(mailbox_id,provider_id,sender,recipient,subject,body,arrived_at) VALUES(?,?,?,?,?,?,?)').bind(mailbox.id,String(id).slice(0,512),String(from).slice(0,512),address,String(parsed.subject||'(No subject)').slice(0,512),content,Number.isFinite(timestamp)?new Date(timestamp).toISOString():new Date().toISOString()).run();
}
