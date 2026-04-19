// src/app/securite/alertes/alertes.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogService } from '../../shared/services/log.service';
import { ToastService } from '../../shared/services/toast.service';
import { Alerte } from '../../shared/models/log.model';

@Component({
  selector: 'app-alertes',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './alertes.component.html',
  styleUrls: ['./alertes.component.css']
})
export class AlertesComponent implements OnInit {
  constructor(public logService: LogService, private toast: ToastService) {}

  ngOnInit() { this.logService.chargerAlertes().subscribe(); }

  icone(a: Alerte) {
    const m: Record<string,string> = { sql_injection:'🗄️', xss:'🧹', brute_force:'🔐', autre:'⚠️' };
    return m[a.type] ?? '⚠️';
  }

  severiteClass(s: string) {
    return s === 'critique' ? 'critique' : s === 'haute' ? 'haute' : 'moyenne';
  }

  resoudre(a: Alerte) {
    this.logService.resoudre(a.id).subscribe({
      next:  () => this.toast.success(`Alerte #${a.id} résolue`),
      error: () => this.toast.error('Erreur lors de la résolution')
    });
  }
}
