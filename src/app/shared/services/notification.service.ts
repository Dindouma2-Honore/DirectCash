// src/app/shared/services/notification.service.ts
import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { Notification } from '../models/log.model';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly API = environment.apiUrl;
  private _notifs = signal<Notification[]>([]);
  readonly notifications = this._notifs.asReadonly();
  readonly nonLues = () => this._notifs().filter(n => !n.lu).length;

  constructor(private http: HttpClient) {}

  charger() {
    return this.http.get<Notification[]>(`${this.API}/notification.php`).pipe(
      tap(n => this._notifs.set(n))
    );
  }
  marquerLu(id: number) {
    return this.http.put(`${this.API}/notification.php?id=${id}`, {}).pipe(
      tap(() => this._notifs.update(l => l.map(n => n.id === id ? { ...n, lu: true } : n)))
    );
  }
  marquerToutLu() {
    return this.http.put(`${this.API}/notification.php?action=tout_lire`, {}).pipe(
      tap(() => this._notifs.update(l => l.map(n => ({ ...n, lu: true }))))
    );
  }
}
