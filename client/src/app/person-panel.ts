import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from './api.service';
import { ViewState } from './view-state';
import { PersonPicker } from './person-picker';
import { formatDate, initials, lifespan } from './family';
import { Person, Relation, TriState } from './models';

interface EditForm {
  name: string;
  gender: 'M' | 'F' | '';
  birthDate: string;
  birthPlace: string;
  deathDate: string;
  deathPlace: string;
  location: string;
  address: string;
  notes: string;
  bio: string;
  showDob: string; // 'inherit' | 'show' | 'hide'
  showAddress: string;
  parent1: string | null;
  parent2: string | null;
  spouses: { id: string | null; married: string }[];
}

const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const toTri = (s: string): TriState => (s === 'show' ? true : s === 'hide' ? false : null);
const fromTri = (t: TriState | undefined) => (t === true ? 'show' : t === false ? 'hide' : 'inherit');

@Component({
  selector: 'app-person-panel',
  imports: [FormsModule, PersonPicker],
  template: `
    @let p = person();
    @if (p && id(); as pid) {
      <aside class="panel" aria-label="Person details">
        <button type="button" class="close" (click)="view.select(null)" aria-label="Close">✕</button>

        @if (!view.editing()) {
          <!-- ===== view mode ===== -->
          <div class="photo-big">
            @if (p.photo) {
              <img [src]="'/' + p.photo" [alt]="p.name" />
            } @else {
              <span class="avatar big">{{ initials(p.name) }}</span>
            }
          </div>
          <h2>{{ p.name }}</h2>
          @if (lifespan(p)) {
            <p class="muted">{{ lifespan(p) }}</p>
          }
          <dl>
            @if (p.birth?.date || p.birth?.place) {
              <dt>Born</dt>
              <dd>{{ fmt(p.birth?.date) }}{{ p.birth?.date && p.birth?.place ? ', ' : '' }}{{ p.birth?.place }}</dd>
            }
            @if (p.death?.date || p.death?.place) {
              <dt>Died</dt>
              <dd>{{ fmt(p.death?.date) }}{{ p.death?.date && p.death?.place ? ', ' : '' }}{{ p.death?.place }}</dd>
            }
            @if (p.location) {
              <dt>Location</dt>
              <dd>{{ p.location }}</dd>
            }
            @if (p.address) {
              <dt>Address</dt>
              <dd>{{ p.address }}</dd>
            }
            @for (s of p.spouses; track s.id) {
              <dt>Spouse</dt>
              <dd><a href="#" (click)="go($event, s.id)">{{ name(s.id) }}</a>{{ s.married ? ' · married ' + fmt(s.married) : '' }}</dd>
            }
            @if (p.parents.length) {
              <dt>Parents</dt>
              <dd>
                @for (x of p.parents; track x; let last = $last) {
                  <a href="#" (click)="go($event, x)">{{ name(x) }}</a>{{ last ? '' : ', ' }}
                }
              </dd>
            }
            @if (children().length) {
              <dt>Children</dt>
              <dd>
                @for (x of children(); track x; let last = $last) {
                  <a href="#" (click)="go($event, x)">{{ name(x) }}</a>{{ last ? '' : ', ' }}
                }
              </dd>
            }
          </dl>
          @if (p.bio) {
            <p class="bio">{{ p.bio }}</p>
          }
          @if (p.notes) {
            <p class="notes">{{ p.notes }}</p>
          }

          @if (api.admin()) {
            <div class="admin-actions">
              <button type="button" class="primary" (click)="startEdit()">✎ Edit details</button>
              <label class="button">
                📷 {{ p.photo ? 'Change photo' : 'Upload photo' }}
                <input type="file" accept="image/jpeg,image/png,image/webp" (change)="upload($event)" hidden />
              </label>
              @if (p.photo) {
                <button type="button" (click)="api.removePhoto(pid)">Remove photo</button>
              }
            </div>
            <h3>Add a relative</h3>
            @if (adding(); as rel) {
              <form class="add-form" (ngSubmit)="addRelative(rel)">
                <p>New <b>{{ rel }}</b> of {{ p.name }}</p>
                <label>Name <input name="newName" [(ngModel)]="newName" required autofocus /></label>
                <label>Gender
                  <select name="newGender" [(ngModel)]="newGender">
                    <option value="">–</option><option value="M">Male</option><option value="F">Female</option>
                  </select>
                </label>
                <label>Date of birth <input name="newDob" [(ngModel)]="newDob" placeholder="YYYY or YYYY-MM-DD" /></label>
                <div class="row">
                  <button type="submit" class="primary" [disabled]="!newName.trim() || api.busy()">Add</button>
                  <button type="button" (click)="adding.set(null)">Cancel</button>
                </div>
              </form>
            } @else {
              <div class="row wrap">
                <button type="button" (click)="startAdd('child')">+ Child</button>
                <button type="button" (click)="startAdd('spouse')">+ Spouse</button>
                <button type="button" (click)="startAdd('parent')" [disabled]="p.parents.length >= 2">+ Parent</button>
              </div>
            }
            <h3>Danger zone</h3>
            @if (confirmDelete()) {
              <p>Delete <b>{{ p.name }}</b>? Links to relatives are removed too.</p>
              <div class="row">
                <button type="button" class="danger" (click)="remove(pid)">Yes, delete</button>
                <button type="button" (click)="confirmDelete.set(false)">Cancel</button>
              </div>
            } @else {
              <button type="button" class="danger-outline" (click)="confirmDelete.set(true)">Delete person</button>
            }
          }
        } @else {
          <!-- ===== edit mode ===== -->
          <h2>Edit {{ p.name }}</h2>
          <form class="edit-form" (ngSubmit)="save(pid)">
            <label>Name <input name="name" [(ngModel)]="form.name" required /></label>
            <label>Gender
              <select name="gender" [(ngModel)]="form.gender">
                <option value="">–</option><option value="M">Male</option><option value="F">Female</option>
              </select>
            </label>
            <fieldset>
              <legend>Birth</legend>
              <label>Date <input name="bd" [(ngModel)]="form.birthDate" placeholder="YYYY, YYYY-MM or YYYY-MM-DD" [class.invalid]="bad(form.birthDate)" /></label>
              <label>Place <input name="bp" [(ngModel)]="form.birthPlace" /></label>
              <label>Show date of birth to visitors
                <select name="sd" [(ngModel)]="form.showDob">
                  <option value="inherit">Follow tree setting ({{ treeDefault('dob') }})</option>
                  <option value="show">Show</option>
                  <option value="hide">Hide</option>
                </select>
              </label>
            </fieldset>
            <fieldset>
              <legend>Death</legend>
              <label>Date <input name="dd" [(ngModel)]="form.deathDate" placeholder="YYYY, YYYY-MM or YYYY-MM-DD" [class.invalid]="bad(form.deathDate)" /></label>
              <label>Place <input name="dp" [(ngModel)]="form.deathPlace" /></label>
            </fieldset>
            <label>Location <input name="loc" [(ngModel)]="form.location" placeholder="City where they live (shown on the card)" /></label>
            <fieldset>
              <legend>Address</legend>
              <label>Address <textarea name="addr" rows="2" [(ngModel)]="form.address"></textarea></label>
              <label>Show address to visitors
                <select name="sa" [(ngModel)]="form.showAddress">
                  <option value="inherit">Follow tree setting ({{ treeDefault('address') }})</option>
                  <option value="show">Show</option>
                  <option value="hide">Hide</option>
                </select>
              </label>
            </fieldset>
            <fieldset>
              <legend>Family</legend>
              <label>Parent 1 <app-person-picker [(value)]="form.parent1" [exclude]="[pid]" placeholder="Search for a parent…" /></label>
              <label>Parent 2 <app-person-picker [(value)]="form.parent2" [exclude]="[pid]" placeholder="Search for a parent…" /></label>
              @for (s of form.spouses; track $index; let i = $index) {
                <div class="spouse-row">
                  <label>Spouse <app-person-picker [(value)]="s.id" [exclude]="[pid]" placeholder="Search for a spouse…" /></label>
                  <label>Married <input [name]="'m' + i" [(ngModel)]="s.married" placeholder="YYYY…" [class.invalid]="bad(s.married)" /></label>
                  <button type="button" class="small" (click)="form.spouses.splice(i, 1)" aria-label="Remove spouse">✕</button>
                </div>
              }
              <button type="button" class="small" (click)="form.spouses.push({ id: null, married: '' })">+ Link existing spouse</button>
            </fieldset>
            <label>Notes <textarea name="notes" rows="2" [(ngModel)]="form.notes"></textarea></label>
            <label>Life story <textarea name="bio" rows="4" [(ngModel)]="form.bio"></textarea></label>
            <div class="row sticky">
              <button type="submit" class="primary" [disabled]="api.busy() || !form.name.trim() || anyBad()">Save</button>
              <button type="button" (click)="view.editing.set(false)">Cancel</button>
            </div>
          </form>
        }
      </aside>
    }
  `,
})
export class PersonPanel {
  protected api = inject(Api);
  protected view = inject(ViewState);
  protected initials = initials;
  protected lifespan = lifespan;
  protected fmt = formatDate;

  protected id = computed(() => this.view.selected());
  protected person = computed(() => {
    const id = this.id();
    return id ? this.api.data()?.people[id] : undefined;
  });
  protected children = computed(() => this.api.kids().get(this.id() ?? '') ?? []);

  protected form: EditForm = this.emptyForm();
  protected adding = signal<Relation | null>(null);
  protected confirmDelete = signal(false);
  protected newName = '';
  protected newGender: 'M' | 'F' | '' = '';
  protected newDob = '';

  constructor() {
    effect(() => {
      // reset local UI when another person is selected
      this.id();
      this.adding.set(null);
      this.confirmDelete.set(false);
      if (this.view.editing()) this.fillForm();
    });
  }

  name(id: string) {
    return this.api.data()?.people[id]?.name ?? id;
  }
  go(e: Event, id: string) {
    e.preventDefault();
    this.view.select(id);
  }
  bad(d: string) {
    return !!d.trim() && !DATE_RE.test(d.trim());
  }
  anyBad() {
    return this.bad(this.form.birthDate) || this.bad(this.form.deathDate) || this.form.spouses.some((s) => this.bad(s.married));
  }
  treeDefault(field: 'dob' | 'address') {
    const t = this.api.trees().find((x) => x.id === this.view.treeId());
    return t?.show[field] ? 'shown' : 'hidden';
  }

  private emptyForm(): EditForm {
    return { name: '', gender: '', birthDate: '', birthPlace: '', deathDate: '', deathPlace: '', location: '', address: '', notes: '', bio: '',
      showDob: 'inherit', showAddress: 'inherit', parent1: null, parent2: null, spouses: [] };
  }

  private fillForm() {
    const p = this.person();
    if (!p) return;
    this.form = {
      name: p.name,
      gender: p.gender ?? '',
      birthDate: p.birth?.date ?? '',
      birthPlace: p.birth?.place ?? '',
      deathDate: p.death?.date ?? '',
      deathPlace: p.death?.place ?? '',
      location: p.location ?? '',
      address: p.address ?? '',
      notes: p.notes ?? '',
      bio: p.bio ?? '',
      showDob: fromTri(p.show?.dob),
      showAddress: fromTri(p.show?.address),
      parent1: p.parents[0] ?? null,
      parent2: p.parents[1] ?? null,
      spouses: p.spouses.map((s) => ({ id: s.id, married: s.married ?? '' })),
    };
  }

  startEdit() {
    this.fillForm();
    this.view.editing.set(true);
  }

  async save(id: string) {
    const f = this.form;
    const person: Partial<Person> = {
      name: f.name.trim(),
      gender: f.gender,
      birth: { date: f.birthDate.trim(), place: f.birthPlace.trim() },
      death: { date: f.deathDate.trim(), place: f.deathPlace.trim() },
      location: f.location.trim(),
      address: f.address.trim(),
      notes: f.notes.trim(),
      bio: f.bio.trim(),
      show: { dob: toTri(f.showDob), address: toTri(f.showAddress) },
      parents: [f.parent1, f.parent2].filter((x): x is string => !!x),
      spouses: f.spouses.filter((s) => s.id).map((s) => ({ id: s.id!, married: s.married.trim() || undefined })),
    };
    if (await this.api.savePerson(id, person)) this.view.editing.set(false);
  }

  startAdd(rel: Relation) {
    this.newName = '';
    this.newGender = '';
    this.newDob = '';
    this.adding.set(rel);
  }

  async addRelative(rel: Relation) {
    const of = this.id();
    if (!of || this.bad(this.newDob)) {
      this.api.notify('Date of birth must look like 1950 or 1950-08-15', 'error');
      return;
    }
    const res = await this.api.addPerson(
      { name: this.newName.trim(), gender: this.newGender, birth: { date: this.newDob.trim() }, show: { dob: null, address: null } },
      { type: rel, of },
    );
    if (res) {
      this.adding.set(null);
      this.view.select(res.id);
    }
  }

  async upload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const id = this.id();
    if (!file || !id) return;
    if (file.size > 8 * 1024 * 1024) {
      this.api.notify('That photo is larger than 8 MB', 'error');
      return;
    }
    await this.api.uploadPhoto(id, file);
  }

  async remove(id: string) {
    if (await this.api.deletePerson(id)) this.view.select(null);
  }
}
