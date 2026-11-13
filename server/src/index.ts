import 'dotenv/config';
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { LocalStorage } from './storage/local.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const hash = process.env.ADMIN_PASSWORD_HASH;
const secret = process.env.SESSION_SECRET;
if (!hash || !secret || secret.length < 32) {
  console.error('Missing ADMIN_PASSWORD_HASH or SESSION_SECRET (32+ chars). Copy server/.env.example to server/.env.');
  process.exit(1);
}

const storageKind = process.env.STORAGE ?? 'local';
if (storageKind !== 'local') {
  console.error(`STORAGE=${storageKind} is not built yet in the prototype. Use STORAGE=local.`);
  process.exit(1);
}
const dataDir = path.resolve(root, process.env.DATA_DIR ?? 'data');
// First run only: start from the imported family data in seed-data/.
// After that, data/ holds your edits and is never replaced (the zip doesn't contain data/).
if (!existsSync(path.join(dataDir, 'tree.json'))) {
  const seed = path.resolve(root, 'seed-data');
  if (existsSync(path.join(seed, 'tree.json'))) {
    cpSync(seed, dataDir, { recursive: true });
    console.log(`Created ${dataDir} from seed-data (first run).`);
  }
}
const storage = new LocalStorage(dataDir);

const app = createApp({
  storage,
  adminPasswordHash: hash,
  sessionSecret: secret,
  secureCookies: process.env.NODE_ENV === 'production',
  clientDir: path.resolve(root, 'client', 'dist', 'client', 'browser'),
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Kulvriksh API running on http://localhost:${port}  (data folder: ${dataDir})`);
});
