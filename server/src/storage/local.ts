import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FamilyData } from '../types.js';
import type { Storage } from './storage.js';

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const KEEP_HISTORY = 50;

/**
 * Atomic replace. On Windows, rename can fail for a moment (EPERM/EBUSY/EACCES)
 * while antivirus, OneDrive or an editor has tree.json open, so retry, then fall back to a copy.
 */
async function replaceFile(tmp: string, target: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(tmp, target);
    } catch (e: any) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      if (attempt >= 8) {
        await fs.copyFile(tmp, target);
        await fs.rm(tmp, { force: true });
        return;
      }
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

/** Stores tree.json and photos/ in a folder on disk. Keeps the last 50 versions in history/. */
export class LocalStorage implements Storage {
  constructor(private dir: string) {}

  private get dataFile() {
    return path.join(this.dir, 'tree.json');
  }
  private photoPath(name: string) {
    if (!SAFE_NAME.test(name)) throw new Error('Invalid photo name');
    return path.join(this.dir, 'photos', name);
  }

  async readData(): Promise<FamilyData> {
    try {
      return JSON.parse(await fs.readFile(this.dataFile, 'utf8')) as FamilyData;
    } catch (e: any) {
      if (e.code === 'ENOENT') return { version: 0, trees: [], people: {} };
      throw e;
    }
  }

  async writeData(data: FamilyData): Promise<void> {
    await fs.mkdir(path.join(this.dir, 'history'), { recursive: true });
    const json = JSON.stringify(data, null, 1);
    const tmp = this.dataFile + '.tmp';
    await fs.writeFile(tmp, json, 'utf8');
    await replaceFile(tmp, this.dataFile);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(path.join(this.dir, 'history', `tree-v${data.version}-${stamp}.json`), json, 'utf8');
    const files = (await fs.readdir(path.join(this.dir, 'history'))).sort();
    for (const old of files.slice(0, Math.max(0, files.length - KEEP_HISTORY))) {
      await fs.rm(path.join(this.dir, 'history', old), { force: true });
    }
  }

  async savePhoto(name: string, bytes: Buffer) {
    await fs.mkdir(path.join(this.dir, 'photos'), { recursive: true });
    await fs.writeFile(this.photoPath(name), bytes);
  }

  async readPhoto(name: string) {
    try {
      return await fs.readFile(this.photoPath(name));
    } catch {
      return null;
    }
  }

  async deletePhoto(name: string) {
    await fs.rm(this.photoPath(name), { force: true });
  }

  async listPhotos() {
    try {
      return await fs.readdir(path.join(this.dir, 'photos'));
    } catch {
      return [];
    }
  }
}
