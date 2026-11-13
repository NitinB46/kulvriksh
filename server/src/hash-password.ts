import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

// Usage: npm run hash-password            (asks for the password)
//        npm run hash-password -- "secret" (non-interactive)
let pw = process.argv[2];
if (!pw) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  pw = await rl.question('New admin password: ');
  rl.close();
}
if (!pw || pw.length < 8) {
  console.error('Please use at least 8 characters.');
  process.exit(1);
}
const hash = await bcrypt.hash(pw, 12);
console.log('\nPut these lines in server/.env (replace the old ones):\n');
// single quotes keep the $ signs in the hash exactly as they are
console.log(`ADMIN_PASSWORD_HASH='${hash}'`);
console.log(`SESSION_SECRET=${randomBytes(32).toString('hex')}`);
