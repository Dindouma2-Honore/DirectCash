// src/app/shared/services/toast.service.ts
import { Injectable, signal } from '@angular/core';

export interface Toast { id: number; message: string; type: 'success'|'error'|'warn'|'info'; }

@Injectable({ providedIn: 'root' })
export class ToastService {
  private _toasts = signal<Toast[]>([]);
  readonly toasts  = this._toasts.asReadonly();
  private id = 0;

  private add(message: string, type: Toast['type']) {
    const id = ++this.id;
    this._toasts.update(t => [...t, { id, message, type }]);
    setTimeout(() => this._toasts.update(t => t.filter(x => x.id !== id)), 3500);
  }
  success(m: string) { this.add(m, 'success'); }
  error(m: string)   { this.add(m, 'error');   }
  warn(m: string)    { this.add(m, 'warn');     }
  info(m: string)    { this.add(m, 'info');     }
  dismiss(id: number){ this._toasts.update(t => t.filter(x => x.id !== id)); }
}
