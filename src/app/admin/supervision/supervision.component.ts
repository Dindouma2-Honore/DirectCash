import { Component, OnInit,computed, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { TransactionService } from '../../shared/services/transaction.service';
import { FormsModule } from '@angular/forms';

interface ServiceSante { nom:string; fichier:string; statut:'operationnel'|'degrade'|'hors_service'; latence_ms?:number; }
interface StatsGlobales { utilisateurs_actifs:number; volume_retrait:number; nb_transactions_jour:number; disponibilite:number; volume_envoi:number; }

@Component({
  selector: 'app-supervision',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './supervision.component.html',
  styleUrls: ['./supervision.component.css']
})
export class SupervisionComponent implements OnInit, OnDestroy {
  stats    = signal<StatsGlobales | null>(null);
  services = signal<ServiceSante[]>([]);
  private refreshTimer: any;
  search  = '';
  fType   = '';
  fStatut = '';
  fDate   = '';
 filtrer() {
    this.txservice.charger({
      search: this.search || undefined,
      type:   (this.fType   as any) || undefined,
      statut: (this.fStatut as any) || undefined,
      date:   this.fDate   || undefined,
      page: 1
    }).subscribe();
  }
  reinitialiser() {
    this.search = ''; this.fType = ''; this.fStatut = ''; this.fDate = '';
    this.txservice.reinitialiser();
  }
  exporter() {
    this.txservice.exportCSV().subscribe(blob => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = `Mydirectcash-${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
      
    });
  }
 pages = () => Array.from({ length: this.txservice.totalPages() }, (_, i) => i + 1);

  constructor(private http: HttpClient, public txservice:TransactionService) {}

  ngOnInit() {
    this.chargerStats();
    this.verifierServices();
    this.refreshTimer = setInterval(() => this.chargerStats(), 30000);
    this.txservice.charger().subscribe()
    
  }

  ngOnDestroy() { clearInterval(this.refreshTimer); }

  chargerStats() {
    this.http.get<StatsGlobales>(`${environment.apiUrl}/compte.php?action=supervision`).subscribe({
      next: s =>{
        this.stats.set(s)
        //  this.currentPage.set(1)
        } ,
      error: () => this.stats.set({
        utilisateurs_actifs: 1247, volume_retrait: 4200000,
        nb_transactions_jour: 312, disponibilite: 99.8, volume_envoi: 280000000
      })
    });
  }

  verifierServices() {
    this.http.get<ServiceSante[]>(`${environment.apiUrl}/config.php?action=health`).subscribe({
      next: s => this.services.set(s),
      error: () => this.services.set([
        { nom:'🔐 Auth',          fichier:'auth.php',         statut:'operationnel', latence_ms:12  },
        { nom:'📱 OTP',           fichier:'otp.php',          statut:'operationnel', latence_ms:8   },
        { nom:'💸 Transactions',  fichier:'transaction.php',  statut:'operationnel', latence_ms:45  },
        { nom:'🏦 Comptes',       fichier:'compte.php',       statut:'operationnel', latence_ms:15  },
        { nom:'📋 Journaux',      fichier:'log.php',          statut:'operationnel', latence_ms:6   },
        { nom:'🔔 Notifications', fichier:'notification.php', statut:'degrade',      latence_ms:892 },
        { nom:'🗄️ MySQL',         fichier:'config.php',       statut:'operationnel', latence_ms:3   },
      ])
    });
  }
  txIcon(type: string): string {
    return type === 'depot' ? '⬇️' : type === 'envoi' ? '➡️' : '⬆️';
  }
  typeClass(type: string) { return type === 'depot' ? 'info' : type === 'envoi' ? 'danger' : 'warn'; }
  statutClass(s: string)  { return s === 'valide' ? 'success' : s === 'en_cours' ? 'warn' : 'danger'; }
  isPos(type: string)     { return type === 'depot'; }
  formatVol(v: number): string {
    return v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : (v / 1000).toFixed(0) + 'k';
  }

  sClass(statut: string): string {
    return statut === 'operationnel' ? 'success' : statut === 'degrade' ? 'warn' : 'danger';
  }

  sLabel(statut: string): string {
    return statut === 'operationnel' ? '● OPÉRATIONNEL' : statut === 'degrade' ? '● DÉGRADÉ' : '● HORS SERVICE';
  }

  
   // Pagination 
  // readonly pageSige=8
  // currentPage=signal(1)
  // readonly totalPage= computed (()=>
  // Math.max(1,Math.ceil(this.txservice.total()/ this.pageSige)))
  // readonly historique=computed(()=>{
  //   const start=(this.currentPage()-1) * this.pageSige
  //   return this.txservice.transactions().slice(start, start + this.pageSige)
  // })
  // prevPage(){
  //   if (this.currentPage() > 1) {
  //     this.currentPage.update(p=>p-1)
  //   }
  // }
  // nextPage(){
  //   if (this.currentPage() < this.totalPage()) {
  //     this.currentPage.update(p=>p+1)
  //   }
  // }
  
}
