import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { filter, forkJoin } from 'rxjs';
import { AuthService } from '../shared/services/auth.service';
import { CompteService } from '../shared/services/compte.service';
import { TransactionService } from '../shared/services/transaction.service';
import { Transaction } from '../shared/models/transaction.model';
import { environment } from '../../environments/environment';

interface JourBar {
  jour: number;       // 1-31
  entrees: number;    // total dépôts ce jour
  sorties: number;    // total envois+retraits ce jour
  pctEntree: number;  // hauteur barre (0-100)
  pctSortie: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {

  totalDepotsMois  = signal<{ totalMontant: number; totalNombre: number }>({ totalMontant: 0, totalNombre: 0 });
  totalEnvoiMois   = signal<{ totalMontant: number; totalNombre: number }>({ totalMontant: 0, totalNombre: 0 });
  chartBars        = signal<JourBar[]>([]);
  chartLoading     = signal(false);

  // Mois affiché dans le sous-titre
  readonly moisLabel = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  
  constructor(
    public  auth:      AuthService,
    public  compte:    CompteService,
    public  txService: TransactionService,
    private http:      HttpClient
  ) {}

  ngOnInit() {
    this.compte.charger().subscribe();
    this.txService.charger({ limit: 5 }).subscribe();
    this.chargerStatsMois();
    this.txService.total()
  }

  // ── Charge dépôts + envois + toutes tx du mois en parallèle ─────
  chargerStatsMois() {
    this.chartLoading.set(true);
    
    const now      = new Date();
    const annee    = now.getFullYear();
    const mois     = now.getMonth() + 1;
    const debut    = `${annee}-${String(mois).padStart(2,'0')}-01`;
    const finJour  = new Date(annee, mois, 0).getDate();
    const fin      = `${annee}-${String(mois).padStart(2,'0')}-${finJour}`;

    forkJoin({
      depots: this.txService.getTotalDepotMois(),
      envois: this.txService.TotalEnvoiMois(),
      toutes: this.http.get<{ data: Transaction[]; total: number }>(
        `${environment.apiUrl}/transaction.php`,
        { params: new HttpParams()
            .set('date_debut', debut)
            .set('date_fin', fin)
            .set('limit', '9999') }
      )
    }).subscribe({
      next: ({ depots, envois, toutes }) => {
        this.totalDepotsMois.set(depots);
        this.totalEnvoiMois.set(envois);
        this.construireBars(toutes.data, finJour);
        this.chartLoading.set(false);
      },
      error: () => this.chartLoading.set(false)
    });
  }

  // ── Construit les JourBar à partir des transactions brutes ───────
  private construireBars(txs: Transaction[], nbJours: number) {
    // Initialiser un objet par jour
    const map: Record<number, { entrees: number; sorties: number }> = {};
    for (let j = 1; j <= nbJours; j++) map[j] = { entrees: 0, sorties: 0 };

    for (const tx of txs) {
      const jour = new Date(tx.created_at).getDate();
      const montant = typeof tx.montant === 'string' ? parseFloat(tx.montant) : tx.montant;
      if (isNaN(montant) || !map[jour]) continue;

      if (tx.type === 'depot') {
        map[jour].entrees += montant;
      } else {
        map[jour].sorties += montant;
      }
    }

    // Trouver le max pour normaliser les hauteurs
    const maxVal = Math.max(
      ...Object.values(map).flatMap(v => [v.entrees, v.sorties]),
      1  // éviter division par 0
    );

    const bars: JourBar[] = Object.entries(map).map(([j, v]) => ({
      jour:       Number(j),
      entrees:    v.entrees,
      sorties:    v.sorties,
      pctEntree:  Math.round((v.entrees / maxVal) * 100),
      pctSortie:  Math.round((v.sorties / maxVal) * 100),
    }));

    this.chartBars.set(bars);
  }

  txIcon(type: string)  { return type === 'depot' ? '⬇️' : type === 'envoi' ? '➡️' : '⬆️'; }
  txLabel(tx: any)      {
    if (tx.type === 'depot')  return 'Dépôt reçu';
    if (tx.type === 'envoi')  return `Envoi → ${tx.compte_dest}`;
    return 'Retrait effectué';
  }
}



