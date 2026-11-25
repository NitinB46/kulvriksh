import { Component, input } from '@angular/core';

/** Kulvriksh mark: the family tree with a white trunk and light blue leaves.
 *  The previous peepal-leaf SVG logo is kept on the git branch backup-leaf-logo. */
@Component({
  selector: 'app-logo',
  template: `<img class="logo-img" [src]="tone() === 'dark' ? 'logo-tree.png' : 'logo-tree-light.png'" alt="" />`,
})
export class Logo {
  /** 'light' = for white/light backgrounds, 'dark' = for the dark blue header */
  readonly tone = input<'light' | 'dark'>('light');
}
