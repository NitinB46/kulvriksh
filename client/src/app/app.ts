import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterOutlet } from '@angular/router';
import { Api } from './api.service';
import { ViewState } from './view-state';

/** Shell: the current page, plus the shared admin-login dialog and status messages. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FormsModule],
  template: `
    <router-outlet />

    @if (view.showLogin()) {
      <div class="dialog-backdrop" (click)="view.showLogin.set(false)"></div>
      <section class="dialog" role="dialog" aria-label="Admin login">
        <button type="button" class="close" (click)="view.showLogin.set(false)" aria-label="Close">✕</button>
        <h2>Admin login</h2>
        <form (ngSubmit)="doLogin()">
          <label>Password <input type="password" name="password" [(ngModel)]="password" autocomplete="current-password" autofocus required /></label>
          <button type="submit" class="primary" [disabled]="!password">Log in</button>
        </form>
      </section>
    }

    @if (api.message(); as m) {
      <div class="toast" [class.error]="m.kind === 'error'" role="status">{{ m.text }}</div>
    }
  `,
})
export class App {
  protected api = inject(Api);
  protected view = inject(ViewState);
  private router = inject(Router);
  protected password = '';

  async doLogin() {
    const ok = await this.api.login(this.password);
    this.password = '';
    if (ok) {
      this.view.showLogin.set(false);
      if (!this.router.url.startsWith('/tree')) this.router.navigate(['/tree']);
    }
  }
}
