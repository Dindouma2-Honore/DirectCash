// src/app/shared/components/topbar/topbar.component.ts
import { Component, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';

const PAGE_META: Record<string, { title: string; path: string }> = {
  '/dashboard':                { title: 'Tableau de bord',     path: 'directcash / dashboard' },
  '/transactions/depot':       { title: 'Dépôt',               path: 'directcash / transactions / dépôt' },
  '/transactions/envoi':       { title: "Envoi d'argent",       path: 'directcash / transactions / envoi' },
  '/transactions/retrait':     { title: 'Retrait',              path: 'directcash / transactions / retrait' },
  '/transactions/historique':  { title: 'Historique',           path: 'directcash / transactions / historique' },
  '/securite/logs':            { title: 'Journaux de sécurité', path: 'directcash / securite / logs' },
  '/securite/alertes':         { title: 'Alertes',              path: 'directcash / securite / alertes' },
  '/securite/2fa':             { title: 'Paramètres 2FA',       path: 'directcash / securite / 2fa' },
  '/admin/utilisateurs':       { title: 'Utilisateurs',         path: 'directcash / admin / utilisateurs' },
  '/admin/supervision':        { title: 'Supervision globale',  path: 'directcash / admin / supervision' },
};

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.css']
})
export class TopbarComponent {
  @Output() menuToggle = new EventEmitter<void>();

  notifOpen   = signal(false);
  pageTitle   = signal('Tableau de bord');
  pagePath    = signal('Mydirectcash / dashboard');

  constructor(
    public auth: AuthService,
    public notifService: NotificationService,
    private router: Router
  ) {
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe((e: any) => {
      const meta = PAGE_META[e.urlAfterRedirects];
      if (meta) { this.pageTitle.set(meta.title); this.pagePath.set(meta.path); }
    });
    this.notifService.charger().subscribe();
  }

  marquerLu(id: number) { this.notifService.marquerLu(id).subscribe(); }
  marquerToutLu()       { this.notifService.marquerToutLu().subscribe(); }
  fermerNotif()         { this.notifOpen.set(false); }
}
