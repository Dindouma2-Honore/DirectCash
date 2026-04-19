// src/app/shared/interceptors/error.interceptor.ts
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth  = inject(AuthService);
  const toast = inject(ToastService);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      // En mode démo, ignorer les erreurs réseau
      if (auth.demoMode() && (err.status === 0 || err.status === 503)) {
        return throwError(() => err);
      }

      switch (err.status) {
        case 0:
        case 503:
          // Pas de toast — l'auth service gère le fallback démo silencieusement
          break;
        case 401:
          // Ne déconnecter que si le token est réel (pas demo)
          if (!auth.getToken()?.startsWith('demo.')) {
            toast.error('Session expirée. Reconnectez-vous.');
            auth.logout();
          }
          break;
        case 403:
          toast.error('Accès refusé.');
          break;
        case 422:
          toast.error(err.error?.message || 'Données invalides.');
          break;
        case 429:
          toast.warn('Trop de requêtes. Patientez quelques instants.');
          break;
        default:
          if (err.status >= 500) {
            toast.error('Erreur serveur. Réessayez plus tard.');
          }
      }
      return throwError(() => err);
    })
  );
};
