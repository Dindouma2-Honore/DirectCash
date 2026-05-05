// src/app/shared/services/auth.service.ts
import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap, catchError, of, throwError, delay } from 'rxjs';
import { User } from '../models/user.model';
import { environment } from '../../../environments/environment';

// ─────────────────────────────────────────────────────────────
// Comptes de démo — utilisés automatiquement si le backend PHP
// est inaccessible (XAMPP éteint, CORS, etc.)
// ─────────────────────────────────────────────────────────────
const DEMO_USERS: Record<string, { mdp: string; user: User }> = {
  'DC-237-0001': {
    mdp: 'DirectCash2024!',
    user: {
      id: 1, compte: 'DC-237-0001',
      nom: 'Dindouma', prenom: 'Honoré',
      email: 'dindoumahonorea@gmail.com', telephone: '+237673525278',
      role: 'admin', statut: 'actif', solde: 150000,
      twofa_active: true, created_at: '2024-01-15', last_login: 'Maintenant'
    }
  },
  'DC-237-0099': {
    mdp: 'DirectCash2024!',
    user: {
      id: 2, compte: 'DC-237-0099',
      nom: 'Descartes', prenom: 'Dindouma',
      email: 'dindoumahonore3@gmail.com', telephone: '+237699456789',
      role: 'client', statut: 'actif', solde: 75500,
      twofa_active: true, created_at: '2024-02-10', last_login: 'il y a 2h'
    }
  },
  'DC-237-0175': {
    mdp: 'DirectCash2024!',
    user: {
      id: 4, compte: 'DC-237-0175',
      nom: 'Dindouma', prenom: 'Avenir',
      email: 's.ekane@directcash.cm', telephone: '+237670786725',
      role: 'gestionnaire', statut: 'actif', solde: 320000,
      twofa_active: true, created_at: '2024-01-20', last_login: 'il y a 1j'
    }
  }
};

// Code OTP fixe pour tous les comptes en mode démo
const DEMO_OTP = '482917';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly API = environment.apiUrl;

  private _user          = signal<User | null>(null);
  private _token         = signal<string | null>(null);
  private _otpPending    = signal(false);
  private _otpCompte     = signal<string | null>(null);
  private _loginAttempts = signal(3);
  private _demoMode      = signal(false);

  readonly user            = this._user.asReadonly();
  readonly token           = this._token.asReadonly();
  readonly otpPending      = this._otpPending.asReadonly();
  readonly loginAttempts   = this._loginAttempts.asReadonly();
  readonly demoMode        = this._demoMode.asReadonly();
  readonly isAuthenticated = computed(() => !!this._user() && !!this._token());
  readonly isAdmin         = computed(() => this._user()?.role === 'admin');
  readonly isGestionnaire  = computed(() =>
    ['admin', 'gestionnaire'].includes(this._user()?.role ?? '')
  );
  readonly nomComplet = computed(() =>
    this._user() ? `${this._user()!.nom} ${this._user()!.prenom}` : ''
  );
  readonly initiales = computed(() => {
    const u = this._user();
    return u ? `${u.nom.charAt(0)}${u.prenom.charAt(0)}` : '??';
  });
   
  constructor(private http: HttpClient, private router: Router) {
    this.restoreSession();
  }

  // ── ÉTAPE 1 : identifiants ──────────────────────────────────
  login(compte: string, motDePasse: string) {
    return this.http.post<{ otp_required: boolean }>(
      `${this.API}/auth.php?action=login`,
      { compte, mot_de_passe: motDePasse }
    ).pipe(
      tap(() => {
        this._otpPending.set(true);
        this._otpCompte.set(compte);
        this._loginAttempts.set(3);
        this._demoMode.set(false);
        this.router.navigate(['/auth/otp']);
      }),
      catchError(err => {
        // Backend inaccessible → bascule en mode démo
        if (err.status === 0 || err.status === 503 || err.status === 404) {
          return this.loginDemo(compte, motDePasse);
        }
        // Mauvais identifiants (401 du backend)
        this._loginAttempts.update(v => Math.max(0, v - 1));
        return throwError(() => err);
      })
    );
  }

  // ── ÉTAPE 2 : OTP ──────────────────────────────────────────
  verifierOtp(otp: string) {
    if (this._demoMode()) {
      return this.verifierOtpDemo(otp);
    }
    return this.http.post<{ token: string; user: User }>(
      `${this.API}/otp.php?action=verify`,
      { compte: this._otpCompte(), otp }
    ).pipe(
      tap(res => this.etablirSession(res.token, res.user)),
      catchError(err => {
        if (err.status === 0 || err.status === 503) {
          return this.verifierOtpDemo(otp);
        }
        return throwError(() => err);
      })
    );
  }

  // ── INSCRIPTION ─────────────────────────────────────────────
  inscrire(data: {
    nom: string; prenom: string; email: string;
    telephone: string; mot_de_passe: string; type_compte: string;
  }) {
    return this.http.post<{ message: string; compte: string }>(
      `${this.API}/auth.php?action=register`, data
    ).pipe(
      tap(() => {
        this._otpPending.set(true);
        this._otpCompte.set(data.email);
        this.router.navigate(['/auth/otp']);
      }),
      catchError(err => {
        if (err.status === 0 || err.status === 503 || err.status === 404) {
          const fakeCompte = `DC-237-${Math.floor(Math.random() * 9000 + 1000)}`;
          DEMO_USERS[fakeCompte] = {
            mdp: data.mot_de_passe,
            user: {
              id: Date.now(), compte: fakeCompte,
              nom: data.nom.toUpperCase(), prenom: data.prenom,
              email: data.email, telephone: data.telephone,
              role: 'client', statut: 'actif', solde: 0,
              twofa_active: true, created_at: new Date().toISOString()
            }
          };
          this._otpPending.set(true);
          this._demoMode.set(true);
          this._otpCompte.set(fakeCompte);
          this.router.navigate(['/auth/otp']);
          return of({ message: 'Compte créé (démo)', compte: fakeCompte });
        }
        return throwError(() => err);
      })
    );
  }

  // ── RENVOYER OTP ────────────────────────────────────────────
  renvoyerOtp() {
    if (this._demoMode()) {
      return of({ message: `Code démo : ${DEMO_OTP}` }).pipe(delay(400));
    }
    return this.http.post(
      `${this.API}/otp.php?action=resend`,
      { compte: this._otpCompte() }
    ).pipe(
      catchError(() => of({ message: `Code démo : ${DEMO_OTP}` }))
    );
  }

  // ── DÉCONNEXION ─────────────────────────────────────────────
  logout() {
    if (this._token() && !this._demoMode()) {
      this.http.post(`${this.API}/auth.php?action=logout`, {}).subscribe();
    }
    this._user.set(null);
    this._token.set(null);
    this._otpPending.set(false);
    this._demoMode.set(false);
    localStorage.removeItem('dc_token');
    localStorage.removeItem('dc_user');
    this.router.navigate(['/auth/login']);
  }

  getToken() { return this._token(); }

  // ── PRIVÉ : login démo ──────────────────────────────────────
  private loginDemo(compte: string, motDePasse: string) {
    const entry = DEMO_USERS[compte];
    if (!entry || entry.mdp !== motDePasse) {
      this._loginAttempts.update(v => Math.max(0, v - 1));
      return throwError(() => ({
        status: 401,
        error: { message: 'Identifiants incorrects.' }
      }));
    }
    this._otpPending.set(true);
    this._otpCompte.set(compte);
    this._loginAttempts.set(3);
    this._demoMode.set(true);
    this.router.navigate(['/auth/otp']);
    return of({ otp_required: true }).pipe(delay(300));
  }

  // ── PRIVÉ : OTP démo ────────────────────────────────────────
  private verifierOtpDemo(otp: string) {
    if (otp !== DEMO_OTP) {
      return throwError(() => ({
        status: 401,
        error: { message: `Code OTP incorrect. Code démo : ${DEMO_OTP}` }
      }));
    }
    const compte = this._otpCompte()!;
    const entry  = DEMO_USERS[compte];
    if (!entry) {
      return throwError(() => ({
        status: 404,
        error: { message: 'Compte introuvable.' }
      }));
    }
    const fakeToken = `demo.${btoa(compte)}.${Date.now()}`;
    this.etablirSession(fakeToken, entry.user);
    return of({ token: fakeToken, user: entry.user }).pipe(delay(300));
  }

  // ── PRIVÉ : établir la session ──────────────────────────────
  private etablirSession(token: string, user: User) {
    this._token.set(token);
    this._user.set(user);
    this._otpPending.set(false);
    this._otpCompte.set(null);
    localStorage.setItem('dc_token', token);
    localStorage.setItem('dc_user', JSON.stringify(user));
    this.router.navigate(['/dashboard']);
  }

  // ── PRIVÉ : restaurer session au démarrage ──────────────────
private restoreSession() {
  try {
    const token = localStorage.getItem('dc_token');
    const raw   = localStorage.getItem('dc_user');
    if (token && raw) {
      this._token.set(token);
      this._user.set(JSON.parse(raw));
      if (token.startsWith('demo.')) {
        this._demoMode.set(true);
      } else {
        
        setTimeout(() => this.rafraichirProfil(), 0);
      }
    }
  } catch {
    this.logout();
  }
}


rafraichirProfil() {
  this.http.get<any>(`${this.API}/auth.php?action=profil`).subscribe({
    next: (profil) => {
      this._user.set(profil);
      localStorage.setItem('dc_user', JSON.stringify(profil));
    },
    error: () => {
      // Silencieux — on garde le user du localStorage
    }
  });
}
  //pour le stockage de la photo
  setUser(user: User) {
  this._user.set(user);
  localStorage.setItem('dc_user', JSON.stringify(user));
}
}
