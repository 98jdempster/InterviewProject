import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { App } from './app';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./auth/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./auth/register/register.component').then(m => m.RegisterComponent),
  },
  {
    path: '',
    component: App,
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: '' },
];
