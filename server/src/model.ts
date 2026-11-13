import { z } from 'zod';
import type { FamilyData, Person, Tree } from './types.js';

const date = z
  .string()
  .trim()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'Use YYYY, YYYY-MM or YYYY-MM-DD')
  .optional()
  .or(z.literal('').transform(() => undefined));
const text = (max: number) => z.string().trim().max(max).optional();
const event = z.object({ date, place: text(120) }).partial().optional();
const triState = z.boolean().nullable().default(null);

/** Fields an admin may edit on a person. Relationships are validated separately. */
export const PersonInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  gender: z.enum(['M', 'F', '']).optional(),
  birth: event,
  death: event,
  address: text(300),
  bio: text(5000),
  notes: text(2000),
  parents: z.array(z.string()).max(2).optional(),
  spouses: z.array(z.object({ id: z.string(), married: date })).max(6).optional(),
  show: z.object({ dob: triState, address: triState }).default({ dob: null, address: null }),
});
export type PersonInput = z.infer<typeof PersonInput>;

export const TreeInput = z.object({
  title: z.string().trim().min(1).max(80),
  root: z.string().min(1),
  visible: z.boolean().default(true),
  show: z.object({ dob: z.boolean(), address: z.boolean() }).default({ dob: false, address: false }),
});

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function clean<T extends object>(o: T | undefined): T | undefined {
  if (!o) return undefined;
  const entries = Object.entries(o).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

export function nextPersonId(data: FamilyData): string {
  let max = 0;
  for (const id of Object.keys(data.people)) {
    const n = parseInt(id.replace(/^P/, ''), 10);
    if (!isNaN(n)) max = Math.max(max, n);
  }
  return 'P' + String(max + 1).padStart(4, '0');
}

function wouldCreateCycle(data: FamilyData, childId: string, parentId: string): boolean {
  // parentId must not be a descendant of childId
  const stack = [parentId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === childId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(data.people[id]?.parents ?? []));
  }
  return false;
}

function setSpouses(data: FamilyData, id: string, spouses: { id: string; married?: string }[]) {
  const before = new Set(data.people[id].spouses.map((s) => s.id));
  const after = new Map(spouses.filter((s) => s.id !== id && data.people[s.id]).map((s) => [s.id, s]));
  data.people[id].spouses = [...after.values()].map((s) => clean(s) as { id: string; married?: string });
  // keep both sides in sync
  for (const old of before) {
    if (!after.has(old) && data.people[old]) {
      data.people[old].spouses = data.people[old].spouses.filter((s) => s.id !== id);
    }
  }
  for (const s of after.values()) {
    const other = data.people[s.id];
    const existing = other.spouses.find((x) => x.id === id);
    if (existing) existing.married = s.married;
    else other.spouses.push(clean({ id, married: s.married }) as { id: string });
  }
}

function applyFields(data: FamilyData, id: string, input: PersonInput) {
  const prev = data.people[id];
  const p: Person = {
    name: input.name,
    gender: input.gender || undefined,
    birth: clean(input.birth),
    death: clean(input.death),
    address: input.address || undefined,
    bio: input.bio || undefined,
    notes: input.notes || undefined,
    photo: prev?.photo,
    parents: prev?.parents ?? [],
    spouses: prev?.spouses ?? [],
    show: input.show,
  };
  data.people[id] = JSON.parse(JSON.stringify(p)); // drops undefined keys
  if (input.parents) {
    const parents = [...new Set(input.parents)].filter((pid) => pid !== id);
    for (const pid of parents) {
      if (!data.people[pid]) throw new HttpError(400, `Unknown parent ${pid}`);
      if (wouldCreateCycle(data, id, pid)) throw new HttpError(400, 'A person cannot be their own ancestor');
    }
    data.people[id].parents = parents;
  }
  if (input.spouses) setSpouses(data, id, input.spouses);
}

export function updatePerson(data: FamilyData, id: string, body: unknown) {
  if (!data.people[id]) throw new HttpError(404, 'Person not found');
  applyFields(data, id, PersonInput.parse(body));
}

/** Add a new person, optionally as a child / spouse / parent of an existing person. */
export function addPerson(
  data: FamilyData,
  body: unknown,
  relation?: { type: 'child' | 'spouse' | 'parent'; of: string },
): string {
  const input = PersonInput.parse(body);
  const id = nextPersonId(data);
  data.people[id] = { name: input.name, parents: [], spouses: [], show: { dob: null, address: null } };
  applyFields(data, id, input);
  if (relation) {
    const other = data.people[relation.of];
    if (!other) throw new HttpError(400, 'Unknown relative');
    if (relation.type === 'child') {
      // child of the person and (if exactly one) their spouse
      const parents = [relation.of, ...(other.spouses.length === 1 ? [other.spouses[0].id] : [])];
      data.people[id].parents = parents;
    } else if (relation.type === 'spouse') {
      setSpouses(data, id, [{ id: relation.of }]);
    } else if (relation.type === 'parent') {
      if (other.parents.length >= 2) throw new HttpError(400, 'This person already has two parents');
      other.parents.push(id);
      // a second parent becomes the spouse of the first
      if (other.parents.length === 2) {
        const first = other.parents[0];
        if (!data.people[first].spouses.some((s) => s.id === id)) setSpouses(data, id, [{ id: first }]);
      }
    }
  }
  return id;
}

export function deletePerson(data: FamilyData, id: string) {
  if (!data.people[id]) throw new HttpError(404, 'Person not found');
  const usedAsRoot = data.trees.find((t) => t.root === id);
  if (usedAsRoot) throw new HttpError(400, `This person is the top of the tree "${usedAsRoot.title}". Change the tree first.`);
  const photo = data.people[id].photo;
  delete data.people[id];
  for (const p of Object.values(data.people)) {
    p.parents = p.parents.filter((x) => x !== id);
    p.spouses = p.spouses.filter((s) => s.id !== id);
  }
  return photo;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tree';
}

export function addTree(data: FamilyData, body: unknown): string {
  const t = TreeInput.parse(body);
  if (!data.people[t.root]) throw new HttpError(400, 'Top person not found');
  let id = slug(t.title);
  let n = 2;
  while (data.trees.some((x) => x.id === id)) id = `${slug(t.title)}-${n++}`;
  const order = Math.max(-1, ...data.trees.map((x) => x.order)) + 1;
  data.trees.push({ id, order, ...t });
  return id;
}

export function updateTree(data: FamilyData, id: string, body: unknown) {
  const tree = data.trees.find((t) => t.id === id);
  if (!tree) throw new HttpError(404, 'Tree not found');
  const t = TreeInput.parse(body);
  if (!data.people[t.root]) throw new HttpError(400, 'Top person not found');
  Object.assign(tree, t);
}

export function deleteTree(data: FamilyData, id: string) {
  const before = data.trees.length;
  data.trees = data.trees.filter((t) => t.id !== id);
  if (data.trees.length === before) throw new HttpError(404, 'Tree not found');
}

export function reorderTrees(data: FamilyData, ids: unknown) {
  const list = z.array(z.string()).parse(ids);
  list.forEach((id, i) => {
    const t = data.trees.find((x) => x.id === id);
    if (t) t.order = i;
  });
  data.trees.sort((a, b) => a.order - b.order);
}

export type { Tree };
