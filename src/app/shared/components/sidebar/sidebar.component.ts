// sidebar.component.ts
import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { LogService } from '../../services/log.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css']
})
export class SidebarComponent implements OnInit {
  @Input()  open = false;
  @Output() closeRequest = new EventEmitter<void>();

  constructor(public auth: AuthService, public logservice: LogService) {}

  ngOnInit(): void {
    // Attendre que le token soit disponible
    const token = localStorage.getItem('dc_token');
    if (token) {
      this.logservice.chargerAlertes().subscribe({
        next: () => console.log('Alertes sidebar:', this.logservice.alertesActives()),
        error: (e) => console.error('Erreur alertes sidebar:', e)
      });
    }
  }

  close() { this.closeRequest.emit(); }
}