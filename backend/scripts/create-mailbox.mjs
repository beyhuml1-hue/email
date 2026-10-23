import { createInterface } from 'node:readline';
try { process.loadEnvFile('.env'); } catch {}
const { db, hashPassword, normalizedEmail } = await import('../db.mjs');
const address = normalizedEmail(process.argv[2] || '');
const configured = (process.env.MAIL_DOMAIN || '').trim().toLowerCase();
if (configured && !address.endsWith('@'+configured)) {
  console.error(`Your mailbox must use the configured domain: ${configured}`); process.exit(1);
}
const rl=createInterface({ input:process.stdin, output:process.stdout });
const password=await new Promise(resolve => {
  // Mask password input on interactive terminals.
  if (process.stdin.isTTY) {
    process.stdout.write('Password (12+ characters): ');
    let buf='';
    const input=process.stdin;
    input.setRawMode(true);
    input.resume();
    const cb=char=> {
      const c=char.toString();
      if (c==='\r'||c==='\n') { input.setRawMode(false); input.off('data',cb); process.stdout.write('\n'); resolve(buf); }
      else if (c==='\u0003') {input.setRawMode(false); process.exit(130);}
      else if (c==='\u007f') {buf=buf.slice(0,-1);}
      else buf+=c;
    };
    input.on('data',cb);
  } else rl.question('Password (12+ characters): ', resolve);
});
rl.close();
try {
  const hash=hashPassword(password);
  db.prepare('INSERT INTO mailboxes (email,password_hash) VALUES (?,?)').run(address,hash);
  console.log(`Created private mailbox: ${address}`);
} catch (err) { console.error(err.message); process.exitCode=1; }
db.close();
