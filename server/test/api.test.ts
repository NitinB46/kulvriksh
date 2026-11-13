import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { LocalStorage } from '../src/storage/local.js';
import type { FamilyData } from '../src/types.js';

const PASSWORD = 'test-password-123';
let app: ReturnType<typeof createApp>;

const seed: FamilyData = {
  version: 1,
  trees: [
    { id: 'main', title: 'Main', root: 'P0001', order: 0, visible: true, show: { dob: false, address: false } },
    { id: 'branch', title: 'Branch', root: 'P0003', order: 1, visible: true, show: { dob: true, address: false } },
    { id: 'secret', title: 'Hidden', root: 'P0001', order: 2, visible: false, show: { dob: false, address: false } },
  ],
  people: {
    P0001: { name: 'Grandpa', birth: { date: '1900-01-01', place: 'Delhi' }, address: 'Old house', parents: [], spouses: [{ id: 'P0002' }], show: { dob: null, address: null } },
    P0002: { name: 'Grandma', birth: { date: '1905' }, parents: [], spouses: [{ id: 'P0001' }], show: { dob: true, address: null } },
    P0003: { name: 'Son', birth: { date: '1930-05-05' }, address: 'Street 1', parents: ['P0001', 'P0002'], spouses: [], show: { dob: null, address: true } },
    P0004: { name: 'Grandson', birth: { date: '1960-06-06' }, parents: ['P0003'], spouses: [], show: { dob: false, address: null } },
  },
};

before(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kv-'));
  writeFileSync(path.join(dir, 'tree.json'), JSON.stringify(seed));
  app = createApp({
    storage: new LocalStorage(dir),
    adminPasswordHash: await bcrypt.hash(PASSWORD, 4),
    sessionSecret: 'x'.repeat(40),
  });
});

async function admin() {
  const agent = request.agent(app);
  await agent.post('/api/login').send({ password: PASSWORD }).expect(200);
  return agent;
}

test('visitors never receive hidden DOB or address', async () => {
  const res = await request(app).get('/api/data').expect(200);
  const p = res.body.people;
  assert.equal(p.P0001.birth.date, undefined, 'hidden by default');
  assert.equal(p.P0001.birth.place, 'Delhi', 'places stay public');
  assert.equal(p.P0001.address, undefined);
  assert.equal(p.P0002.birth.date, '1905', 'person-level show wins');
  assert.equal(p.P0003.birth.date, '1930-05-05', 'tree-level show applies');
  assert.equal(p.P0003.address, 'Street 1', 'person-level address');
  assert.equal(p.P0004.birth.date, undefined, 'person-level hide beats tree-level show');
  assert.ok(!JSON.stringify(res.body).includes('Old house'));
  assert.deepEqual(res.body.trees.map((t: any) => t.id), ['main', 'branch'], 'hidden tree not listed');
});

test('wrong password is rejected and writes need login', async () => {
  await request(app).post('/api/login').send({ password: 'nope' }).expect(401);
  await request(app).put('/api/people/P0001').send({ person: { name: 'Hacked' } }).expect(401);
  await request(app).post('/api/people').send({ person: { name: 'X' } }).expect(401);
});

test('admin sees everything and can edit, add and delete', async () => {
  const a = await admin();
  let res = await a.get('/api/data').expect(200);
  assert.equal(res.body.people.P0001.address, 'Old house');
  const v = res.body.version;

  await a.put('/api/people/P0004').send({ baseVersion: v, person: { name: 'Grandson Jr', birth: { date: '1960-06-06' }, parents: ['P0003'], show: { dob: null, address: null } } }).expect(200);
  res = await a.post('/api/people').send({ person: { name: 'Baby' }, relation: { type: 'child', of: 'P0004' } }).expect(201);
  const baby = res.body.id;
  res = await a.post('/api/people').send({ person: { name: 'Wife' }, relation: { type: 'spouse', of: 'P0004' } }).expect(201);
  const data = (await a.get('/api/data')).body;
  assert.equal(data.people.P0004.name, 'Grandson Jr');
  assert.deepEqual(data.people[baby].parents, ['P0004']);
  assert.equal(data.people.P0004.spouses[0].id, res.body.id, 'spouse link is two-way');
  await a.delete(`/api/people/${baby}`).send({}).expect(200);
  assert.equal((await a.get('/api/data')).body.people[baby], undefined);
});

test('stale saves are refused instead of overwriting', async () => {
  const a = await admin();
  await a.put('/api/people/P0001').send({ baseVersion: 1, person: { name: 'Old copy' } }).expect(409);
});

test('bad input is rejected', async () => {
  const a = await admin();
  await a.put('/api/people/P0001').send({ person: { name: '' } }).expect(400);
  await a.put('/api/people/P0001').send({ person: { name: 'A', birth: { date: '12/12/1900' } } }).expect(400);
  await a.put('/api/people/P0001').send({ person: { name: 'Grandpa', parents: ['P0004'] } }).expect(400); // cycle
  await a.delete('/api/people/P0001').send({}).expect(400); // tree root
});

test('photo upload is re-encoded; non-images are refused', async () => {
  const a = await admin();
  const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#c33' } }).png().toBuffer();
  const res = await a.post('/api/people/P0003/photo').attach('photo', png, { filename: 'x.png', contentType: 'image/png' }).expect(200);
  const img = await request(app).get('/' + res.body.photo).expect(200);
  const meta = await sharp(img.body).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 800);
  await a.post('/api/people/P0003/photo').attach('photo', Buffer.from('<script>'), { filename: 'x.html', contentType: 'text/html' }).expect(400);
  await a.post('/api/people/P0003/photo').attach('photo', Buffer.from('not really'), { filename: 'x.jpg', contentType: 'image/jpeg' }).expect(400);
});

test('trees can be added, updated and hidden', async () => {
  const a = await admin();
  const res = await a.post('/api/trees').send({ tree: { title: 'New Tree', root: 'P0003' } }).expect(201);
  await a.put(`/api/trees/${res.body.id}`).send({ tree: { title: 'Renamed', root: 'P0003', visible: false, show: { dob: true, address: true } } }).expect(200);
  const pub = (await request(app).get('/api/data')).body;
  assert.ok(!pub.trees.some((t: any) => t.title === 'Renamed'));
});

test('logout ends the admin session', async () => {
  const a = await admin();
  await a.post('/api/logout').expect(200);
  assert.equal((await a.get('/api/session')).body.admin, false);
});
