// src/app/dashboard/dashboard.component.ts
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../shared/services/auth.service';
import { CompteService } from '../shared/services/compte.service';
import { TransactionService } from '../shared/services/transaction.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  // Signaux pour les dépôts, envois du mois
  totalDepotsMois = signal<{ totalMontant: number; totalNombre: number }>({ totalMontant: 0, totalNombre: 0 });
  totalDepotsLoading = signal<boolean>(false);
  totalEnvoiMois = signal<{ totalMontant: number; totalNombre: number }>({ totalMontant: 0, totalNombre: 0 });
  totalEnvoiLoading = signal<boolean>(false);
  totalDepotsError = signal<string | null>(null);
  chartBars = [30, 55, 40, 70, 45, 60, 80, 50, 90, 75, 95, 100];

  constructor(
    public auth: AuthService,
    public compte: CompteService,
    public txService: TransactionService
  ) { }

  ngOnInit() {
    this.compte.charger().subscribe();
    this.txService.charger({ limit: 5 }).subscribe();       // dernières tx
    // this.txService.debugTotalDepotsMoisEnCours();
    this.calculerTotalDepotsMois();
  }
  calculerTotalDepotsMois() {
  this.totalDepotsLoading.set(true);
  
  this.txService.getTotalDepotMois().subscribe({
    next: (stats) => {
      this.totalDepotsMois.set(stats);
      this.totalDepotsLoading.set(false);
      // console.log(`${stats.totalNombre} dépôt(s) pour un total de ${stats.totalMontant} FCFA`);
    },
    error: (err) => {
      console.error('Erreur:', err);
      this.totalDepotsLoading.set(false);
    }
  });
}
calculEnvoi(){
  this.txService.TotalEnvoiMois().subscribe({
    next:(total)=> {
      this.totalEnvoiMois.set(total)
    },
    error:(err) =>{
      console.error("Erreur de calcul d'envoi",err)
    },
  })
}


  txIcon(type: string): string {
    return type === 'depot' ? '⬇️' : type === 'envoi' ? '➡️' : '⬆️';
  }

  txLabel(tx: any): string {
    if (tx.type === 'depot') return 'Dépôt reçu';
    if (tx.type === 'envoi') return `Envoi → ${tx.compte_dest}`;
    return 'Retrait effectué';
  }
}
