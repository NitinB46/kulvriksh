import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from './api.service';
import { ViewState } from './view-state';
import { TreeView } from './tree-view';
import { PersonPanel } from './person-panel';
import { TreesManager } from './trees-manager';
import { Logo } from './logo';
import { lifespan, treeMembers } from './family';

@Component({
  selector: 'app-tree-page',
  imports: [FormsModule, RouterLink, TreeView, PersonPanel, TreesManager, Logo],
  templateUrl: './tree-page.html',
  host: { class: 'page tree-page' },
})
export class TreePage implements OnInit {
  /** optional tree id from the URL: /tree/:id */
  readonly id = input<string>();
  private router = inject(Router);
  protected api = inject(Api);
  protected view = inject(ViewState);
  protected lifespan = lifespan;

  protected loadError = signal(false);
  protected showManage = signal(false);
  protected showUnplaced = signal(false);
  protected query = signal('');
  protected menuOpen = signal(false);

  protected currentTree = computed(() => {
    const trees = this.api.trees();
    return trees.find((t) => t.id === this.view.treeId()) ?? trees[0] ?? null;
  });

  protected results = computed(() => {
    const q = this.query().trim().toLowerCase();
    const d = this.api.data();
    if (q.length < 2 || !d) return [];
    return Object.entries(d.people)
      .filter(([, p]) => p.name.toLowerCase().includes(q))
      .slice(0, 12)
      .map(([id, p]) => ({ id, p }));
  });

  /** People that are not in any tree (admin view) - mostly from the Excel import. */
  protected unplaced = computed(() => {
    const d = this.api.data();
    if (!d) return [];
    const inTree = new Set<string>();
    for (const t of d.trees) for (const id of treeMembers(d, t.root, this.api.kids())) inTree.add(id);
    return Object.entries(d.people)
      .filter(([id]) => !inTree.has(id))
      .map(([id, p]) => ({ id, p }))
      .sort((a, b) => a.p.name.localeCompare(b.p.name));
  });

  async ngOnInit() {
    const id = this.id();
    if (id) this.view.setTree(id);
    try {
      if (!this.api.data()) await this.api.init();
    } catch {
      this.loadError.set(true);
    }
  }

  openTree(id: string) {
    this.view.setTree(id);
    this.view.select(null);
    this.menuOpen.set(false);
    this.router.navigate(['/tree', id], { replaceUrl: true });
  }

  pickResult(id: string) {
    this.query.set('');
    // switch to a tree that contains this person, if the current one doesn't
    const d = this.api.data()!;
    const cur = this.currentTree();
    if (!cur || !treeMembers(d, cur.root, this.api.kids()).has(id)) {
      const other = this.api.trees().find((t) => t.id !== 'whole-family' && treeMembers(d, t.root, this.api.kids()).has(id))
        ?? this.api.trees().find((t) => treeMembers(d, t.root, this.api.kids()).has(id));
      if (other) this.view.setTree(other.id);
    }
    this.view.select(id);
  }

}
