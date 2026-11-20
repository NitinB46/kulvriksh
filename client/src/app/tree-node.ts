import { Component, computed, inject, input } from '@angular/core';
import { Api } from './api.service';
import { ViewState } from './view-state';
import { cardPlace, initials, isLate, lifespan } from './family';
import { TreeContext } from './tree-context';

const GARLAND = Array.from({ length: 15 }, (_, i) => {
  const a = Math.PI * (i / 14); // half circle, left to right through the bottom
  return {
    x: +(40 - 36 * Math.cos(a)).toFixed(1),
    y: +(4 + 34 * Math.sin(a)).toFixed(1),
    r: i % 2 ? 3 : 4,
    c: i % 2 ? 'jasmine' : 'marigold',
  };
});

/** One person (plus spouses) in the chart, with a + / − button for their children. */
@Component({
  selector: 'li[app-tree-node]',
  imports: [TreeNode],
  template: `
    @let p = person();
    @if (p) {
      <div class="couple" [class.selected]="view.selected() === id()" [id]="'node-' + id()">
        <button type="button" class="card" [class.female]="p.gender === 'F'" [class.late]="isLate(p)" (click)="view.select(id())" [title]="p.name">
          <span class="portrait">
            @if (p.photo) {
              <img [src]="'/' + p.photo" alt="" loading="lazy" />
            } @else {
              <span class="avatar">{{ initials(p.name) }}</span>
            }
            @if (isLate(p)) {
              <svg class="garland" viewBox="0 0 80 44" aria-hidden="true">
                @for (f of garland; track $index) {
                  <circle [attr.cx]="f.x" [attr.cy]="f.y" [attr.r]="f.r" [attr.class]="f.c" />
                }
              </svg>
            }
          </span>
          <span class="name">{{ p.name }}</span>
          @if (cardPlace(p); as place) {
            <span class="place">{{ place }}</span>
          }
          @if (lifespan(p); as years) {
            <span class="years">{{ years }}</span>
          }
        </button>
        @for (s of spouses(); track s.id) {
          <span class="link" aria-hidden="true">♥</span>
          <button type="button" class="card spouse" [class.female]="s.p.gender === 'F'" [class.late]="isLate(s.p)" [class.selected]="view.selected() === s.id" (click)="view.select(s.id)" [title]="s.p.name">
            <span class="portrait">
              @if (s.p.photo) {
                <img [src]="'/' + s.p.photo" alt="" loading="lazy" />
              } @else {
                <span class="avatar">{{ initials(s.p.name) }}</span>
              }
              @if (isLate(s.p)) {
                <svg class="garland" viewBox="0 0 80 44" aria-hidden="true">
                  @for (f of garland; track $index) {
                    <circle [attr.cx]="f.x" [attr.cy]="f.y" [attr.r]="f.r" [attr.class]="f.c" />
                  }
                </svg>
              }
            </span>
            <span class="name">{{ s.p.name }}</span>
            @if (cardPlace(s.p); as place) {
              <span class="place">{{ place }}</span>
            }
            @if (lifespan(s.p); as years) {
              <span class="years">{{ years }}</span>
            }
          </button>
        }
      </div>
      @if (children().length) {
        <button type="button" class="toggle" (click)="tree.toggle(id())"
          [attr.aria-label]="(open() ? 'Hide' : 'Show') + ' children of ' + p.name"
          [title]="open() ? 'Hide children' : 'Show ' + children().length + ' children'">
          {{ open() ? '−' : '+' + children().length }}
        </button>
      }
      @if (open() && children().length) {
        <ul>
          @for (c of children(); track c) {
            <li app-tree-node [id]="c" [path]="childPath()"></li>
          }
        </ul>
      }
    }
  `,
})
export class TreeNode {
  readonly id = input.required<string>();
  readonly path = input<string[]>([]);
  protected api = inject(Api);
  protected view = inject(ViewState);
  protected tree = inject(TreeContext);
  protected initials = initials;
  protected lifespan = lifespan;
  protected cardPlace = cardPlace;
  protected isLate = isLate;
  /** Flowers of a marigold-and-jasmine garland hanging around the lower half of the photo. */
  protected garland = GARLAND;

  protected person = computed(() => this.api.data()?.people[this.id()]);
  protected spouses = computed(() =>
    (this.person()?.spouses ?? [])
      .map((s) => ({ id: s.id, p: this.api.data()!.people[s.id] }))
      .filter((s) => !!s.p),
  );
  protected childPath = computed(() => [...this.path(), this.id()]);
  protected children = computed(() =>
    (this.api.kids().get(this.id()) ?? []).filter((c) => !this.childPath().includes(c)),
  );
  protected open = computed(() => this.tree.isOpen(this.id(), this.path().length));
}
