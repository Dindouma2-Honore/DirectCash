// src/app/shared/models/transaction.model.ts
export type TxType   = 'depot' | 'envoi' | 'retrait';
export type TxStatut = 'valide' | 'en_cours' | 'echoue' | 'annule';

export interface Transaction {
  id: number;
  code: string;
  type: TxType;
  compte_source: string;
  compte_dest?: string;
  montant: number;
  frais: number;
  motif?: string;
  statut: TxStatut;
  idempotency_key: string;
  created_at: string;
}

export interface StatsMois {
  depot:   { total: number; nb: number };
  envoi:   { total: number; nb: number };
  retrait: { total: number; nb: number };
}

export interface TransactionFilters {
  search?: string;
  type?: TxType | '';
  statut?: TxStatut | '';
  date?: string;
  page: number;
  limit: number;
}

export interface CompteInfo {
  numero: string;
  solde: number;
  solde_bloque: number;
  plafond_journalier: number;
  plafond_mensuel: number;
  depense_jour: number;
  depense_mois: number;
}
