// src/app/securite/logs/logs.component.ts
import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogService } from '../../shared/services/log.service';

@Component({
  selector: 'app-logs',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './logs.component.html',
  styleUrls: ['./logs.component.css']
})
export class LogsComponent implements OnInit, OnDestroy {
  filtre      = signal('');
  private refreshTimer: any;

  logsFiltres = () => {
    const f = this.filtre();
    return f ? this.logService.logs().filter(l => l.type === f) : this.logService.logs();
  };

  stats = () => ({
    ok:    this.logService.logs().filter(l => ['AUTH','TXN','JWT'].includes(l.type)).length,
    block: this.logService.logs().filter(l => l.type === 'BLOCK').length,
    warn:  this.logService.logs().filter(l => ['WARN','XSS','FAIL'].includes(l.type)).length,
  });

  logClass(type: string): string {
    const m: Record<string,string> = { AUTH:'ok', TXN:'ok', JWT:'ok', INFO:'info', WARN:'warn', XSS:'warn', FAIL:'err', BLOCK:'block' };
    return m[type] ?? 'info';
  }

  demos = [
    { type: 'AUTH',  message: 'Connexion réussie DC-237-0099 (2FA validé)' },
    { type: 'WARN',  message: 'Injection SQL bloquée : UNION SELECT FROM comptes' },
    { type: 'BLOCK', message: 'IP 197.34.xx.xx bloquée — brute force détecté' },
    { type: 'TXN',   message: 'Transaction DC-TXN-' + Math.random().toString(36).substr(2,8) + ' validée' },
    { type: 'XSS',   message: 'Payload XSS dans champ motif — sanitisé' },
  ];
  demoIdx = 0;

  simuler() {
    const d = this.demos[this.demoIdx++ % this.demos.length];
    this.logService.ajouterLocal({ type: d.type as any, message: d.message });
  }

  constructor(public logService: LogService) {}

  ngOnInit() {
    this.logService.chargerLogs().subscribe();
    this.refreshTimer = setInterval(() => this.logService.chargerLogs().subscribe(), 30000);
  }

  ngOnDestroy() { clearInterval(this.refreshTimer); }
}
