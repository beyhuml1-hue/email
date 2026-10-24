import { randomBytes } from 'node:crypto';

try { process.loadEnvFile('.env'); } catch {}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: npm run bot -- [mailbox-name] [--json]\nCreates one mailbox with a generated password. Run on the mail backend with MAIL_DOMAIN and DB_PATH configured.');
  process.exit(0);
}
const names = args.filter(arg => arg !== '--json');
if (names.length > 1 || names.some(arg => arg.startsWith('-'))) {
  console.error('Usage: npm run bot -- [mailbox-name] [--json]');
  process.exit(1);
}
const domain = (process.env.MAIL_DOMAIN || '').trim().toLowerCase();
if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
  console.error('Set MAIL_DOMAIN to your configured receiving domain before creating a mailbox.');
  process.exit(1);
}
const name = names[0]?.toLowerCase() || 'inbox-' + randomBytes(8).toString('hex');
if (!/^[a-z0-9][a-z0-9._+-]{0,63}$/.test(name)) {
  console.error('Use a mailbox name of 1–64 letters, numbers, dots, underscores, plus signs or hyphens; start with a letter or number.');
  process.exit(1);
}
const email = `${name}@${domain}`;
if (email.length > 254) { console.error('The mailbox address is too long.'); process.exit(1); }
const password = randomBytes(24).toString('base64url');
let db;
try {
  const store = await import('../db.mjs');
  db = store.db;
  // A duplicate fails without replacing its password, messages or sessions.
  db.prepare('INSERT INTO mailboxes (email,password_hash) VALUES (?,?)').run(email, store.hashPassword(password));
  const result = { email, password, signInUrl: process.env.PUBLIC_ORIGIN || 'http://localhost:3000' };
  if (args.includes('--json')) console.log(JSON.stringify(result));
  else console.log(`Mailbox created\nEmail: ${result.email}\nPassword: ${result.password}\nSign in: ${result.signInUrl}\n\nSave these details privately. The password is shown only now.\nReceiving email also requires your domain and inbound webhook to be configured.`);
} catch (error) {
  console.error(error.code?.includes('CONSTRAINT') || error.message?.includes('UNIQUE constraint') ? 'That mailbox already exists. Choose another name.' : 'Could not create the mailbox. Check DB_PATH and database permissions.');
  process.exitCode = 1;
} finally { db?.close(); }
