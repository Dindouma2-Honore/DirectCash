import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../shared/services/auth.service';
import { ToastService } from '../../shared/services/toast.service';

@Component({
  selector: 'app-parametres-2fa',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './parametres-2fa.component.html',
  styleUrls: ['./parametres-2fa.component.css']
})
export class Parametres2faComponent {
  methodeChoisie = 'sms';
  pinForm: FormGroup;

  options = signal([
    { label: '📱 OTP par SMS',           actif: true  },
    { label: '📧 Alertes par email',      actif: false },
    { label: '⏱️ Expiration OTP : 5 min', actif: true  },
    { label: '🔒 Limite : 3 essais',      actif: true  },
  ]);

  methodesOtp = [
    { val: 'sms',           label: 'SMS',              detail: '+237 677 *** 456' },
    { val: 'email',         label: 'Email',             detail: 'j***.k***@gmail.com' },
    { val: 'authenticator', label: 'Authenticator App', detail: 'Google Authenticator, Authy…' },
  ];

  sessions = signal([
    { id: 1, appareil: '💻 Chrome 120 — Windows',     localisation: 'Yaoundé', date: 'Maintenant', actuel: true  },
    { id: 2, appareil: '📱 App Android — DirectCash',  localisation: 'Douala',  date: 'il y a 2h', actuel: false },
  ]);

  codesBackup = ['DC-BAK-A1B2-C3D4','DC-BAK-E5F6-G7H8','DC-BAK-I9J0-K1L2','DC-BAK-M3N4-O5P6'];

  constructor(private fb: FormBuilder, public auth: AuthService, private toast: ToastService) {
    this.pinForm = this.fb.group({
      ancien:       ['', [Validators.required, Validators.minLength(4)]],
      nouveau:      ['', [Validators.required, Validators.minLength(4)]],
      confirmation: ['', Validators.required]
    });
  }

  toggleOption(idx: number) {
    this.options.update(l => l.map((o, i) => i === idx ? { ...o, actif: !o.actif } : o));
    this.toast.success('Paramètre mis à jour ✅');
  }

  sauvegarderMethode() { this.toast.success('Méthode OTP mise à jour ✅'); }

  changerPin() {
    if (this.pinForm.invalid) { this.pinForm.markAllAsTouched(); return; }
    if (this.pinForm.value.nouveau !== this.pinForm.value.confirmation) {
      this.toast.error('Les PINs ne correspondent pas.'); return;
    }
    this.toast.success('PIN mis à jour ✅');
    this.pinForm.reset();
  }

  revoquerSession(id: number) {
    this.sessions.update(l => l.filter(s => s.id !== id));
    this.toast.success('Session révoquée ✅');
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
