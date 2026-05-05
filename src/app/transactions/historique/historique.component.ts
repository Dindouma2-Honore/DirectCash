// src/app/transactions/historique/historique.component.ts
import { Component, computed, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../shared/services/transaction.service';
import { ToastService } from '../../shared/services/toast.service';
import { Transaction } from '../../shared/models/transaction.model';

@Component({
  selector: 'app-historique',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './historique.component.html',
  styleUrls: ['./historique.component.css']
})
export class HistoriqueComponent implements OnInit {
  search  = '';
  fType   = '';
  fStatut = '';
  fDate   = '';
  detail  = signal<Transaction | null>(null);

  pages = () => Array.from({ length: this.txService.totalPages() }, (_, i) => i + 1);

  constructor(public txService: TransactionService, private toast: ToastService) {}

  ngOnInit() { this.txService.charger().subscribe(); }

  filtrer() {
    this.txService.charger({
      search: this.search || undefined,
      type:   (this.fType   as any) || undefined,
      statut: (this.fStatut as any) || undefined,
      date:   this.fDate   || undefined,
      page: 1
    }).subscribe();
  }

  reinitialiser() {
    this.search = ''; this.fType = ''; this.fStatut = ''; this.fDate = '';
    this.txService.reinitialiser();
  }

  txIcon(type: string) { return type === 'depot' ? '⬇️' : type === 'envoi' ? '➡️' : '⬆️'; }
  typeClass(type: string) { return type === 'depot' ? 'info' : type === 'envoi' ? 'danger' : 'warn'; }
  statutClass(s: string)  { return s === 'valide' ? 'success' : s === 'en_cours' ? 'warn' : 'danger'; }
  isPos(type: string)     { return type === 'depot'; }

  exporter() {
    this.txService.exportCSV().subscribe(blob => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = `directcash-${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
      this.toast.success('Fichier CSV téléchargé');
    });
  }

  ouvrirDetail(tx: Transaction) { this.detail.set(tx); }
  fermerDetail()                { this.detail.set(null); }
 
}
