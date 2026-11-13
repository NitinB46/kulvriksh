import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from './api.service';
import { ViewState } from './view-state';
import { initials, treeMembers } from './family';
import { Logo } from './logo';

/** Public landing page: the family story and a way into the tree. */
@Component({
  selector: 'app-home-page',
  imports: [RouterLink, Logo],
  host: { class: 'page home-page' },
  template: `
    <header class="home-nav">
      <a class="brand" routerLink="/">
        <app-logo tone="dark" />
        <span class="brand-name">Kulvriksh</span>
      </a>
      <nav>
        <a routerLink="/tree" class="nav-link">Family Tree</a>
        @if (api.admin()) {
          <a routerLink="/tree" class="nav-button">Admin · Edit tree</a>
        } @else {
          <button type="button" class="nav-button" (click)="view.showLogin.set(true)">Admin Login</button>
        }
      </nav>
    </header>

    <section class="hero">
      <div class="hero-mosaic" aria-hidden="true">
        @for (m of mosaic(); track m) {
          <img [src]="'/' + m" alt="" loading="lazy" />
        }
      </div>
      <div class="hero-text">
        <p class="eyebrow">The Bhatnagar family · कुलवृक्ष</p>
        <h1>Our roots, our branches, <span>one family.</span></h1>
        <p class="lead">
          From {{ founder() || 'our ancestors' }} to the youngest of today, explore {{ stats().generations || 'many' }} generations
          of the family. Find relatives, see old photographs and learn how everyone is connected.
        </p>
        <a routerLink="/tree" class="cta">Explore the Family Tree <span aria-hidden="true">→</span></a>
      </div>
      <div class="hero-art" aria-hidden="true">
        @for (f of heroFaces(); track f.id; let i = $index) {
          <figure [class]="'blend blend-' + i">
            <img [src]="'/' + f.photo" alt="" />
            <figcaption>{{ f.name }}</figcaption>
          </figure>
        }
        <figure class="blend-today">
          <img src="/hero/nitin-vani.png" alt="" />
        </figure>
        <figure class="blend-center">
          <img src="/hero/rajendra-asha.png" alt="" />
          <figcaption>Rajendra &amp; Asha</figcaption>
        </figure>
      </div>
    </section>

    <section class="stats" aria-label="The family in numbers">
      <div><b>{{ stats().people }}</b><span>family members</span></div>
      <div><b>{{ stats().generations }}</b><span>generations</span></div>
      <div><b>{{ stats().photos }}</b><span>photographs</span></div>
      <div><b>{{ branches().length }}</b><span>branches</span></div>
    </section>

    @if (lineage().length) {
      <section class="story">
        <h2>How it began</h2>
        <ol class="lineage">
          @for (n of lineage(); track n; let last = $last) {
            <li>{{ n }}</li>
          }
        </ol>
        <p>The family grew from one line into the branches below. Each branch has its own tree, and the whole family can be seen together.</p>
      </section>
    }

    @if (branches().length) {
      <section class="branches">
        <h2>The family branches</h2>
        <div class="branch-grid">
          @for (b of branches(); track b.id) {
            <a class="branch" [routerLink]="['/tree', b.id]">
              @if (b.photo) {
                <img [src]="'/' + b.photo" [alt]="b.title" />
              } @else {
                <span class="avatar big">{{ initials(b.title) }}</span>
              }
              <h3>{{ b.title }}</h3>
              <p>{{ b.count }} members</p>
              <span class="go">View tree →</span>
            </a>
          }
        </div>
      </section>
    }

    <section class="closing">
      <h2>Know someone who's missing?</h2>
      <p>Share names, dates and photos with the family admin and they will be added to the tree.</p>
      <a routerLink="/tree" class="cta light">Open the Family Tree</a>
    </section>

    <footer class="home-footer">
      <span><app-logo tone="dark" />Kulvriksh · Bhatnagar family tree</span>
      @if (!api.admin()) {
        <button type="button" class="link-button" (click)="view.showLogin.set(true)">Admin Login</button>
      }
    </footer>
  `,
})
export class HomePage implements OnInit {
  protected api = inject(Api);
  protected view = inject(ViewState);
  protected initials = initials;
  protected loadError = signal(false);

  async ngOnInit() {
    try {
      if (!this.api.data()) await this.api.init();
    } catch {
      this.loadError.set(true);
    }
  }

  private mainTree = computed(() => this.api.trees().find((t) => t.id === 'whole-family') ?? this.api.trees()[0]);

  protected stats = computed(() => {
    const d = this.api.data();
    if (!d) return { people: 0, generations: 0, photos: 0 };
    const people = Object.keys(d.people).length;
    const photos = Object.values(d.people).filter((p) => p.photo).length;
    let generations = 0;
    const root = this.mainTree()?.root;
    if (root) {
      const walk = (id: string, depth: number, seen: Set<string>) => {
        if (seen.has(id)) return;
        seen.add(id);
        generations = Math.max(generations, depth);
        for (const c of this.api.kids().get(id) ?? []) walk(c, depth + 1, seen);
      };
      walk(root, 1, new Set());
    }
    return { people, generations, photos };
  });

  protected founder = computed(() => {
    const t = this.mainTree();
    return t ? this.api.data()?.people[t.root]?.name : '';
  });

  protected branches = computed(() => {
    const d = this.api.data();
    if (!d) return [];
    return this.api
      .trees()
      .filter((t) => t.id !== this.mainTree()?.id)
      .map((t) => ({
        id: t.id,
        title: t.title,
        photo: d.people[t.root]?.photo,
        count: treeMembers(d, t.root, this.api.kids()).size,
      }));
  });

  /** founder -> ... -> parent of the branches, e.g. Rai Dina Nath → Bhagwan Dass → … */
  protected lineage = computed(() => {
    const d = this.api.data();
    const first = this.api.trees().find((t) => t.id !== this.mainTree()?.id);
    if (!d || !first) return [];
    const chain: string[] = [];
    let cur = d.people[first.root]?.parents[0];
    const seen = new Set<string>();
    while (cur && d.people[cur] && !seen.has(cur)) {
      seen.add(cur);
      chain.unshift(d.people[cur].name);
      cur = d.people[cur].parents[0];
    }
    return chain;
  });

  /** many small family photos for the soft background of the banner */
  protected mosaic = computed(() => {
    const d = this.api.data();
    if (!d) return [];
    const photos = Object.values(d.people).map((p) => p.photo).filter((x): x is string => !!x);
    // spread the picks across the whole family, not just one branch
    const step = Math.max(1, Math.floor(photos.length / 40));
    return photos.filter((_, i) => i % step === 0).slice(0, 40);
  });

  /** a few ancestor faces for the hero picture */
  protected heroFaces = computed(() => {
    const d = this.api.data();
    if (!d) return [];
    const ids = this.api.trees().filter((t) => t.id !== this.mainTree()?.id).map((t) => t.root);
    const parent = ids.length ? d.people[ids[0]]?.parents[0] : undefined;
    return [...(parent ? [parent] : []), ...ids]
      .map((id) => ({ id, name: d.people[id]?.name ?? '', photo: d.people[id]?.photo }))
      .filter((f) => f.photo)
      .slice(0, 5);
  });
}
