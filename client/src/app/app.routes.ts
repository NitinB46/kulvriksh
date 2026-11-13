import { Routes } from '@angular/router';
import { HomePage } from './home-page';
import { TreePage } from './tree-page';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'Kulvriksh · Bhatnagar Family Tree' },
  { path: 'tree', component: TreePage, title: 'Family Tree · Kulvriksh' },
  { path: 'tree/:id', component: TreePage, title: 'Family Tree · Kulvriksh' },
  { path: '**', redirectTo: '' },
];
