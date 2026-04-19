// src/app/shared/services/compte.service.ts
import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { CompteInfo } from '../models/transaction.model';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CompteService {
  private readonly API = environment.apiUrl;
  private _compte = signal<CompteInfo | null>(null);
  readonly compte  = this._compte.asReadonly();

  constructor(private http: HttpClient) {}

  charger() {
    return this.http.get<CompteInfo>(`${this.API}/compte.php`).pipe(
      tap(c => this._compte.set(c))
    );
  }
  majSolde(solde: number) {
    this._compte.update(c => c ? { ...c, solde } : null);
  }
  soldeDisponible(): number { return this._compte()?.solde ?? 0; }
}
