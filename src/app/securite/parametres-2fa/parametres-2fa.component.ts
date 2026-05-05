import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../shared/services/auth.service';
import { ToastService } from '../../shared/services/toast.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
 interface Session {
  id: number;
  appareil: string;
  localisation: string;
  date: string;
  actuel: boolean;
}
@Component({
  selector: 'app-parametres-2fa',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './parametres-2fa.component.html',
  styleUrls: ['./parametres-2fa.component.css']
})
export class Parametres2faComponent implements OnInit {
  methodeChoisie = 'email';
  pinForm: FormGroup;
    private readonly API = environment.apiUrl;
  options = signal([
    { label: '📱 OTP par SMS',           actif: false  },
    { label: '📧 Alertes par email',      actif: true },
    { label: '⏱️ Expiration OTP : 5 min', actif: true  },
    { label: '🔒 Limite : 3 essais',      actif: true  },
  ]);

  methodesOtp = [
    { val: 'sms',           label: 'SMS',              detail: '+237 673 52 52 78' },
    { val: 'email',         label: 'Email',             detail: 'dindoumahonore@gmail.com' },
    // { val: 'authenticator', label: 'Authenticator App', detail: 'Google Authenticator, Authy…' },
  ];

  sessions = signal<Session[]>([]);

  codesBackup = ['DC-BAK-A1B2-C3D4','DC-BAK-E5F6-G7H8','DC-BAK-I9J0-K1L2','DC-BAK-M3N4-O5P6'];

  constructor(private fb: FormBuilder, public auth: AuthService, private toast: ToastService, private http:HttpClient) {
    this.pinForm = this.fb.group({
      ancien:       ['', [Validators.required, Validators.minLength(4)]],
      nouveau:      ['', [Validators.required, Validators.minLength(4)]],
      confirmation: ['', Validators.required]
    });
  }
  ngOnInit() {
  this.http.get<Session[]>(`${this.API}/compte.php?action=sessions`)
    .subscribe({
      next: data => this.sessions.set(data.slice(0, 5)), // 5 dernières
      error: ()  => this.toast.error('Impossible de charger les sessions.')
    });
}
  toggleOption(idx: number) {
    this.options.update(l => l.map((o, i) => i === idx ? { ...o, actif: !o.actif } : o));
    this.toast.success('Paramètre mis à jour ✅');
  }

  sauvegarderMethode() { this.toast.success('Méthode OTP mise à jour ✅'); }

 changerPin() {
  console.log('TOKEN:', this.auth.getToken());
  if (this.pinForm.invalid) { this.pinForm.markAllAsTouched(); return; }
  if (this.pinForm.value.nouveau !== this.pinForm.value.confirmation) {
    this.toast.error('Les PINs ne correspondent pas.'); return;
  }

  this.http.put(`${this.API}/compte.php?action=changer_pin`, {
    ancien_pin: this.pinForm.value.ancien,
    nouveau_pin: this.pinForm.value.nouveau
  }).subscribe({
    next: () => {
      this.toast.success('PIN mis à jour ✅');
      this.pinForm.reset();
    },
    error: (err) => {
      const msg = err?.error?.message ?? 'Erreur lors du changement de PIN.';
      this.toast.error(msg);
    }
  });
}

 revoquerSession(id: number) {
  this.http.delete(`${this.API}/compte.php?action=revoquer_session&id=${id}`)
    .subscribe({
      next: () => {
        this.sessions.update(l => l.filter(s => s.id !== id));
        this.toast.success('Session révoquée ✅');
      },
      error: () => this.toast.error('Impossible de révoquer cette session.')
    });
}

  copierCodes() {
    navigator.clipboard.writeText(this.codesBackup.join('\n'))
      .then(()  => this.toast.success('Codes copiés ✅'))
      .catch(() => this.toast.error('Copie impossible.'));
  }

  isInvalidPin(f: string) {
    const c = this.pinForm.get(f)!;
    return c.invalid && (c.dirty || c.touched);
  }
}
