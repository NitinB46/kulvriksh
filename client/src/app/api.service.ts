import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { FamilyData, Person, Relation, Tree } from './models';
import { childrenIndex } from './family';

/** All server calls plus the loaded family data, kept in signals. */
@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  readonly data = signal<FamilyData | null>(null);
  readonly admin = signal(false);
  /** True on the static, read-only copy of the site (no server, no admin). */
  readonly readOnly = signal(false);
  readonly busy = signal(false);
  readonly message = signal<{ text: string; kind: 'ok' | 'error' } | null>(null);
  readonly kids = computed(() => (this.data() ? childrenIndex(this.data()!) : new Map<string, string[]>()));
  readonly trees = computed(() => [...(this.data()?.trees ?? [])].sort((a, b) => a.order - b.order));

  private get version() {
    return this.data()?.version;
  }

  async init() {
    const s = await firstValueFrom(this.http.get<{ admin: boolean; readOnly?: boolean }>('/api/session'));
    this.admin.set(s.admin);
    this.readOnly.set(!!s.readOnly);
    await this.reload();
  }

  async reload() {
    this.data.set(await firstValueFrom(this.http.get<FamilyData>('/api/data')));
  }

  notify(text: string, kind: 'ok' | 'error' = 'ok') {
    this.message.set({ text, kind });
    setTimeout(() => {
      if (this.message()?.text === text) this.message.set(null);
    }, kind === 'ok' ? 2500 : 6000);
  }

  /** Run a write, then reload the data. Returns the server response, or null on failure. */
  private async write<T>(call: () => Promise<T>, okText: string): Promise<T | null> {
    this.busy.set(true);
    try {
      const res = await call();
      await this.reload();
      this.notify(okText);
      return res;
    } catch (e) {
      const err = e as HttpErrorResponse;
      if (err.status === 401) this.admin.set(false);
      if (err.status === 409) await this.reload();
      this.notify(errorText(err), 'error');
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  async login(password: string): Promise<boolean> {
    try {
      await firstValueFrom(this.http.post('/api/login', { password }));
      this.admin.set(true);
      await this.reload();
      this.notify('Logged in. Edit mode is on.');
      return true;
    } catch (e) {
      this.notify((e as HttpErrorResponse).error?.error ?? 'Login failed', 'error');
      return false;
    }
  }

  async logout() {
    await firstValueFrom(this.http.post('/api/logout', {}));
    this.admin.set(false);
    await this.reload();
    this.notify('Logged out');
  }

  savePerson(id: string, person: Partial<Person>) {
    return this.write(
      () => firstValueFrom(this.http.put(`/api/people/${id}`, { person, baseVersion: this.version })),
      'Saved',
    );
  }

  addPerson(person: Partial<Person>, relation?: { type: Relation; of: string }) {
    return this.write(
      () =>
        firstValueFrom(
          this.http.post<{ id: string }>('/api/people', { person, relation, baseVersion: this.version }),
        ),
      'Person added',
    );
  }

  deletePerson(id: string) {
    return this.write(
      () => firstValueFrom(this.http.delete(`/api/people/${id}`, { body: { baseVersion: this.version } })),
      'Person deleted',
    );
  }

  uploadPhoto(id: string, file: Blob) {
    const form = new FormData();
    form.append('photo', file, 'photo.jpg');
    return this.write(() => firstValueFrom(this.http.post(`/api/people/${id}/photo`, form)), 'Photo saved');
  }

  removePhoto(id: string) {
    return this.write(() => firstValueFrom(this.http.delete(`/api/people/${id}/photo`)), 'Photo removed');
  }

  addTree(tree: Partial<Tree>) {
    return this.write(
      () => firstValueFrom(this.http.post<{ id: string }>('/api/trees', { tree, baseVersion: this.version })),
      'Tree added',
    );
  }

  saveTree(id: string, tree: Partial<Tree>) {
    return this.write(
      () => firstValueFrom(this.http.put(`/api/trees/${id}`, { tree, baseVersion: this.version })),
      'Tree saved',
    );
  }

  deleteTree(id: string) {
    return this.write(
      () => firstValueFrom(this.http.delete(`/api/trees/${id}`, { body: { baseVersion: this.version } })),
      'Tree deleted',
    );
  }

  reorderTrees(ids: string[]) {
    return this.write(
      () => firstValueFrom(this.http.put('/api/trees-order', { ids, baseVersion: this.version })),
      'Order saved',
    );
  }
}

/** Turn a failed request into a message that says what actually went wrong. */
function errorText(err: HttpErrorResponse): string {
  if (typeof err.error?.error === 'string') return err.error.error;
  if (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504 || err.status === 500) {
    return 'Could not reach the server. Check that the terminal running the site is still open, then try again.';
  }
  return `Could not save (error ${err.status}). Please try again.`;
}

