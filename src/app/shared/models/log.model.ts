// src/app/shared/models/log.model.ts
export type LogType = 'AUTH' | 'TXN' | 'WARN' | 'FAIL' | 'BLOCK' | 'XSS' | 'JWT' | 'INFO';

export interface LogEntry {
  id: number;
  type: LogType;
  message: string;
  ip?: string;
  created_at: string;
}

export interface Alerte {
  id: number;
  titre: string;
  description: string;
  severite: 'critique' | 'haute' | 'moyenne' | 'basse';
  statut: 'active' | 'resolue' | 'ignoree';
  type: 'sql_injection' | 'xss' | 'brute_force' | 'autre';
  ip?: string;
  created_at: string;
}

export interface Notification {
  id: number;
  titre: string;
  corps: string;
  lu: boolean;
  type: 'transaction' | 'securite' | 'systeme';
  created_at: string;
}
