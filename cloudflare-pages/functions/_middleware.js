// Cloudflare Pages Functions: same-origin proxy to the TidalMail Node backend.
// Deploy alongside public/; set BACKEND_ORIGIN to Railway's *actual* HTTPS URL.
// No Resend secrets or database credentials belong on Cloudflare Pages.
export async function onRequest(context) {
  const incoming = new URL(context.request.url);
  const path = incoming.pathname;
  const api = path.startsWith('/api/');
  if (!api && path !== '/webhooks/resend' && path !== '/healthz') {
    return context.next(); // Keep static assets served by Cloudflare Pages.
  }

  let upstream;
  try {
    upstream = new URL(context.env.BACKEND_ORIGIN);
    if (upstream.protocol !== 'https:' || upstream.pathname !== '/' || upstream.search || upstream.hash || upstream.username || upstream.password) {
      throw new Error('Invalid backend URL');
    }
  } catch {
    return new Response('Mail backend is not configured', {status:503});
  }
  upstream.pathname = path;
  upstream.search = incoming.search;
  // Preserve Cookie, Origin, request method, and the untouched webhook body/signature.
  const forwarded = new Request(upstream.toString(), context.request);
  try {
    const response = await fetch(forwarded, {redirect:'manual'});
    return response; // Retain Set-Cookie and no-store headers from the backend.
  } catch {
    return new Response('Mail backend is temporarily unreachable', {status:502});
  }
}
