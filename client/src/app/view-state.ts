import { Injectable, signal } from '@angular/core';

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode etc. - ignore */
  }
}

/** What this visitor has open: current tree, selected person, expanded nodes (remembered per browser). */
@Injectable({ providedIn: 'root' })
export class ViewState {
  readonly treeId = signal<string | null>(load('kv.tree', null));
  readonly selected = signal<string | null>(null);
  readonly editing = signal(false);
  readonly showLogin = signal(false);
  private expandedByTree = signal<Record<string, string[] | undefined>>(load('kv.expanded', {}));

  setTree(id: string) {
    this.treeId.set(id);
    save('kv.tree', id);
  }

  select(id: string | null, edit = false) {
    this.selected.set(id);
    this.editing.set(edit);
  }

  /** undefined = never touched this tree yet (use default depth) */
  expanded(treeId: string): Set<string> | undefined {
    const list = this.expandedByTree()[treeId];
    return list ? new Set(list) : undefined;
  }

  setExpanded(treeId: string, ids: Iterable<string>) {
    const next = { ...this.expandedByTree(), [treeId]: [...new Set(ids)] };
    this.expandedByTree.set(next);
    save('kv.expanded', next);
  }
}
