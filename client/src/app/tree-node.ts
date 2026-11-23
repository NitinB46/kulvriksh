import { Component, computed, inject, input } from '@angular/core';
import { Api } from './api.service';
import { ViewState } from './view-state';
import { cardPlace, initials, isLate, lifespan, nameLines } from './family';
import { TreeContext } from './tree-context';
import { Lily } from './lily';

/** One person (plus spouses) in the chart, with a + / − button for their children. */
@Component({
  selector: 'li[app-tree-node]',
  imports: [TreeNode, Lily],
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
          </span>
          <span class="info">
            <span class="name">@for (l of nameLines(p.name); track $index) { <span class="nl">{{ l }}</span> }</span>
            @if (cardPlace(p); as place) {
              <span class="place">{{ place }}</span>
            }
            @if (lifespan(p); as years) {
              <span class="years">{{ years }}</span>
            }
          </span>
          @if (isLate(p)) {
            <svg app-lily></svg>
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
            </span>
            <span class="info">
              <span class="name">@for (l of nameLines(s.p.name); track $index) { <span class="nl">{{ l }}</span> }</span>
              @if (cardPlace(s.p); as place) {
                <span class="place">{{ place }}</span>
              }
              @if (lifespan(s.p); as years) {
                <span class="years">{{ years }}</span>
              }
            </span>
            @if (isLate(s.p)) {
              <svg app-lily></svg>
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
  protected nameLines = nameLines;

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
