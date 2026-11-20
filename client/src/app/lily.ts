import { Component } from '@angular/core';

/**
 * A spray of three white lilies with leaves, shown along the foot of the card
 * of someone who has passed away.
 */
@Component({
  selector: 'svg[app-lily]',
  host: { viewBox: '0 0 100 34', 'aria-hidden': 'true', class: 'lily-spray', preserveAspectRatio: 'xMidYMax meet' },
  template: `
    <svg:path d="M8 30 C30 26 70 26 92 30" fill="none" stroke="#7aa363" stroke-width="1.2" />
    <svg:path d="M30 28 C24 24 18 24 14 26 C19 28 25 29 30 28 Z" fill="#7aa363" />
    <svg:path d="M70 28 C76 24 82 24 86 26 C81 28 75 29 70 28 Z" fill="#7aa363" />
    @for (l of lilies; track $index) {
      <svg:g [attr.transform]="l">
        <svg:path d="M20 39 C20 33 20 28 20 22" fill="none" stroke="#5f8a4e" stroke-width="1.4" stroke-linecap="round" />
        <svg:path d="M20 33 C15 32 11.5 28.5 11 25 C15 25.5 18.5 28.5 20 33 Z" fill="#7aa363" />
        <svg:path d="M20 30 C24 29 27.5 26 28.5 23 C25 23.5 21.5 26 20 30 Z" fill="#7aa363" />
        <svg:g fill="#ffffff" stroke="#b5ab95" stroke-width="0.7" stroke-linejoin="round">
          <svg:path d="M20 21 C15 22 10 22 6.5 18.5 C11 16.5 16 17.5 20 21 Z" />
          <svg:path d="M20 21 C25 22 30 22 33.5 18.5 C29 16.5 24 17.5 20 21 Z" />
          <svg:path d="M20 21 C14 19 9 14 8 8 C13.5 9.5 18 14 20 21 Z" />
          <svg:path d="M20 21 C26 19 31 14 32 8 C26.5 9.5 22 14 20 21 Z" />
          <svg:path d="M20 21 C17 15 17 8 20 3 C23 8 23 15 20 21 Z" />
        </svg:g>
        <svg:g stroke="#c9a24a" stroke-width="0.6" fill="#e0a43a">
          <svg:line x1="20" y1="19" x2="16.5" y2="11.5" /><svg:circle cx="16.5" cy="11.2" r="1" />
          <svg:line x1="20" y1="19" x2="20" y2="10.5" /><svg:circle cx="20" cy="10.2" r="1" />
          <svg:line x1="20" y1="19" x2="23.5" y2="11.5" /><svg:circle cx="23.5" cy="11.2" r="1" />
        </svg:g>
  </svg:g>
    }
  `,
})
export class Lily {
  /** Left, centre and right flower: position, size and a slight tilt outwards. */
  protected lilies = [
    'translate(28,4) scale(0.6) rotate(-18 20 20)',
    'translate(38,0) scale(0.68)',
    'translate(50,4) scale(0.6) rotate(18 20 20)',
  ];
}
