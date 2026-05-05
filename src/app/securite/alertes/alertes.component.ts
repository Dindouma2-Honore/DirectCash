import { Component, OnInit, computed, effect } from '@angular/core';
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
  // Utilisez computed pour réagir automatiquement aux changements du service
  alertes = computed(() => this.logService.alertes());
  
  constructor(public logService: LogService, private toast: ToastService) {
    // Effet optionnel pour debug
    effect(() => {
      console.log('Alertes mises à jour:', this.alertes());
    });
  }

  ngOnInit() { 
    // Recharge au démarrage
    this.logService.chargerAlertes().subscribe({
      next: (data) => {
        console.log('Alertes chargées:', data);
      },
      error: (err) => console.error('Erreur:', err)
    });
  }

  icone(a: Alerte) {
    const m: Record<string,string> = { sql_injection:'🗄️', xss:'🧹', brute_force:'🔐', autre:'⚠️' };
    return m[a.type] ?? '⚠️';
  }

  severiteClass(s: string): Record<string, boolean> {
    return {
      'critique': s === 'critique',
      'haute':    s === 'haute',
      'moyenne':  s === 'moyenne' || (!['critique','haute'].includes(s))
    };
  }

  resoudre(a: Alerte) {
    this.logService.resoudre(a.id).subscribe({
      next:  () => {
        this.toast.success(`Alerte #${a.id} résolue`);
        // Recharge après résolution pour mettre à jour la liste
        this.logService.chargerAlertes().subscribe();
      },
      error: () => this.toast.error('Erreur lors de la résolution')
    });
  }
}