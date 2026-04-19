// src/app/shared/components/toast/toast-container.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast-item" [class]="t.type" (click)="toast.dismiss(t.id)">
          <span class="toast-icon">
            {{ t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : t.type === 'warn' ? '⚠️' : 'ℹ️' }}
          </span>
          <span class="toast-msg">{{ t.message }}</span>
          <button class="toast-close">✕</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed; bottom: 1.5rem; right: 1.5rem;
      z-index: 9999; display: flex; flex-direction: column;
      gap: .5rem; max-width: 340px; pointer-events: none;
    }
    .toast-item {
      background: #111827; border: 1px solid #243347;
      border-radius: 12px; padding: .875rem 1rem;
      font-size: 13.5px; font-weight: 500;
      display: flex; align-items: center; gap: .75rem;
      box-shadow: 0 8px 30px rgba(0,0,0,.5);
      border-left: 4px solid #69f0ae;
      animation: slideUp .3s ease;
      pointer-events: all; cursor: pointer;
      color: #e8eaf0; font-family: 'DM Sans', sans-serif;
    }
    .toast-item.error   { border-left-color: #ff5252; }
    .toast-item.warn    { border-left-color: #ffb74d; }
    .toast-item.info    { border-left-color: #4fc3f7; }
    .toast-msg   { flex: 1; }
    .toast-close { background: none; border: none; cursor: pointer; color: #4a5568; font-size: 12px; padding: 0; margin-left: auto; }
    @keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  `]
})
export class ToastContainerComponent {
  constructor(public toast: ToastService) {}
}
