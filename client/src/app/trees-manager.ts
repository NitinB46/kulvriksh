import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from './api.service';
import { ViewState } from './view-state';
import { PersonPicker } from './person-picker';
import { Tree } from './models';

/** Admin dialog: add, rename, reorder, hide trees; per-tree DOB / address visibility. */
@Component({
  selector: 'app-trees-manager',
  imports: [FormsModule, PersonPicker],
  template: `
    <div class="dialog-backdrop" (click)="closed.emit()"></div>
    <section class="dialog wide" role="dialog" aria-label="Manage trees">
      <button type="button" class="close" (click)="closed.emit()" aria-label="Close">✕</button>
      <h2>Manage trees</h2>
      <p class="muted">Each tree starts from a top person and shows everyone below them. Hidden trees are only visible to the admin.</p>
      <table class="trees-table">
        <thead>
          <tr><th></th><th>Title</th><th>Top person</th><th>Public</th><th>Show DOB</th><th>Show address</th><th></th></tr>
        </thead>
        <tbody>
          @for (t of rows(); track t.id; let i = $index, first = $first, last = $last) {
            <tr>
              <td class="order">
                <button type="button" class="small" [disabled]="first" (click)="move(i, -1)" aria-label="Move up">▲</button>
                <button type="button" class="small" [disabled]="last" (click)="move(i, 1)" aria-label="Move down">▼</button>
              </td>
              <td><input [(ngModel)]="t.title" [name]="'t' + i" aria-label="Title" /></td>
              <td><app-person-picker [(value)]="t.root" placeholder="Top person…" /></td>
              <td><input type="checkbox" [(ngModel)]="t.visible" [name]="'v' + i" aria-label="Public" /></td>
              <td><input type="checkbox" [(ngModel)]="t.show.dob" [name]="'d' + i" aria-label="Show DOB" /></td>
              <td><input type="checkbox" [(ngModel)]="t.show.address" [name]="'a' + i" aria-label="Show address" /></td>
              <td class="actions">
                <button type="button" class="primary small" (click)="save(t)">Save</button>
                @if (confirm() === t.id) {
                  <button type="button" class="danger small" (click)="remove(t.id)">Confirm</button>
                } @else {
                  <button type="button" class="danger-outline small" (click)="confirm.set(t.id)">Delete</button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
      <h3>Add a tree</h3>
      <div class="row wrap">
        <input [(ngModel)]="newTitle" name="newTitle" placeholder="Tree title, e.g. Rajendra branch" aria-label="New tree title" />
        <app-person-picker [(value)]="newRoot" placeholder="Top person…" />
        <button type="button" class="primary" [disabled]="!newTitle.trim() || !newRoot" (click)="add()">Add tree</button>
      </div>
    </section>
  `,
})
export class TreesManager {
  readonly closed = output<void>();
  protected api = inject(Api);
  private view = inject(ViewState);
  protected rows = signal<Tree[]>(this.copy());
  protected confirm = signal<string | null>(null);
  protected newTitle = '';
  protected newRoot: string | null = null;

  private copy(): Tree[] {
    return this.api.trees().map((t) => ({ ...t, show: { ...t.show } }));
  }

  async save(t: Tree) {
    await this.api.saveTree(t.id, { title: t.title, root: t.root, visible: t.visible, show: t.show });
  }

  async move(i: number, d: number) {
    const list = [...this.rows()];
    [list[i], list[i + d]] = [list[i + d], list[i]];
    this.rows.set(list);
    await this.api.reorderTrees(list.map((t) => t.id));
  }

  async remove(id: string) {
    if (await this.api.deleteTree(id)) {
      this.rows.set(this.copy());
      if (this.view.treeId() === id) this.view.setTree(this.api.trees()[0]?.id ?? '');
    }
  }

  async add() {
    const res = await this.api.addTree({ title: this.newTitle.trim(), root: this.newRoot!, visible: true, show: { dob: false, address: false } });
    if (res) {
      this.rows.set(this.copy());
      this.view.setTree(res.id);
      this.newTitle = '';
      this.newRoot = null;
    }
  }
}
