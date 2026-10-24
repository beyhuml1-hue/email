import { mailApi } from './mail-api.js';
import { receiveEmail } from './receive-email.js';
// Cloudflare Worker with native D1 mailboxes, or an optional existing backend.
// Set BACKEND_ORIGIN as a Worker runtime environment variable (HTTPS Railway URL).
export default {
  async email(message,env){await receiveEmail(message,env);},
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const path = incoming.pathname;
    if(path==='/reef-control'){const target=new URL(request.url);target.pathname='/';return env.ASSETS.fetch(new Request(target,request));}
    if (!path.startsWith('/api/') && path !== '/webhooks/resend' && path !== '/healthz') {
      return env.ASSETS.fetch(request);
    }
    let upstream;
    try {
      upstream = new URL(env.BACKEND_ORIGIN);
      if (upstream.protocol !== 'https:' || upstream.pathname !== '/' || upstream.search || upstream.hash || upstream.username || upstream.password) throw new Error('Invalid backend origin');
    } catch {
      if(path==='/healthz')return Response.json({ok:true,storage:!!env.DB});
      if(path.startsWith('/api/')){
        try{return await mailApi(request,env);}catch(error){console.error('Mailbox request failed',error.message);return Response.json({error:'The mail service could not complete this request.'},{status:500});}
      }
      return new Response('Incoming email is not configured', {status:503});
    }
    upstream.pathname = path;
    upstream.search = incoming.search;
    const forwarded = new Request(upstream.toString(), request);
    try { return await fetch(forwarded, {redirect:'manual'}); }
    catch { return new Response('Mail backend is temporarily unreachable', {status:502}); }
  }
};
