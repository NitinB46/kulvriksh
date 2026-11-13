import express, { type NextFunction, type Request, type Response } from 'express';
import cookieSession from 'cookie-session';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import { ZipArchive } from 'archiver';
import { ZodError } from 'zod';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { Storage } from './storage/storage.js';
import type { FamilyData } from './types.js';
import { publicView } from './privacy.js';
import * as model from './model.js';

export interface AppOptions {
  storage: Storage;
  adminPasswordHash: string;
  sessionSecret: string;
  secureCookies?: boolean;
  clientDir?: string; // built Angular app to serve in production
}

declare module 'express-serve-static-core' {
  interface Request {
    session?: { admin?: boolean; at?: number } | null;
  }
}

const SESSION_HOURS = 8;

export function createApp(opts: AppOptions) {
  const { storage } = opts;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          // only force https when the site is really served over https
          upgradeInsecureRequests: opts.secureCookies ? [] : null,
        },
      },
      strictTransportSecurity: opts.secureCookies ? undefined : false,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(
    cookieSession({
      name: 'kv_session',
      keys: [opts.sessionSecret],
      httpOnly: true,
      sameSite: 'strict',
      secure: !!opts.secureCookies,
      maxAge: SESSION_HOURS * 3600 * 1000,
    }),
  );

  // One write at a time, so two saves can never interleave.
  let queue: Promise<unknown> = Promise.resolve();
  function mutate<T>(baseVersion: unknown, fn: (d: FamilyData) => T | Promise<T>): Promise<{ result: T; data: FamilyData }> {
    const run = queue.then(async () => {
      const data = await storage.readData();
      if (typeof baseVersion === 'number' && baseVersion !== data.version) {
        throw new model.HttpError(409, 'Someone else changed the tree. Reload and try again.');
      }
      const result = await fn(data);
      data.version += 1;
      await storage.writeData(data);
      console.log(`${new Date().toLocaleTimeString()}  saved tree.json (version ${data.version})`);
      return { result, data };
    });
    queue = run.catch(() => undefined);
    return run;
  }

  const isAdmin = (req: Request) => !!req.session?.admin;
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Please log in as admin' });
    // CSRF guard: admin writes must be same-origin JSON / form-data from our own page
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
      return res.status(403).json({ error: 'Cross-site request blocked' });
    }
    next();
  };
  const wrap =
    (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).catch(next);

  // ---------- auth ----------
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again in 15 minutes.' } });

  app.post('/api/login', loginLimiter, wrap(async (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const ok = password.length > 0 && password.length < 200 && (await bcrypt.compare(password, opts.adminPasswordHash));
    if (!ok) return res.status(401).json({ error: 'Wrong password' });
    req.session = { admin: true, at: Date.now() };
    res.json({ admin: true });
  }));
  app.post('/api/logout', (req, res) => {
    req.session = null;
    res.json({ admin: false });
  });
  app.get('/api/session', (req, res) => res.json({ admin: isAdmin(req) }));

  // ---------- read ----------
  app.get('/api/data', wrap(async (req, res) => {
    const data = await storage.readData();
    res.set('Cache-Control', 'no-store');
    res.json(isAdmin(req) ? data : publicView(data));
  }));

  app.get('/photos/:name', wrap(async (req, res) => {
    const name = String(req.params.name);
    if (!/^[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i.test(name)) return res.status(404).end();
    const bytes = await storage.readPhoto(name);
    if (!bytes) return res.status(404).end();
    res.type(path.extname(name)).set('Cache-Control', 'public, max-age=3600').send(bytes);
  }));

  // ---------- people ----------
  app.post('/api/people', requireAdmin, wrap(async (req, res) => {
    const { person, relation, baseVersion } = req.body ?? {};
    const { result, data } = await mutate(baseVersion, (d) => model.addPerson(d, person, relation));
    res.status(201).json({ id: result, version: data.version });
  }));
  app.put('/api/people/:id', requireAdmin, wrap(async (req, res) => {
    const { person, baseVersion } = req.body ?? {};
    const { data } = await mutate(baseVersion, (d) => model.updatePerson(d, String(req.params.id), person));
    res.json({ version: data.version });
  }));
  app.delete('/api/people/:id', requireAdmin, wrap(async (req, res) => {
    const { data, result } = await mutate(req.body?.baseVersion, (d) => model.deletePerson(d, String(req.params.id)));
    if (result) await storage.deletePhoto(path.basename(result)).catch(() => undefined);
    res.json({ version: data.version });
  }));

  // ---------- photos ----------
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
  });
  app.post('/api/people/:id/photo', requireAdmin, upload.single('photo'), wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!/^P\d+$/.test(id)) return res.status(400).json({ error: 'Bad id' });
    if (!req.file) return res.status(400).json({ error: 'Please choose a JPEG, PNG or WebP image (max 8 MB)' });
    let jpeg: Buffer;
    try {
      // re-encode: strips anything hidden in the file, fixes rotation, limits size
      jpeg = await sharp(req.file.buffer).rotate().resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 }).toBuffer();
    } catch {
      return res.status(400).json({ error: 'That file is not a valid image' });
    }
    const name = `${id}-${Date.now()}.jpg`;
    let old: string | undefined;
    const { data } = await mutate(undefined, async (d) => {
      if (!d.people[id]) throw new model.HttpError(404, 'Person not found');
      await storage.savePhoto(name, jpeg);
      old = d.people[id].photo;
      d.people[id].photo = `photos/${name}`;
    });
    if (old && path.basename(old).startsWith(id + '-')) await storage.deletePhoto(path.basename(old)).catch(() => undefined);
    res.json({ photo: `photos/${name}`, version: data.version });
  }));
  app.delete('/api/people/:id/photo', requireAdmin, wrap(async (req, res) => {
    const id = String(req.params.id);
    const { data } = await mutate(undefined, (d) => {
      if (!d.people[id]) throw new model.HttpError(404, 'Person not found');
      delete d.people[id].photo;
    });
    res.json({ version: data.version });
  }));

  // ---------- trees ----------
  app.post('/api/trees', requireAdmin, wrap(async (req, res) => {
    const { result, data } = await mutate(req.body?.baseVersion, (d) => model.addTree(d, req.body?.tree));
    res.status(201).json({ id: result, version: data.version });
  }));
  app.put('/api/trees/:id', requireAdmin, wrap(async (req, res) => {
    const { data } = await mutate(req.body?.baseVersion, (d) => model.updateTree(d, String(req.params.id), req.body?.tree));
    res.json({ version: data.version });
  }));
  app.delete('/api/trees/:id', requireAdmin, wrap(async (req, res) => {
    const { data } = await mutate(req.body?.baseVersion, (d) => model.deleteTree(d, String(req.params.id)));
    res.json({ version: data.version });
  }));
  app.put('/api/trees-order', requireAdmin, wrap(async (req, res) => {
    const { data } = await mutate(req.body?.baseVersion, (d) => model.reorderTrees(d, req.body?.ids));
    res.json({ version: data.version });
  }));

  // ---------- backup ----------
  app.get('/api/backup', requireAdmin, wrap(async (_req, res) => {
    const data = await storage.readData();
    res.attachment(`kulvriksh-backup-v${data.version}.zip`);
    const zip = new ZipArchive({ zlib: { level: 6 } });
    zip.pipe(res);
    zip.append(JSON.stringify(data, null, 1), { name: 'tree.json' });
    for (const name of await storage.listPhotos()) {
      const bytes = await storage.readPhoto(name);
      if (bytes) zip.append(bytes, { name: `photos/${name}` });
    }
    await zip.finalize();
  }));

  // ---------- Angular app (production) ----------
  if (opts.clientDir && existsSync(opts.clientDir)) {
    app.use(express.static(opts.clientDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|photos\/).*/, (_req, res) => res.sendFile(path.join(opts.clientDir!, 'index.html')));
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // ---------- errors ----------
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ') });
    }
    if (err instanceof model.HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    // Admins get the technical reason, so a failed save can be diagnosed from the message.
    const detail = isAdmin(_req) && (err?.code || err?.message) ? ` (${err.code ?? err.message})` : '';
    res.status(500).json({ error: `Something went wrong on the server${detail}. Please try again.` });
  });

  return app;
}
