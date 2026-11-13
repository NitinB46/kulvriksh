import type { FamilyData, Person } from './types.js';

export function childrenIndex(data: FamilyData): Map<string, string[]> {
  const kids = new Map<string, string[]>();
  for (const [id, p] of Object.entries(data.people)) {
    for (const parent of p.parents) {
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent)!.push(id);
    }
  }
  return kids;
}

/** People shown in a tree: the root, everyone descended from it, and their spouses. */
export function treeMembers(data: FamilyData, rootId: string, kids = childrenIndex(data)): Set<string> {
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id) || !data.people[id]) continue;
    out.add(id);
    for (const s of data.people[id].spouses) out.add(s.id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}

/**
 * Decide whether DOB / address may be shown for each person.
 * Person setting wins; otherwise any tree containing the person that has the field switched on;
 * otherwise hidden.
 */
export function visibility(data: FamilyData): Map<string, { dob: boolean; address: boolean }> {
  const kids = childrenIndex(data);
  const treeShow = new Map<string, { dob: boolean; address: boolean }>();
  for (const t of data.trees) {
    if (!t.show.dob && !t.show.address) continue;
    for (const id of treeMembers(data, t.root, kids)) {
      const cur = treeShow.get(id) ?? { dob: false, address: false };
      treeShow.set(id, { dob: cur.dob || t.show.dob, address: cur.address || t.show.address });
    }
  }
  const out = new Map<string, { dob: boolean; address: boolean }>();
  for (const [id, p] of Object.entries(data.people)) {
    const t = treeShow.get(id) ?? { dob: false, address: false };
    out.set(id, {
      dob: p.show?.dob ?? t.dob,
      address: p.show?.address ?? t.address,
    });
  }
  return out;
}

/** Copy of the data that is safe to send to visitors: hidden fields are removed, not just flagged. */
export function publicView(data: FamilyData): FamilyData {
  const vis = visibility(data);
  const people: Record<string, Person> = {};
  for (const [id, p] of Object.entries(data.people)) {
    const v = vis.get(id)!;
    const q: Person = { ...p, show: { dob: null, address: null } };
    if (!v.dob && q.birth) {
      q.birth = { ...q.birth };
      delete q.birth.date;
    }
    if (!v.address) delete q.address;
    people[id] = q;
  }
  return { version: data.version, trees: data.trees.filter((t) => t.visible), people };
}
