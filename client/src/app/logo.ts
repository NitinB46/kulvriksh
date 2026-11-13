import { Component, input } from '@angular/core';

/** Kulvriksh mark: a peepal leaf whose veins branch like a family tree. */
@Component({
  selector: 'app-logo',
  template: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 4C17 13 9 26 11 38.5 13 50 22 57 32 60c10-3 19-10 21-21.5C55 26 47 13 32 4Z" [attr.fill]="tone() === 'dark' ? '#ffffff' : '#2f6fc0'" />
      <path d="M32 11v51M32 25l-9-6.5M32 25l9-6.5M32 35l-12.5-6.5M32 35l12.5-6.5M32 45.5l-10.5-5.5M32 45.5l10.5-5.5"
        [attr.stroke]="tone() === 'dark' ? '#2f6fc0' : '#ffffff'" stroke-width="2.6" stroke-linecap="round" fill="none" />
    </svg>
  `,
})
export class Logo {
  /** 'light' = for white/light backgrounds, 'dark' = for the dark blue header */
  readonly tone = input<'light' | 'dark'>('light');
}
