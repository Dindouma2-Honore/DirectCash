import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BeneficiaireFrequent, TransactionService } from '../../shared/services/transaction.service';
import { CompteService } from '../../shared/services/compte.service';
import { AuthService } from '../../shared/services/auth.service';
import { ToastService } from '../../shared/services/toast.service';

@Component({
  selector: 'app-envoi',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './envoi.component.html',
  styleUrls: ['./envoi.component.css']
})
export class EnvoiComponent implements OnInit {
  form: FormGroup;
  otpCodes   = ['','','','','',''];
  montant    = signal(0);
  frais      = signal(0);
  total      = signal(0);
  destInfo   = signal('');
  idemKey    = signal('');
  showOtp    = signal(false);
  loading    = signal(false);
  erreur     = signal('');
 
  beneficiaires = signal<BeneficiaireFrequent[]>([]);
  

  constructor(
    private fb: FormBuilder,
    private txService: TransactionService,
    public  compte: CompteService,
    private auth: AuthService,
    private toast: ToastService
  ) {
    this.form = this.fb.group({
      compte_dest: ['', [Validators.required, Validators.pattern(/^DC-\d{3}-\d{4}$/)]],
      montant:     [null as number | null, [Validators.required, Validators.min(100)]],
      motif:       ['']
    });
  }

  ngOnInit() {
    this.compte.charger().subscribe();
    this.idemKey.set(this.txService.genererCleIdempotence());
     this.txService.getBeneficiairesFrequents().subscribe({
    next: data => this.beneficiaires.set(data),
    error: ()  => {} // silencieux si vide
  });
  }

  isInvalid(f: string) { const c = this.form.get(f)!; return c.invalid && (c.dirty || c.touched); }

  updatePreview() {
    const m = Number(this.form.value.montant) || 0;
    const f = Math.round(m * 0.005);
    this.montant.set(m); this.frais.set(f); this.total.set(m + f);
  }

setDest(b: BeneficiaireFrequent) {
  this.form.patchValue({ compte_dest: b.compte_dest });
  this.destInfo.set(`${b.prenom} ${b.nom}`);
}

 verifierDest() {
  const c = this.form.value.compte_dest;
  const b = this.beneficiaires().find(x => x.compte_dest === c); // ✅ signal() + bon champ
  this.destInfo.set(b ? `${b.prenom} ${b.nom}` : '');
}

  otpInput(e: Event, idx: number) {
    const el = e.target as HTMLInputElement;
    const v  = el.value.replace(/\D/,'').slice(-1);
    this.otpCodes[idx] = v; el.value = v;
    if (v && idx < 5) (document.getElementById(`eotp${idx+1}`) as HTMLInputElement)?.focus();
  }
  otpKey(e: KeyboardEvent, idx: number) {
    if (e.key === 'Backspace' && !this.otpCodes[idx] && idx > 0) {
      this.otpCodes[idx-1] = '';
      (document.getElementById(`eotp${idx-1}`) as HTMLInputElement)?.focus();
    }
  }
  getOtp() { return this.otpCodes.join(''); }

 onSubmit() {
  if (this.form.invalid) { this.form.markAllAsTouched(); return; }

  // Étape 1 : formulaire valide, OTP pas encore affiché → envoyer l'OTP
  if (!this.showOtp()) {
    this.loading.set(true);
    this.erreur.set('');

    this.txService.sendOTPEnvoi().subscribe({
      next: res => {
        this.loading.set(false);
        this.showOtp.set(true);
        this.toast.success(`Code OTP envoyé à ${res.email_masque}`);
      },
      error: err => {
        this.loading.set(false);
        this.erreur.set(err.error?.message || 'Impossible d\'envoyer le code OTP.');
      }
    });
    return;
  }

  // Étape 2 : OTP affiché → vérifier et soumettre le transfert
  if (this.getOtp().length !== 6) { this.toast.warn('Saisissez le code OTP à 6 chiffres'); return; }
  if (this.total() > this.compte.soldeDisponible()) { this.erreur.set('Solde insuffisant.'); return; }

  this.loading.set(true); this.erreur.set('');
  this.txService.envoi({
    compte_dest:     this.form.value.compte_dest!,
    montant:         this.montant(),
    motif:           this.form.value.motif || undefined,
    idempotency_key: this.idemKey(),
    otp:             this.getOtp()
  }).subscribe({
    next: res => {
      this.loading.set(false);
      this.compte.majSolde(res.nouveau_solde);
      this.toast.success(`${this.montant().toLocaleString('fr-FR')} FCFA envoyés à ${this.form.value.compte_dest}`);
      this.form.reset(); this.showOtp.set(false);
      this.otpCodes = ['','','','','','']; this.montant.set(0); this.frais.set(0); this.total.set(0);
      this.idemKey.set(this.txService.genererCleIdempotence());
    },
    error: err => {
      this.loading.set(false);
      this.erreur.set(err.error?.message || 'Erreur lors du transfert.');
      this.showOtp.set(false);
    }
  });
}
}
