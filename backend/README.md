# TidalMail — real incoming email edition

An underwater-themed website with **real inbound mail reception**, private password-protected inboxes, and persistent email storage. It receives verification messages sent to email addresses on a domain that you own (for example, `player@yourdomain.com`). It **does not impersonate Minecraft, ChatGPT, Microsoft, or other services**, and it does not collect passwords for those third-party services.

## Included

- Responsive UI based on the provided screenshot
- Actual login with per-mailbox password hashing (scrypt), HttpOnly session cookies, and basic brute-force protection
- One private inbox per mailbox address, isolated by database ownership
- Resend incoming-mail webhook with **Svix signature, timestamp, and replay-window verification**
- Incoming body retrieval from Resend's API, stored persistently in SQLite (WAL mode)
- Auto-refresh every 15 seconds, search, open emails, mark as read, star, delete, copy verification codes, copy addresses
- Text-only email rendering (no remote HTML or tracking pixels); safe clickable HTTPS/HTTP links
- No public self-registration, so strangers cannot claim an unprotected mailbox

## What you need to receive live emails

You need:

1. A domain you control, or an automatically assigned Resend inbound address for initial setup.
2. A [Resend](https://resend.com/features/inbound) account, a Resend API key, and an inbound webhook signing secret.
3. A host that runs **Node.js 22 or later**, offers a public HTTPS URL, and maintains a **persistent disk** for the SQLite file (e.g., a small VPS or a hosted container with a mounted volume).

There is no hardcoded production domain, API key, or password in this project. **Until the domain, Resend, HTTPS host, and mailbox have been configured, this is not an activated, reachable mail service.**

## Configure

1. Copy `.env.example` to `.env` and edit the values.
2. Configure receiving for your domain in **Resend > Domains / Receiving**. Follow its dashboard instructions to create the **MX DNS record**, and verify DNS. If you already use another mail provider on the root domain, choose a subdomain or you'll reroute existing incoming mail. Do not guess the MX hostname; use the one Resend provides.
3. Deploy to a service that supports Node 22+. Set environment variables (`MAIL_DOMAIN`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `NODE_ENV=production`, `PUBLIC_ORIGIN=https://mail.yourdomain.com`, `DB_PATH=/persistent-volume/tidalmail.sqlite`). A root-domain mail address such as `player@example.com` can be used with a website hosted at `mail.example.com`.
4. In **Resend > Webhooks**, add a webhook with the `email.received` event pointing to:

   `https://mail.yourdomain.com/webhooks/resend`

   Copy the resulting signing secret into `RESEND_WEBHOOK_SECRET` on your host, then restart the server. Do **not** put your secrets into public JavaScript.
5. Create a mailbox for your address, from a terminal on the server, preferably on the persistent data volume:

   ```bash
   npm run add-mailbox -- player@yourdomain.com
   ```

   Enter a strong, unique password (at least 12 characters). The password isn't stored in plain text and is not echoed in a terminal.
6. Start it: `npm start`. Visit your public HTTPS website, sign in as the mailbox owner, and send a test email from a separate real email account to the mailbox. It should show up in the inbox.

### Try locally

Requires Node 22+. No `npm install` is necessary: this version uses Node's built-in HTTP, cryptography and SQLite support. SQLite in some Node 22 versions may print an experimental warning (this is expected).

```bash
cp .env.example .env
# Edit MAIL_DOMAIN and PUBLIC_ORIGIN before use.
npm run add-mailbox -- player@example.com
npm start
```

Open http://localhost:3000 and sign in. Your inbox starts empty until the configured mail webhook actually receives emails. You can run integration tests using `npm test` without Resend credentials.

### How it receives emails

`User sends email → your domain's MX routes to Resend → signed webhook → your Node server verifies it → retrieves body via Resend Receiving API → stores a copy in SQLite linked to the mailbox → browser refresh displays it.`

Only registered mailbox addresses are stored. A recipient without a provisioned mailbox is ignored. Multiple registered addresses can share the same receiving domain, but mailbox owners cannot browse one another's messages.

## Security and operations checklist

- Use HTTPS and `NODE_ENV=production`. Set `PUBLIC_ORIGIN` to your precise HTTPS origin so cross-origin state-changing requests are rejected.
- Mount `DB_PATH` on a **persistent volume**. SQLite files stored in ephemeral containers will be lost on redeploy. Back up your volume securely, including the SQLite WAL files when relevant.
- Keep `.env`, Resend keys, webhook secret, and database backups private.
- Restrict access to the server's administration shell and the `add-mailbox` script. This starter **does not** include a public registration or admin management dashboard.
- Configure your service with reasonable request limits, abuse/spam handling, and privacy/retention policies before opening it to the public.
- Some websites refuse certain domains or disposable addresses. No mail platform can promise universal acceptance by Minecraft, Microsoft, OpenAI, or other providers.
- Messages are displayed as text for safety. Attachments, sending/replies, custom domains per user, MFA, password resets, administrator interface, horizontal scaling and advanced spam filters are *not included*. Use external managed services for these before offering a large public product.
- Resend has its own retention/usage limits; check the current plan terms. This code makes a local copy of each received message, so you control that copy's retention.

## Troubleshooting

- **Nothing arrives:** Check MX records at your DNS host, verify Resend received the message in its dashboard, check your webhook URL and event, and view server logs for `401` or `500` errors. A `401` generally means `RESEND_WEBHOOK_SECRET` doesn't match.
- **Bad login:** Ensure you created that exact email mailbox and you're using its locally created password (not your Microsoft/ChatGPT password).
- **Works locally, resets on deploy:** Ensure `DB_PATH` points to mounted persistent storage.
- **Webhook says unregistered recipient:** Create the mailbox first with the exact incoming address.

## Official references

- [Resend: inbound emails](https://resend.com/features/inbound)
- [Resend: webhooks](https://resend.com/features/webhooks)
- [Svix: signature verification](https://www.svix.com/guides/receiving/receive-webhooks-with-javascript-express/)
