# TidalMail for lb000.xyz — Cloudflare + Railway + Resend

This bundle adds a working **same-origin API proxy** for TidalMail on Cloudflare Pages **or** Cloudflare Workers, while leaving the Node.js + SQLite backend on Railway. Choose **one** Cloudflare frontend, not both. The included source is a starter, not a live deployed service.

## Files

- `backend/` — Node.js 22+ server, signed Resend webhook, SQLite messages, mailbox creation tool, tests.
- `cloudflare-pages/` — TidalMail UI in `public/`, and a Pages Function in `functions/_middleware.js` that forwards `/api/*`, `/webhooks/resend`, and `/healthz` to Railway. `public/_routes.json` avoids invoking the function for static assets.
- `cloudflare-worker/` — alternative Worker with its own static UI and proxy routes (`src/index.js`, `wrangler.jsonc`). **Only use if you are actually on Workers, not Pages.**

## Step 0: Safety check in Cloudflare

1. Open https://dash.cloudflare.com and choose **lb000.xyz → DNS → Records**.
2. Record existing **MX**, **TXT**, and **CNAME** values first; check **Email → Email Routing** for existing routing.
3. If you already use `@lb000.xyz` mail, do **not** replace existing MX records. Instead configure receiving for `inbox.lb000.xyz` and provision `player@inbox.lb000.xyz`.
4. If no mail service uses the root domain, you can use `player@lb000.xyz` once Resend's root-domain MX is correctly installed.

Do not change your website's existing CNAME to point to Resend or Railway. Web hosting DNS and inbound MX are different records.

## Step 1: Deploy `backend/` to Railway

1. Upload **only `backend/` contents** to a private GitHub repository, or configure `backend/` as the root directory in your Railway GitHub service.
2. Railway → **New Project → Deploy from GitHub Repo**. Choose Node.js 22+. The start command is `npm start` if not auto detected.
3. Add a **Volume** mounted at `/data`. Set variables on the backend service:

   ```dotenv
   NODE_ENV=production
   MAIL_DOMAIN=lb000.xyz
   PUBLIC_ORIGIN=https://mail.lb000.xyz
   DB_PATH=/data/tidalmail.sqlite
   RESEND_API_KEY=<put your Resend private key in Railway Variables>
   RESEND_WEBHOOK_SECRET=<put webhook signing secret in Railway Variables>
   ```

   If you instead use the safe inbound subdomain, set `MAIL_DOMAIN=inbox.lb000.xyz` and later create `player@inbox.lb000.xyz`.

4. Under **Railway → Service → Settings → Networking**, generate a Railway **public domain** e.g. `your-service.up.railway.app`. This is a *backend URL* used by the Cloudflare proxy, not a new MX host and not necessarily a DNS record for your domain.
5. Verify `https://YOUR-RAILWAY-URL/healthz` displays `ok`.
6. Railway **SSH / shell** into the deployed backend and run `npm run add-mailbox -- player@lb000.xyz` (or `player@inbox.lb000.xyz`) to create the mailbox password interactively. Use a strong unique password; it is *not* a password for Minecraft/Microsoft/OpenAI. The mailbox must exist before incoming messages are stored.

## Step 2: Connect the existing Cloudflare site

### If your site is Cloudflare **Pages**

1. In its existing project source/repository, place the **`cloudflare-pages/public/`** assets into the built static output (if replacing the demo TidalMail UI) and the **`cloudflare-pages/functions/_middleware.js`** file at the repository's top-level `functions/_middleware.js` path. Put `public/_routes.json` into your actual *build output* directory. (With a simple static Pages project, configure build output directory as `public`.)
2. Pages **Settings → Variables and Secrets**: add a *runtime* variable `BACKEND_ORIGIN` equal to the Railway public URL, e.g. `https://YOUR-SERVICE.up.railway.app`. Do not add the Resend API key here.
3. Redeploy through Git integration or Wrangler. The dashboard's simple drag-and-drop Direct Upload method does not install `functions/` middleware.
4. Pages → **Custom domains**: attach `mail.lb000.xyz` if it isn't already attached. Keep the existing Pages CNAME; Cloudflare usually creates/manages it.
5. Visit `https://mail.lb000.xyz/healthz`. It should display `ok` when the proxy and backend are functioning.

### If your site is a Cloudflare **Worker**

1. Use `cloudflare-worker/src/index.js` as a starting proxy integrated into your existing Worker, or deploy the bundled Worker with `npx wrangler deploy` (from the `cloudflare-worker/` folder) if replacing the existing Worker is intentional.
2. Set the Worker **runtime** variable `BACKEND_ORIGIN` equal to Railway's real public HTTPS URL. **Do not store Resend secrets here**.
3. If redeploying the provided standalone Worker, its `wrangler.jsonc` includes the asset binding for the TidalMail UI and `run_worker_first` rules only for the proxy paths. Attach `mail.lb000.xyz` to that Worker using Cloudflare's **Workers & Pages → Worker → Domains & Routes**. Do not attach one hostname to two competing projects.
4. Visit `https://mail.lb000.xyz/healthz` and verify `ok`.

**Why proxy rather than cross-domain JavaScript?** The browser still sends `fetch('/api/login')` to its own site, letting the server set an HttpOnly SameSite cookie for the mail site and avoiding CORS changes. The proxy preserves Resend's signed raw webhook payload, while backend signature verification remains on Railway.

## Step 3: Enable inbound receiving at Resend

1. In https://resend.com/domains, add and verify `lb000.xyz` (or `inbox.lb000.xyz` if the root has an email service). Enable **Receiving** for the correct domain.
2. Resend will display its precise DNS verification entries and incoming MX server/priority. In **Cloudflare → lb000.xyz → DNS → Records**, add those entries using the values **shown in your Resend dashboard**. MX records are DNS only. Do not invent a destination or replace root-domain MX when other email is already in use.
3. If Cloudflare **Email Routing** is already handling MX records on the *same* receiving domain, handle the conflict before proceeding. Leave root email intact and use a separate inbound subdomain if necessary.
4. Once Resend displays the domain/receiving setup as verified, go to **Resend → Webhooks**. Subscribe to `email.received` with webhook URL:

   `https://mail.lb000.xyz/webhooks/resend`

5. Set `RESEND_WEBHOOK_SECRET` in Railway from the webhook's signing secret, and `RESEND_API_KEY` from a Resend API key able to access the Receiving API. Restart/redeploy the backend after setting both.

Do **not** set the webhook to a Pages static website URL that doesn't have the proxy function deployed, and do not make a webhook that simply trusts unsignatured JSON.

## Step 4: End-to-end test

1. `https://mail.lb000.xyz/healthz` responds `ok`.
2. Open `https://mail.lb000.xyz/` and sign into your freshly created mailbox.
3. Send a simple test email from an outside Gmail/Outlook account to `player@lb000.xyz` (or chosen inbound subdomain mailbox).
4. **Resend → Emails → Receiving** should show the message.
5. **Resend → Webhooks → Deliveries** should show a successful response. If it says `401`, your webhook signing secret likely doesn't match. If `404`, make sure Pages/Workers proxies `/webhooks/resend`. If `500`, inspect Railway logs and verify the Receiving API key.
6. Your Cloudflare TidalMail inbox should show the new message after an automatic refresh (~15 seconds) or a reload. If not, confirm the exact mailbox exists and inspect the Railway logs.

The backend stores the text content only. Attachments, outgoing mail, self-service signup, MFA and password resets are **not** included. A real incoming address can be used for legitimate account verifications, subject to each service's email-address policies; no provider can guarantee acceptance by Microsoft, OpenAI or any other website.

## Production notes

- Keep keys and passwords private; back up the `/data` volume.
- Do not publish a mail service to unlimited strangers without spam/abuse protections, mailbox provisioning controls, security reviews, retention and privacy policies.
- Frontend preview domains such as `*.pages.dev` won't pass this backend's state-changing Origin check because `PUBLIC_ORIGIN` is set to `https://mail.lb000.xyz`. Use the custom domain for testing login.
- A backend connection via a Railway-provided hostname does **not** require you to add an `api` CNAME to Cloudflare. Your site can remain fully served at `mail.lb000.xyz`.
- On Cloudflare Pages, direct uploads may serve static files but not your Functions. Use Git-integrated Pages or Wrangler for Functions.

## References

- https://developers.cloudflare.com/pages/functions/middleware/
- https://developers.cloudflare.com/pages/functions/routing/
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://docs.railway.com/volumes
- https://resend.com/features/inbound
- https://developers.cloudflare.com/dns/troubleshooting/email-issues/
