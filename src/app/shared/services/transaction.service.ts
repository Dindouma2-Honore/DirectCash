// src/app/shared/services/transaction.service.ts
import { Injectable, signal, computed } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable, tap } from 'rxjs';
import { StatsMois, Transaction, TransactionFilters } from '../models/transaction.model';
import { environment } from '../../../environments/environment';

export interface BeneficiaireFrequent {
  compte_dest: string;
  prenom: string;
  nom: string;
  telephone: string;
  nb_envois: number;
  total_envoye: number;
}
@Injectable({ providedIn: 'root' })
export class TransactionService {
  private readonly API = environment.apiUrl;

  private _txs = signal<Transaction[]>([]);
  private _loading = signal(false);
  private _total = signal(0);
  private _filters = signal<TransactionFilters>({ page: 1, limit: 10 });

  readonly transactions = this._txs.asReadonly();

  readonly loading = this._loading.asReadonly();
  readonly total = this._total.asReadonly();
  readonly filters = this._filters.asReadonly();
  readonly totalPages = computed(() => Math.ceil(this._total() / this._filters().limit));

  constructor(private http: HttpClient) { }
  sendOTPRetrait(): Observable<{ message: string; email_masque: string; expire_dans: number }> {
    return this.http.post<{ message: string; email_masque: string; expire_dans: number }>(
      `${this.API}/transaction.php?action=send_otp_retrait`, {}
    );
  }
  sendOTPEnvoi(): Observable<{ message: string; email_masque: string; expire_dans: number }> {
    return this.http.post<{ message: string; email_masque: string; expire_dans: number }>(`${this.API}/transaction.php?action=send_otp_envoi`, {});
  }

  verifierPin(pin: string): Observable<{ valide: boolean }> {
    return this.http.post<{ valide: boolean }>(
      `${this.API}/transaction.php?action=verifier_pin`,
      { pin }
    );
  }
  charger(f?: Partial<TransactionFilters>) {
    if (f) this._filters.update(prev => ({ ...prev, ...f }));
    const filt = this._filters();
    let params = new HttpParams().set('page', filt.page).set('limit', filt.limit);
    if (filt.search) params = params.set('search', filt.search);
    if (filt.type) params = params.set('type', filt.type);
    if (filt.statut) params = params.set('statut', filt.statut);
    if (filt.date) params = params.set('date', filt.date);

    this._loading.set(true);
    return this.http.get<{ data: Transaction[]; total: number }>(`${this.API}/transaction.php`, { params }).pipe(
      tap(res => { this._txs.set(res.data); this._total.set(res.total); this._loading.set(false); })
    );
  }

  depot(payload: { montant: number; source: string; reference_externe?: string }) {
    return this.http.post<{ transaction: Transaction; nouveau_solde: number }>(
      `${this.API}/transaction.php?action=depot`, payload
    ).pipe(tap(() => this.charger().subscribe()));
  }

  envoi(payload: {
  compte_dest: string;
  montant: number;
  motif?: string;
  idempotency_key: string;
  otp: string;
  mode_envoi?: string;   
  operateur?: string;    
}) {
  return this.http.post<{ transaction: Transaction; nouveau_solde: number }>(
    `${this.API}/transaction.php?action=envoi`, payload
  ).pipe(tap(() => this.charger().subscribe()));
}

  retrait(payload: { montant: number; mode: string; pin: string; otp: string,compte_dest:string }) {
    return this.http.post<{ transaction: Transaction; nouveau_solde: number }>(
      `${this.API}/transaction.php?action=retrait`, payload
    ).pipe(tap(() => this.charger().subscribe()));
  }
  getBeneficiairesFrequents(): Observable<BeneficiaireFrequent[]> {
    return this.http.get<BeneficiaireFrequent[]>(
      `${this.API}/transaction.php?action=beneficiaires_frequents`
    );
  }

  getDetail(code: string) {
    return this.http.get<Transaction>(`${this.API}/transaction.php?code=${code}`);
  }

  exportCSV() {
    return this.http.get(`${this.API}/transaction.php?action=export_csv`, { responseType: 'blob' });
  }

  changerPage(p: number) { this._filters.update(f => ({ ...f, page: p })); this.charger().subscribe(); }
  reinitialiser() { this._filters.set({ page: 1, limit: 10 }); this.charger().subscribe(); }

  genererCleIdempotence(): string {
    const r = () => Math.random().toString(36).substr(2, 8);
    return `DC-TXN-${r()}-${r().substr(0, 4)}`;
  }

  // ======================================= Statistique du mois============
  // ========================================================================


  getTotalRetraitMois(): Observable<{ totalMontant: number; totalNombre: number }> {
    const maintenant = new Date();
    const annee = maintenant.getFullYear();
    const mois = maintenant.getMonth() + 1;
    const debutMois = `${annee}-${mois.toString().padStart(2, '0')}-01`;
    const finMois = `${annee}-${mois.toString().padStart(2, '0')}-${new Date(annee, mois, 0).getDate()}`;

    let params = new HttpParams()
      .set('type', 'retrait')
      .set('date_debut', debutMois)
      .set('date_fin', finMois)
      .set('limit', '9999');

    return this.http.get<{ data: Transaction[]; total: number }>(`${this.API}/transaction.php`, { params })
      .pipe(
        map(response => {
          let totalMontant = 0;
          let totalNombre = response.data.length; // Nombre de transactions

          // Calculer la somme des montants
          for (const tx of response.data) {
            const montant = typeof tx.montant === 'string' ? parseFloat(tx.montant) : tx.montant;
            totalMontant += isNaN(montant) ? 0 : montant;
          }

          // console.log(`Dépôts du mois: ${totalNombre} transaction(s) pour un total de ${totalMontant} FCFA`);

          return { totalMontant, totalNombre };
        })
      );
  }
  TotalEnvoiMois(): Observable<{ totalMontant: number; totalNombre: number }> {
    const maintenant = new Date()
    const annee = maintenant.getFullYear()
    const mois = maintenant.getMonth() + 1
    const debutMois = `${annee}-${mois.toString().padStart(2, '0')}-01`;
    const finMois = `${annee}-${mois.toString().padStart(2, '0')}-${new Date(annee, mois, 0).getDate()}`;
    let params = new HttpParams()
      .set('type', 'envoi')
      .set('date_debut', debutMois)
      .set('date_fin', finMois)
      .set('limit', '9999');
    return this.http.get<{ data: Transaction[]; total: number }>(`${this.API}/transaction.php`, { params })
      .pipe(
        map(response => {
          let totalMontant = 0
          let totalNombre = response.data.length
          for (let tx of response.data) {
            const montant = typeof tx.montant === 'string' ? parseFloat(tx.montant) : tx.montant;
            totalMontant += isNaN(montant) ? 0 : montant

          }
          return { totalMontant, totalNombre }
        })
      )
  }

  /** Vérifie qu'un numéro de compte MyDirectCash existe et retourne le nom du titulaire */
  verifierCompteDest(numero: string): Observable<{ nom: string; prenom: string }> {
    return this.http.get<{ nom: string; prenom: string }>(
      `${this.API}/transaction.php?action=verifier_compte&numero=${encodeURIComponent(numero)}`
    );
  }

}
