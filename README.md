# TidalMail 🌊

A custom private email inbox website for **lb000.xyz**, styled with an underwater theme. This repository includes the complete frontend and a receiving-email backend.

**Status:** Source code uploaded to GitHub. **Not yet deployed/configured for live email.**

## Project folders

- [cloudflare-pages/](cloudflare-pages/) — Cloudflare Pages UI and same-origin proxy.
- [cloudflare-worker/](cloudflare-worker/) — alternative Worker frontend/proxy. Choose this **or** Pages.
- [backend/](backend/) — Node.js 22+ / SQLite private mailboxes, login, messages and signed Resend inbound webhooks.
- [SETUP.md](SETUP.md) — full instructions for Cloudflare DNS, Railway, Resend and testing.

## Deployment at a glance

1. **Railway**: Deploy this GitHub repo with root directory **`/backend`**, run `npm start` and mount a **persistent volume at `/data`**.
2. In Railway's **Variables**, set `NODE_ENV=production`, `MAIL_DOMAIN=lb000.xyz` (or an inbound subdomain), `PUBLIC_ORIGIN=https://mail.lb000.xyz`, `DB_PATH=/data/tidalmail.sqlite`, and the **private** `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`. Set no real secrets in GitHub files.
3. **Cloudflare Pages**: Deploy `/cloudflare-pages` as the root directory with static output **`public`**. Set the runtime `BACKEND_ORIGIN` variable to Railway's actual HTTPS service URL. Attach `mail.lb000.xyz` only if it isn't already attached to another project.
4. **Cloudflare DNS / Resend**: Verify the receiving domain and use **exactly** the MX and verification records from Resend. **Do not replace existing MX records** used by another mail provider; use a receiving subdomain instead if needed.
5. Configure the signed `email.received` webhook to `https://mail.lb000.xyz/webhooks/resend`.
6. Create your first mailbox on the Railway backend with `npm run add-mailbox -- player@lb000.xyz` (or the chosen receiving subdomain) and test delivery from an outside email account.

Full detail, troubleshooting and security notes: **[SETUP.md](SETUP.md)**.

## Local backend test

```bash
cd backend
npm test
```

## Important

- Receiving real email requires successful domain verification, backend deployment, secure mailbox creation, and an active Resend webhook. GitHub alone doesn't receive mail.
- This is a starter for private inboxes, not a production-hardened mass public disposable-email service. No outgoing mail, attachments, public signup, password recovery or MFA.
- Never commit real `.env` files, live keys or passwords to this repository. Since this repository is **public**, review its visibility before adding sensitive changes.
