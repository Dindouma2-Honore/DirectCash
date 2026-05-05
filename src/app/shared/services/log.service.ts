// src/app/shared/services/log.service.ts
import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { tap } from 'rxjs';
import { LogEntry, Alerte } from '../models/log.model';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class LogService {
  private readonly API = environment.apiUrl;
  private _logs = signal<LogEntry[]>([]);
  private _alertes = signal<Alerte[]>([]);
  private _loading = signal(false);

  readonly logs = this._logs.asReadonly();
  readonly alertes = this._alertes.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly alertesActives = () => this._alertes().filter(a => a.statut === 'active');
  constructor(private http: HttpClient, private auth: AuthService) { }
  private get headers(): HttpHeaders {
  const token = localStorage.getItem('dc_token') ?? '';
  return new HttpHeaders({ Authorization: `Bearer ${token}` });
}

  chargerLogs(type?: string) {
    this._loading.set(true);
    let url = `${this.API}/log.php`;
    if (type) url += `?type=${type}`;
    return this.http.get<LogEntry[]>(url).pipe(
      tap(l => { this._logs.set(l); this._loading.set(false); })
    );
  }

 chargerAlertes() {
  return this.http.get<Alerte[]>(
    `${this.API}/log.php?action=alertes`,
    { headers: this.headers }
  ).pipe(
    tap(alertes => {
      console.log('Alertes reçues :', alertes); // ← voir dans F12 Console
      const normalized = alertes.map(a => ({
        ...a,
        created_at: a.created_at?.replace(' ', 'T') ?? ''
      }));
      this._alertes.set(normalized);
    })
  );
}

  resoudre(id: number) {
    return this.http.put(`${this.API}/log.php?action=resoudre&id=${id}`, {}).pipe(
      tap(() => this._alertes.update(list => list.map(a => a.id === id ? { ...a, statut: 'resolue' as const } : a)))
    );
  }

  ajouterLocal(entry: Omit<LogEntry, 'id' | 'created_at'>) {
    this._logs.update(l => [{
      ...entry, id: Date.now(), created_at: new Date().toISOString()
    }, ...l]);
  }
}
