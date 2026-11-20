import { FamilyData, Person } from './models';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1889-01-02" -> "2 Jan 1889", "1889-01" -> "Jan 1889", "1889" -> "1889" */
export function formatDate(d?: string): string {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  if (day) return `${parseInt(day, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`;
  if (m) return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
  return y;
}

export function year(d?: string): string {
  return d ? d.slice(0, 4) : '';
}

/** Place shown on a card: where they died if they have passed away, otherwise where they were born. */
export function cardPlace(p: Person): string {
  const dead = !!(p.death?.date || p.death?.place);
  return (dead ? p.death?.place : p.birth?.place)?.trim() ?? '';
}

export function lifespan(p: Person): string {
  const b = year(p.birth?.date);
  const d = year(p.death?.date);
  if (b && d) return `${b} – ${d}`;
  if (b) return `b. ${b}`;
  if (d) return `d. ${d}`;
  return '';
}

export function initials(name: string): string {
  return name
    .replace(/\(.*?\)|\{.*?\}/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

export function childrenIndex(data: FamilyData): Map<string, string[]> {
  const kids = new Map<string, string[]>();
  for (const [id, p] of Object.entries(data.people)) {
    for (const parent of p.parents) {
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent)!.push(id);
    }
  }
  const birthKey = (id: string) => data.people[id]?.birth?.date ?? '9999';
  for (const list of kids.values()) {
    list.sort((a, b) => birthKey(a).localeCompare(birthKey(b)) || a.localeCompare(b));
  }
  return kids;
}

/** Everyone in a tree: the root, all descendants and their spouses. */
export function treeMembers(data: FamilyData, root: string, kids: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id) || !data.people[id]) continue;
    out.add(id);
    for (const s of data.people[id].spouses) out.add(s.id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}

export function label(data: FamilyData, id: string): string {
  const p = data.people[id];
  if (!p) return id;
  const ls = lifespan(p);
  return `${p.name}${ls ? ' (' + ls + ')' : ''} · ${id}`;
}
