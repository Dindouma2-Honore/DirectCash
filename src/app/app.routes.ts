// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './shared/guards/auth.guard';
import { adminGuard } from './shared/guards/admin.guard';
import { clientGuard } from './shared/guards/client.guard';
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
        title: 'MydirectCash — Connexion'
      },
      {
        path: 'inscription',
        loadComponent: () => import('./auth/register/register.component').then(m => m.RegisterComponent),
        title: 'MydirectCash — Inscription'
      },
      {
        path: 'otp',
        loadComponent: () => import('./auth/otp/otp.component').then(m => m.OtpComponent),
        title: 'MydirectCash — Vérification OTP'
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
        title: 'MydirectCash — Tableau de bord'
      },
      {
        path: 'profil',
        loadComponent: () => import('./profil/profil.component').then(m => m.ProfilComponent),
        title: 'MydirectCash — Mon profil'
      },
      // ── Transactions ──────────────────────────────────────
      {
        path: 'transactions',
        children: [
          { path: 'depot', loadComponent: () => import('./transactions/depot/depot.component').then(m => m.DepotComponent), title: 'MydirectCash — Dépôt' },
          { path: 'envoi', canActivate: [clientGuard], loadComponent: () => import('./transactions/envoi/envoi.component').then(m => m.EnvoiComponent), title: 'MydirectCash — Envoi' },
          { path: 'retrait', canActivate: [clientGuard], loadComponent: () => import('./transactions/retrait/retrait.component').then(m => m.RetraitComponent), title: 'DirectCash — Retrait' },
          { path: 'historique', loadComponent: () => import('./transactions/historique/historique.component').then(m => m.HistoriqueComponent), title: 'DirectCash — Historique' },
          { path: '', redirectTo: 'historique', pathMatch: 'full' }
        ]
      },
      // ── Sécurité ──────────────────────────────────────────
      {
        path: 'securite',
        children: [
          { path: 'logs', canActivate: [adminGuard], loadComponent: () => import('./securite/logs/logs.component').then(m => m.LogsComponent), title: 'MydirectCash — Journaux' },
          { path: 'alertes', canActivate: [adminGuard], loadComponent: () => import('./securite/alertes/alertes.component').then(m => m.AlertesComponent), title: 'MydirectCash — Alertes' },
          { path: '2fa', loadComponent: () => import('./securite/parametres-2fa/parametres-2fa.component').then(m => m.Parametres2faComponent), title: 'MydirectCash — 2FA' },
          { path: '', redirectTo: '2fa', pathMatch: 'full' }
        ]
      },
      // ── Admin ─────────────────────────────────────────────
      {
        path: 'admin',
        canActivate: [adminGuard],
        children: [
          { path: 'utilisateurs', loadComponent: () => import('./admin/users/users.component').then(m => m.UsersComponent), title: 'MydirectCash — Utilisateurs' },
          { path: 'supervision', loadComponent: () => import('./admin/supervision/supervision.component').then(m => m.SupervisionComponent), title: 'MydirectCash — Supervision' },
          { path: '', redirectTo: 'supervision', pathMatch: 'full' }
        ]
      }
    ]
  },

  { path: '**', redirectTo: 'dashboard' }
];
