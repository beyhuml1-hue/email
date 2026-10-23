import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const dbFile = resolve(process.env.DB_PATH || './data/tidalmail.sqlite');
mkdirSync(dirname(dbFile), { recursive: true });
export const db = new DatabaseSync(dbFile);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS mailboxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    arrived_at TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    is_starred INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    UNIQUE (mailbox_id, provider_id)
  );
  CREATE INDEX IF NOT EXISTS messages_mailbox_date ON messages(mailbox_id, arrived_at DESC);
  CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires_at);
`);

export function normalizedEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9][a-z0-9._+\-]{0,63}@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) throw new Error('Invalid mailbox address');
  return email;
}
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('Password must contain at least 12 characters');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function matchesPassword(password, hash) {
  try {
    const [algo, salt, reference] = hash.split('$');
    if (algo !== 'scrypt' || !salt || !reference) return false;
    const ours = scryptSync(password, Buffer.from(salt, 'hex'), 64);
    const expected = Buffer.from(reference, 'hex');
    return expected.length === ours.length && timingSafeEqual(ours, expected);
  } catch { return false; }
}
export function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }
export function getMailboxFromToken(token) {
  if (!token || token.length > 150) return null;
  return db.prepare(`SELECT m.id, m.email FROM sessions s JOIN mailboxes m ON m.id=s.mailbox_id WHERE s.token_hash=? AND s.expires_at > ?`).get(hashToken(token), Date.now()) || null;
}
export function saveInbound(recipient, email) {
  let mailbox;
  try { mailbox = db.prepare('SELECT id FROM mailboxes WHERE email=?').get(normalizedEmail(recipient)); } catch { return false; }
  if (!mailbox) return false;
  const result = db.prepare(`INSERT OR IGNORE INTO messages (mailbox_id,provider_id,sender,recipient,subject,body,arrived_at)
    VALUES (?,?,?,?,?,?,?)`).run(mailbox.id, String(email.id), String(email.from || '(Unknown sender)').slice(0,512), normalizedEmail(recipient), String(email.subject || '(No subject)').slice(0,512), String(email.body || '').slice(0,500000), String(email.created_at || new Date().toISOString()));
  return result.changes > 0;
}
