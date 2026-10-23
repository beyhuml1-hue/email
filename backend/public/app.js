const $ = id => document.getElementById(id);
let mail=[], selected=null, current=null, folder='inbox', query='', timer=null, toastTimer=null;
let address='';

function toast(message) {
  $('toast').textContent=message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2800);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function dateLabel(value) {
  const t=new Date(value);
  if (!Number.isFinite(t.getTime())) return '';
  const diff=Date.now()-t.getTime();
  if (diff>=0 && diff<60_000) return 'Just now';
  if (diff>=0 && diff<3_600_000) return `${Math.floor(diff/60_000)} min ago`;
  if (diff>=0 && diff<86_400_000) return `${Math.floor(diff/3_600_000)}h ago`;
  return t.toLocaleDateString(undefined,{day:'numeric',month:'short',year:t.getFullYear()===new Date().getFullYear()?undefined:'numeric'});
}
async function api(path,opts={}) {
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...opts,headers: { ...(opts.body ? {'Content-Type':'application/json'} : {}),...(opts.headers||{}) }});
  const data=await response.json().catch(()=>({error:'Invalid server response'}));
  if (!response.ok) { const err=new Error(data.error || `Request failed (${response.status})`);err.status=response.status;throw err; }
  return data;
}
function showInbox(email) {
  address=email;
  $('sidebar-address').textContent=email;
  $('small-address').textContent=email;
  document.body.classList.add('inbox-open');
  $('password').value='';
  if (timer) clearInterval(timer);
  timer=setInterval(()=>refresh(false),15_000);
  refresh(true);
}
function showLogin() {
  document.body.classList.remove('inbox-open');
  if (timer) clearInterval(timer);
  timer=null; selected=null; current=null; mail=[]; address='';
}
function filtered() {
  const q=query.toLowerCase();
  return mail.filter(m=>(folder!=='starred'||m.is_starred)&&(!q||[m.sender,m.subject,m.preview].some(x=>String(x || '').toLowerCase().includes(q))));
}
function render() {
  const rows=filtered();
  $('folder-name').textContent=folder==='starred'?'Starred':'Inbox';
  $('message-count').textContent=`${rows.length} message${rows.length===1?'':'s'}${mail.length===200 ? ' (showing latest 200)' : ''}`;
  $('inbox-nav').classList.toggle('active',folder==='inbox');
  $('starred-nav').classList.toggle('active',folder==='starred');
  $('messages').innerHTML=rows.length ? rows.map(m=>
    `<button type="button" class="msg ${m.is_read?'':'unread'} ${selected===m.id?'active':''}" data-id="${m.id}">
      <span class="msg-meta"><strong>${m.is_read?'':'<span class="unread-dot">● </span>'}${escapeHtml(m.sender)}</strong><span>${escapeHtml(dateLabel(m.arrived_at))}</span></span>
      <div class="subject">${escapeHtml(m.subject)} ${m.is_starred?'★':''}</div>
      <div class="preview">${escapeHtml(m.preview || '')}</div>
    </button>`).join('') : '<div class="empty">No messages yet 🫧<p>Send an email to your address, then refresh.</p></div>';
  $('messages').querySelectorAll('button[data-id]').forEach(el=>el.addEventListener('click',()=>openMessage(Number(el.dataset.id))));
  if (current && rows.some(m=>m.id===current.id)) renderReader();
  else $('reader').innerHTML='<div class="empty-reader">Select a message to read ✉</div>';
}
async function refresh(showFeedback=false) {
  if (!address) return;
  try {
    const data=await api('/api/messages');
    const before=new Set(mail.map(m=>m.id));
    const isNew = mail.length>0 && data.messages.some(m=>!before.has(m.id));
    mail=data.messages;
    if (isNew && !showFeedback) toast('A new email arrived! 🌊');
    render();
    if (showFeedback) toast('Inbox updated');
  } catch(err) {
    if (err.status===401) {showLogin();toast('Your session expired. Sign in again.');}
    else if (showFeedback) toast(err.message);
  }
}
function safeLinks(body) {
  // Messages are treated as plain text. The only rendered links are http/https URLs.
  const pattern=/https?:\/\/[^\s<>"']+/g;
  let output='',prev=0;
  for (const match of String(body).matchAll(pattern)) {
    output+=escapeHtml(body.slice(prev,match.index));
    let candidate=match[0];
    const trailing=candidate.match(/[),.;!?]+$/)?.[0] || '';
    if (trailing) candidate=candidate.slice(0,-trailing.length);
    try {
      const parsed=new URL(candidate);
      if (!['http:','https:'].includes(parsed.protocol)) throw new Error();
      output+=`<a href="${escapeHtml(parsed.href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(candidate)}</a>${escapeHtml(trailing)}`;
    } catch {output+=escapeHtml(match[0]);}
    prev=match.index+match[0].length;
  }
  return output+escapeHtml(body.slice(prev));
}
function codeFromMessage(message) {
  const all=`${message.subject}\n${message.body}`;
  const close=all.match(/(?:verification|security|one[- ]time|login|sign[- ]in|passcode|code)\D{0,60}\b(\d{4,8})\b/i);
  return close?.[1] || all.match(/\b\d{6}\b/)?.[0] || null;
}
function renderReader() {
  if (!current) return;
  const msg=current,code=codeFromMessage(msg);
  $('reader').innerHTML=`
    <div class="reader-actions">
      ${code?'<button type="button" id="code-btn">⧉ Copy code</button>':''}
      <button type="button" id="star-btn">${msg.is_starred?'★ Unstar':'☆ Star'}</button>
      <button type="button" id="delete-btn">Delete</button>
    </div>
    <h2>${escapeHtml(msg.subject)}</h2>
    <div class="read-meta"><span class="avatar">${escapeHtml(msg.sender.slice(0,1).toUpperCase())}</span><span><b>${escapeHtml(msg.sender)}</b><small>To: ${escapeHtml(msg.recipient)} · ${escapeHtml(new Date(msg.arrived_at).toLocaleString())}</small></span><span class="badge-demo" style="margin-left:auto">Received</span></div>
    <div class="read-body">${safeLinks(msg.body)}</div>
    <p class="safety-note">Be careful with links in unexpected emails. The sender name can be spoofed.</p>`;
  if (code) $('code-btn').addEventListener('click',()=>copy(code,'Verification code copied'));
  $('star-btn').addEventListener('click',async()=>{
    try {await api(`/api/messages/${msg.id}`,{method:'PATCH',body:JSON.stringify({is_starred:!msg.is_starred})});msg.is_starred=msg.is_starred?0:1;syncMessage();render();}
    catch(err){toast(err.message);}
  });
  $('delete-btn').addEventListener('click',async()=>{
    if (!confirm('Delete this email from your inbox?')) return;
    try {await api(`/api/messages/${msg.id}`,{method:'DELETE',body:JSON.stringify({})});selected=null;current=null;mail=mail.filter(m=>m.id!==msg.id);render();toast('Email deleted');}
    catch(err){toast(err.message);}
  });
}
function syncMessage() {
  const listItem=mail.find(m=>m.id===current?.id);
  if (listItem && current) {listItem.is_read=current.is_read;listItem.is_starred=current.is_starred;}
}
async function openMessage(id) {
  try {
    const {message}=await api(`/api/messages/${id}`);
    selected=id; current=message;
    if (!message.is_read) {
      await api(`/api/messages/${id}`,{method:'PATCH',body:JSON.stringify({is_read:true})});
      current.is_read=1;
    }
    syncMessage(); render();
  } catch(err){toast(err.message);}
}
async function copy(value,success) {
  try {await navigator.clipboard.writeText(value);toast(success);}
  catch {toast('Copy unavailable in this browser; select the text instead.');}
}
$('signin-form').addEventListener('submit',async e=>{
  e.preventDefault();
  $('error').textContent='';
  const button=$('sign-in-button');
  button.disabled=true;button.textContent='Signing in…';
  try {
    const data=await api('/api/login',{method:'POST',body:JSON.stringify({email:$('email').value.trim(),password:$('password').value})});
    showInbox(data.mailbox);
  } catch(err) {$('error').textContent=err.message;}
  finally {button.disabled=false;button.textContent='Sign in →';}
});
$('toggle-pass').addEventListener('click',()=>{
  const p=$('password');p.type=p.type==='password'?'text':'password';
  $('toggle-pass').textContent=p.type==='password'?'Show':'Hide';
});
async function logout(){
  try {await api('/api/logout',{method:'POST'});} catch {}
  showLogin();toast('Signed out');
}
$('logout').addEventListener('click',logout);
$('mobile-logout').addEventListener('click',logout);
$('copy-address').addEventListener('click',()=>copy(address,'Email address copied'));
$('mobile-copy').addEventListener('click',()=>copy(address,'Email address copied'));
$('inbox-nav').addEventListener('click',()=>{folder='inbox';render();});
$('starred-nav').addEventListener('click',()=>{folder='starred';render();});
$('search').addEventListener('input',e=>{query=e.target.value.trim();render();});
$('refresh').addEventListener('click',()=>refresh(true));
(async()=>{
  try {const {mailbox}=await api('/api/session');if(mailbox)showInbox(mailbox);}
  catch { /* signed out */ }
})();
