import { Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { toPng } from 'html-to-image';
import { Api } from './api.service';
import { ViewState } from './view-state';
import { TreeNode } from './tree-node';
import { SimpleView } from './simple-view';
import { TreeContext } from './tree-context';
import { Tree } from './models';

const DEFAULT_DEPTH = 3; // levels open the first time a visitor opens a tree

@Component({
  selector: 'app-tree-view',
  imports: [TreeNode, SimpleView],
  providers: [{ provide: TreeContext, useExisting: TreeView }],
  template: `
    <div class="toolbar">
      <div class="view-title">
        <h2>{{ tree().title }}</h2>
        @if (!simple()) {
          <button type="button" class="view-link" (click)="simple.set(true)">(Simplified View)</button>
        }
      </div>
      @if (simple()) {
        <button type="button" class="back-tree" (click)="simple.set(false)">← Back to tree view</button>
      } @else {
      <div class="tools">
        <button type="button" (click)="expandAll()" title="Show everyone">⊕<span class="lbl"> Expand all</span></button>
        <button type="button" (click)="collapseAll()" title="Show only the top person">⊖<span class="lbl"> Collapse all</span></button>
        <span class="sep"></span>
        <button type="button" (click)="zoomBy(-0.1)" aria-label="Zoom out">−</button>
        <span class="zoom">{{ Math.round(zoom() * 100) }}%</span>
        <button type="button" (click)="zoomBy(0.1)" aria-label="Zoom in">+</button>
        <button type="button" class="reset" (click)="zoom.set(startZoom)">Reset</button>
        <span class="sep"></span>
        <button type="button" (click)="savePicture()" [disabled]="saving()">{{ saving() ? 'Saving…' : '⤓' }}<span class="lbl">{{ saving() ? '' : ' Save as picture' }}</span></button>
      </div>
      }
    </div>
    @if (simple()) {
      <app-simple-view [root]="tree().root" />
    }
    <div class="chart-scroll" [hidden]="simple()" #scroller (pointerdown)="dragStart($event)" (pointermove)="dragMove($event)"
      (pointerup)="dragEnd()" (pointercancel)="dragEnd()" (pointerleave)="dragEnd()">
      <div class="chart" #chart [style.zoom]="zoom()">
        @if (api.data()?.people?.[tree().root]) {
          <ul class="root">
            <li app-tree-node [id]="tree().root" [path]="[]"></li>
          </ul>
        } @else {
          <p class="empty">The top person of this tree no longer exists. An admin can choose a new one in Manage trees.</p>
        }
      </div>
    </div>
  `,
})
export class TreeView implements TreeContext {
  readonly tree = input.required<Tree>();
  protected api = inject(Api);
  private view = inject(ViewState);
  protected Math = Math;
  /** default zoom: 80% on computers, 60% on phones so a couple and their children fit on screen */
  protected readonly startZoom = typeof window !== 'undefined' && window.innerWidth < 640 ? 0.6 : 0.8;
  protected zoom = signal(this.startZoom);
  protected saving = signal(false);
  /** one family at a time instead of the whole chart */
  protected simple = signal(false);
  private chart = viewChild.required<ElementRef<HTMLElement>>('chart');
  private scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  private expanded = computed(() => this.view.expanded(this.tree().id));

  constructor() {
    // when a person is selected (e.g. from search), open the path to them and scroll there
    effect(() => {
      const id = this.view.selected();
      this.tree(); // also when switching trees
      if (id) untracked(() => this.reveal(id));
    });
    // when a tree is opened, start with its top person in view
    effect(() => {
      this.tree().id;
      untracked(() => {
        if (!this.view.selected()) this.centerRoot();
      });
    });
  }

  private centerRoot() {
    setTimeout(() => {
      const el = document.getElementById('node-' + this.tree().root);
      const box = this.scroller().nativeElement;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      box.scrollLeft += r.left + r.width / 2 - (b.left + b.width / 2);
      box.scrollTop = 0;
    }, 30);
  }

  isOpen(id: string, depth: number) {
    const set = this.expanded();
    return set ? set.has(id) : depth < DEFAULT_DEPTH;
  }

  toggle(id: string) {
    const set = new Set(this.currentOpen());
    set.has(id) ? set.delete(id) : set.add(id);
    this.view.setExpanded(this.tree().id, set);
  }

  /** ids open right now, including the default-depth ones if the visitor never toggled */
  private currentOpen(): Set<string> {
    const set = this.expanded();
    if (set) return set;
    const out = new Set<string>();
    const walk = (id: string, depth: number, seen: Set<string>) => {
      if (depth >= DEFAULT_DEPTH || seen.has(id)) return;
      seen.add(id);
      out.add(id);
      for (const c of this.api.kids().get(id) ?? []) walk(c, depth + 1, seen);
    };
    walk(this.tree().root, 0, new Set());
    return out;
  }

  expandAll() {
    const out = new Set<string>();
    const stack = [this.tree().root];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      stack.push(...(this.api.kids().get(id) ?? []));
    }
    this.view.setExpanded(this.tree().id, out);
    this.centerRoot();
  }

  collapseAll() {
    this.view.setExpanded(this.tree().id, []);
    this.centerRoot();
  }

  private reveal(id: string) {
    // find the chain root -> ... -> person (or their spouse) inside this tree
    const kids = this.api.kids();
    const people = this.api.data()?.people ?? {};
    const targets = new Set([id, ...(people[id]?.spouses.map((s) => s.id) ?? [])]);
    const prev = new Map<string, string | null>([[this.tree().root, null]]);
    const queue = [this.tree().root];
    let found: string | null = null;
    while (queue.length && !found) {
      const cur = queue.shift()!;
      if (targets.has(cur)) found = cur;
      for (const c of kids.get(cur) ?? []) {
        if (!prev.has(c)) {
          prev.set(c, cur);
          queue.push(c);
        }
      }
    }
    if (!found) return;
    const open = new Set(this.currentOpen());
    let missing = false;
    for (let p = prev.get(found); p; p = prev.get(p)) {
      if (!open.has(p)) missing = true;
      open.add(p);
    }
    if (missing) this.view.setExpanded(this.tree().id, open);
    setTimeout(() => {
      document.getElementById('node-' + found)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 50);
  }

  zoomBy(d: number) {
    this.zoom.set(Math.min(2, Math.max(0.3, Math.round((this.zoom() + d) * 10) / 10)));
  }

  // drag the background to move around
  private drag: { x: number; y: number; left: number; top: number } | null = null;
  dragStart(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button') || e.pointerType !== 'mouse') return;
    const el = this.scroller().nativeElement;
    this.drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.classList.add('dragging');
  }
  dragMove(e: PointerEvent) {
    if (!this.drag) return;
    const el = this.scroller().nativeElement;
    el.scrollLeft = this.drag.left - (e.clientX - this.drag.x);
    el.scrollTop = this.drag.top - (e.clientY - this.drag.y);
  }
  dragEnd() {
    this.drag = null;
    this.scroller().nativeElement.classList.remove('dragging');
  }

  async savePicture() {
    this.saving.set(true);
    const el = this.chart().nativeElement;
    const oldZoom = this.zoom();
    this.zoom.set(1);
    try {
      await new Promise((r) => setTimeout(r, 50));
      const url = await toPng(el, {
        backgroundColor: '#ffffff',
        pixelRatio: Math.min(2, 8000 / Math.max(el.scrollWidth, 1)),
        width: el.scrollWidth,
        height: el.scrollHeight,
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.tree().title.replace(/[^\w-]+/g, '_')}-family-tree.png`;
      a.click();
    } catch {
      this.api.notify('Could not create the picture. Try collapsing some branches first.', 'error');
    } finally {
      this.zoom.set(oldZoom);
      this.saving.set(false);
    }
  }
}
