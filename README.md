# TidalMail

A private mail site at https://email.lb000.xyz with eight animated WebGL biome styles, a three-column inbox, and server-protected mailbox administration.

## Current Cloudflare Worker architecture

- Root `wrangler.jsonc` deploys the existing `email` Worker and its static assets.
- The `DB` D1 binding stores mailbox password hashes, sessions, incoming messages and the global website style.
- `ADMIN_CODE` must be set as a private Cloudflare runtime secret. Never put real codes, passwords or tokens in source control.
- The admin console has a separate entry URL with no public navigation links. Access still requires the server-verified admin code and a short-lived HttpOnly cookie.
- Admins can generate mailboxes and passwords, browse all inboxes, trash/restore messages, revoke sessions, reset passwords, suspend/reactivate mailboxes and change the style for all visitors.
- Incoming email is processed by the Worker's native `email` handler using postal-mime. Configure Cloudflare Email Routing for the receiving domain, then route its catch-all to the `email` Worker. Unknown and suspended recipients are rejected.
- Existing MX records must be inspected before enabling or changing routing. Keep any specific routing rules needed by other services.
- No public signup, outgoing email or attachment viewing. Forwarding is explicitly shown as unavailable.

## Create an email with the bot

From the repository root, install Node.js 24+, run `npm ci`, and configure `ADMIN_CODE` in a private environment or ignored `.env` file. `MAIL_SITE_ORIGIN` defaults to the website above.

```bash
npm run bot
# Or choose the name:
npm run bot -- player
```

The bot creates an account on the deployed site and displays its generated email and password once. It does not store or commit credentials.

## Tests

```bash
npm ci
npm test
```

Tests cover server-side admin authentication, site-wide style settings, mailbox provisioning, message ownership, session revocation, password changes and real MIME stream decoding with duplicate protection. Fixture emails are test-only and are never deployed as user messages.

## Alternative backend

`backend/` retains the earlier Node/SQLite + Resend backend and its separate tests (`npm test --prefix backend`). `cloudflare-pages/` retains the alternative Pages frontend. The live Worker uses native D1 when `BACKEND_ORIGIN` is absent. Setting `BACKEND_ORIGIN` opts back into the legacy backend and does not migrate its database.

No service can guarantee that Microsoft, ChatGPT or every other website accepts a particular email domain. Incoming delivery and site acceptance are separate checks.
