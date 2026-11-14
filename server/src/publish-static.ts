/**
 * Builds a read-only copy of the public site into ./public-site, for a static host
 * (Firebase Hosting or a Cloud Storage bucket). Run: npm run publish-static
 *
 * - Data is privacy-filtered exactly like the live server does for visitors, so hidden
 *   dates of birth, addresses and hidden trees never leave your PC.
 * - Only photos of people who appear in the public data are copied.
 * - The admin login is hidden; keep editing on your PC and publish again to update.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalStorage } from './storage/local.js';
import { publicView } from './privacy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = path.resolve(root, process.env.DATA_DIR ?? 'data');
const clientDir = path.resolve(root, 'client', 'dist', 'client', 'browser');
const out = path.resolve(root, 'public-site');

const data = publicView(await new LocalStorage(dataDir).readData());

await fs.rm(out, { recursive: true, force: true });
await fs.cp(clientDir, out, { recursive: true });
await fs.mkdir(path.join(out, 'api'), { recursive: true });
await fs.writeFile(path.join(out, 'api', 'data'), JSON.stringify(data));
await fs.writeFile(path.join(out, 'api', 'session'), JSON.stringify({ admin: false, readOnly: true }));

await fs.mkdir(path.join(out, 'photos'), { recursive: true });
let photos = 0;
for (const p of Object.values(data.people)) {
  if (!p.photo) continue;
  await fs.copyFile(path.join(dataDir, p.photo), path.join(out, p.photo));
  photos++;
}
console.log(`Public site written to ${out}: ${Object.keys(data.people).length} people, ${photos} photos.`);
