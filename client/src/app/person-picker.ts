import { Component, computed, inject, input, model } from '@angular/core';
import { Api } from './api.service';
import { label } from './family';

let uid = 0;

/** Type-to-search box for choosing a person. Value is the person id (or null). */
@Component({
  selector: 'app-person-picker',
  template: `
    <input type="text" [attr.list]="listId" [value]="text()" [placeholder]="placeholder()"
      (change)="pick($any($event.target).value)" autocomplete="off" [attr.aria-label]="placeholder()" />
    <datalist [id]="listId">
      @for (o of options(); track o) {
        <option [value]="o"></option>
      }
    </datalist>
  `,
})
export class PersonPicker {
  readonly value = model<string | null>(null);
  readonly placeholder = input('Type a name…');
  readonly exclude = input<string[]>([]);
  private api = inject(Api);
  protected listId = 'people-' + ++uid;

  protected text = computed(() => {
    const d = this.api.data();
    const v = this.value();
    return d && v ? label(d, v) : '';
  });
  protected options = computed(() => {
    const d = this.api.data();
    if (!d) return [];
    const skip = new Set(this.exclude());
    return Object.keys(d.people)
      .filter((id) => !skip.has(id))
      .map((id) => label(d, id))
      .sort((a, b) => a.localeCompare(b));
  });

  pick(text: string) {
    const m = /·\s*(P\d+)\s*$/.exec(text);
    if (m && this.api.data()?.people[m[1]]) this.value.set(m[1]);
    else if (!text.trim()) this.value.set(null);
    else this.value.set(this.value()); // unknown text: keep previous choice
  }
}
