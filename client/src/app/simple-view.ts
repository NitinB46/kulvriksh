import { Component, ElementRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Api } from './api.service';
import { ViewState } from './view-state';
import { cardPlace, initials, isLate, lifespan } from './family';
import { Lily } from './lily';
import { Person } from './models';

/**
 * Simplified view of a tree: one family at a time. The couple is at the top, a link goes back up
 * to the parents, and the children are listed below; tapping a child moves down a generation.
 */
@Component({
  selector: 'app-simple-view',
  imports: [Lily],
  template: `
    <div class="simple">
      @if (path().length > 1) {
        <nav class="crumbs" aria-label="Go up">
          <span aria-hidden="true">↑</span>
          @for (a of path().slice(0, -1); track a; let last = $last) {
            <button type="button" class="crumb" (click)="focus.set(a)">{{ name(a) }}</button>
            @if (!last) {
              <span aria-hidden="true">›</span>
            }
          }
        </nav>
      }
      @if (couple().length) {
        <div class="couple simple-couple">
          @for (c of couple(); track c.id; let first = $first) {
            @if (!first) {
              <span class="link" aria-hidden="true">♥</span>
            }
            <button type="button" class="card" [class.female]="c.p.gender === 'F'" [class.late]="isLate(c.p)"
              [class.selected]="view.selected() === c.id" (click)="view.select(c.id)" [title]="c.p.name">
              <span class="portrait">
                @if (c.p.photo) {
                  <img [src]="'/' + c.p.photo" alt="" />
                } @else {
                  <span class="avatar">{{ initials(c.p.name) }}</span>
                }
              </span>
              <span class="info">
                <span class="name">{{ c.p.name }}</span>
                @if (cardPlace(c.p); as place) {
                  <span class="place">{{ place }}</span>
                }
                @if (lifespan(c.p); as years) {
                  <span class="years">{{ years }}</span>
                }
              </span>
              @if (isLate(c.p)) {
                <svg app-lily></svg>
              }
            </button>
          }
        </div>
      }
      @if (children().length) {
        <p class="kids-head">{{ children().length }} {{ children().length === 1 ? 'child' : 'children' }} · tap one to go down</p>
        <ul class="kids">
          @for (k of children(); track k.id) {
            <li>
              <button type="button" class="kid" [class.female]="k.p.gender === 'F'" (click)="focus.set(k.id)">
                @if (k.p.photo) {
                  <img [src]="'/' + k.p.photo" alt="" loading="lazy" />
                } @else {
                  <span class="avatar">{{ initials(k.p.name) }}</span>
                }
                <span class="who">
                  <b>{{ k.p.name }}</b>
                  @if (k.spouses) {
                    <small>♥ {{ k.spouses }}</small>
                  }
                </span>
                @if (k.count) {
                  <span class="count">{{ k.count }} {{ k.count === 1 ? 'child' : 'children' }} ›</span>
                }
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="kids-head">No children recorded.</p>
      }
    </div>
  `,
})
export class SimpleView {
  readonly root = input.required<string>();
  protected api = inject(Api);
  protected view = inject(ViewState);
  protected initials = initials;
  protected lifespan = lifespan;
  protected cardPlace = cardPlace;
  protected isLate = isLate;
  readonly focus = signal<string>('');
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // start at the top of the tree, and follow searches to the searched person's family
    effect(() => {
      const r = this.root();
      untracked(() => this.focus.set(r));
    });
    // each move up or down starts at the top of the page
    effect(() => {
      this.focus();
      untracked(() => {
        this.host.nativeElement.scrollTop = 0;
        this.host.nativeElement.scrollIntoView?.({ block: 'start' });
      });
    });
    effect(() => {
      const id = this.view.selected();
      if (!id) return;
      untracked(() => {
        const found = this.findInTree(id);
        if (found && found !== this.focus() && !this.couple().some((c) => c.id === id)) this.focus.set(found);
      });
    });
  }

  private people(): Record<string, Person> {
    return this.api.data()?.people ?? {};
  }

  protected name(id: string) {
    return this.people()[id]?.name ?? '';
  }

  /** the route root -> ... -> person (or their spouse) inside this tree */
  private routeTo(id: string): string[] | null {
    const kids = this.api.kids();
    const people = this.people();
    const targets = new Set([id, ...(people[id]?.spouses.map((s) => s.id) ?? [])]);
    const prev = new Map<string, string | null>([[this.root(), null]]);
    const queue = [this.root()];
    while (queue.length) {
      const cur = queue.shift()!;
      if (targets.has(cur)) {
        const out: string[] = [];
        for (let p: string | null | undefined = cur; p; p = prev.get(p)) out.unshift(p);
        return out;
      }
      for (const c of kids.get(cur) ?? []) {
        if (!prev.has(c)) {
          prev.set(c, cur);
          queue.push(c);
        }
      }
    }
    return null;
  }

  private findInTree(id: string) {
    const r = this.routeTo(id);
    return r ? r[r.length - 1] : null;
  }

  protected path = computed(() => this.routeTo(this.focus() || this.root()) ?? [this.root()]);

  protected couple = computed(() => {
    const people = this.people();
    const id = this.path()[this.path().length - 1];
    const p = people[id];
    if (!p) return [];
    return [{ id, p }, ...p.spouses.map((s) => ({ id: s.id, p: people[s.id] })).filter((s) => !!s.p)];
  });

  protected children = computed(() => {
    const people = this.people();
    const id = this.path()[this.path().length - 1];
    const kids = this.api.kids();
    return (kids.get(id) ?? [])
      .filter((c) => people[c] && !this.path().includes(c))
      .map((c) => ({
        id: c,
        p: people[c],
        spouses: people[c].spouses.map((s) => people[s.id]?.name).filter(Boolean).join(', '),
        count: (kids.get(c) ?? []).length,
      }));
  });
}
