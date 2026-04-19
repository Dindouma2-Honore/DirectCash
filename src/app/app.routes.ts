// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './shared/guards/auth.guard';
import { adminGuard } from './shared/guards/admin.guard';
import { guestGuard } from './shared/guards/guest.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

  // ── Auth (invités seulement) ────────────────────────────────
  {
    path: 'auth',
    canActivate: [guestGuard],
    children: [
      {
        path: 'login',
        loadComponent: () => import('./auth/login/login.component').then(m => m.LoginComponent),
        title: 'DirectCash — Connexion'
      },
      {
        path: 'inscription',
        loadComponent: () => import('./auth/register/register.component').then(m => m.RegisterComponent),
        title: 'DirectCash — Inscription'
      },
      {
        path: 'otp',
        loadComponent: () => import('./auth/otp/otp.component').then(m => m.OtpComponent),
        title: 'DirectCash — Vérification OTP'
      },
      { path: '', redirectTo: 'login', pathMatch: 'full' }
    ]
  },

  // ── Application principale (layout shell) ──────────────────
  {
    path: '',
    loadComponent: () => import('./shared/components/layout/layout.component').then(m => m.LayoutComponent),
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent),
        title: 'DirectCash — Tableau de bord'
      },
      {
        path: 'profil',
        loadComponent: () => import('./profil/profil.component').then(m => m.ProfilComponent),
        title: 'DirectCash — Mon profil'
      },
      // ── Transactions ──────────────────────────────────────
      {
        path: 'transactions',
        children: [
          { path: 'depot', loadComponent: () => import('./transactions/depot/depot.component').then(m => m.DepotComponent), title: 'DirectCash — Dépôt' },
          { path: 'envoi', loadComponent: () => import('./transactions/envoi/envoi.component').then(m => m.EnvoiComponent), title: 'DirectCash — Envoi' },
          { path: 'retrait', loadComponent: () => import('./transactions/retrait/retrait.component').then(m => m.RetraitComponent), title: 'DirectCash — Retrait' },
          { path: 'historique', loadComponent: () => import('./transactions/historique/historique.component').then(m => m.HistoriqueComponent), title: 'DirectCash — Historique' },
          { path: '', redirectTo: 'historique', pathMatch: 'full' }
        ]
      },
      // ── Sécurité ──────────────────────────────────────────
      {
        path: 'securite',
        children: [
          { path: 'logs', loadComponent: () => import('./securite/logs/logs.component').then(m => m.LogsComponent), title: 'DirectCash — Journaux' },
          { path: 'alertes', loadComponent: () => import('./securite/alertes/alertes.component').then(m => m.AlertesComponent), title: 'DirectCash — Alertes' },
          { path: '2fa', loadComponent: () => import('./securite/parametres-2fa/parametres-2fa.component').then(m => m.Parametres2faComponent), title: 'DirectCash — 2FA' },
          { path: '', redirectTo: 'logs', pathMatch: 'full' }
        ]
      },
      // ── Admin ─────────────────────────────────────────────
      {
        path: 'admin',
        canActivate: [adminGuard],
        children: [
          { path: 'utilisateurs', loadComponent: () => import('./admin/users/users.component').then(m => m.UsersComponent), title: 'DirectCash — Utilisateurs' },
          { path: 'supervision', loadComponent: () => import('./admin/supervision/supervision.component').then(m => m.SupervisionComponent), title: 'DirectCash — Supervision' },
          { path: '', redirectTo: 'supervision', pathMatch: 'full' }
        ]
      }
    ]
  },

  { path: '**', redirectTo: 'dashboard' }
];
