// src/app/shared/guards/client.guard.ts
// Bloque l'accès des admins aux fonctionnalités réservées aux clients
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const clientGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  // Si l'utilisateur est admin, il ne peut pas accéder à envoi/retrait
  if (auth.isAdmin()) {
    return inject(Router).createUrlTree(['/dashboard']);
  }
  return true;
};
