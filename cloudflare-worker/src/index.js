// Cloudflare Worker with static assets plus same-origin TidalMail backend proxy.
// Set BACKEND_ORIGIN as a Worker runtime environment variable (HTTPS Railway URL).
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const path = incoming.pathname;
    if (!path.startsWith('/api/') && path !== '/webhooks/resend' && path !== '/healthz') {
      return env.ASSETS.fetch(request);
    }
    let upstream;
    try {
      upstream = new URL(env.BACKEND_ORIGIN);
      if (upstream.protocol !== 'https:' || upstream.pathname !== '/' || upstream.search || upstream.hash || upstream.username || upstream.password) throw new Error('Invalid backend origin');
    } catch {
      return new Response('Mail backend is not configured', {status:503});
    }
    upstream.pathname = path;
    upstream.search = incoming.search;
    const forwarded = new Request(upstream.toString(), request);
    try { return await fetch(forwarded, {redirect:'manual'}); }
    catch { return new Response('Mail backend is temporarily unreachable', {status:502}); }
  }
};
