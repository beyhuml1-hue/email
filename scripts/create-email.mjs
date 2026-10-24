try{process.loadEnvFile('.env');}catch{}
const origin=process.env.MAIL_SITE_ORIGIN||'https://email.lb000.xyz';
if(!process.env.ADMIN_CODE){console.error('Set ADMIN_CODE in your private environment or ignored .env file before running the bot.');process.exit(1);}
if(new URL(origin).protocol!=='https:'&&!['localhost','127.0.0.1'].includes(new URL(origin).hostname)){console.error('Use HTTPS for your mail site.');process.exit(1);}
let cookie;
async function call(path,data){const response=await fetch(new URL(path,origin),{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});const result=await response.json();if(!response.ok)throw Error(result.error||'Mail service request failed');const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return result;}
try{await call('/api/admin/login',{code:process.env.ADMIN_CODE});const account=await call('/api/admin/mailboxes',{name:process.argv[2]||''});console.log(`Email: ${account.email}\nPassword: ${account.password}\nSign in: ${origin}\nSave these details privately.`);}catch(error){console.error(error.message);process.exitCode=1;}finally{if(cookie)await call('/api/admin/logout',{}).catch(()=>{});}
