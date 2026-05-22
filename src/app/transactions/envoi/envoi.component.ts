import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { BeneficiaireFrequent, TransactionService } from '../../shared/services/transaction.service';
import { CompteService } from '../../shared/services/compte.service';
import { AuthService } from '../../shared/services/auth.service';
import { ToastService } from '../../shared/services/toast.service';

type ModeEnvoi = 'compte' | 'telephone';

function telephoneEnvoiValidator(control: AbstractControl): ValidationErrors | null {
  const group = control.parent as FormGroup | null;
  if (!group) return null;
  const mode = group.get('mode_envoi')?.value;
  if (mode !== 'telephone') return null;
  const operateur = group.get('operateur')?.value as string;
  const valeur = (control.value ?? '').replace(/\s/g, '');
  if (!valeur) return null;
  const patterns: Record<string, RegExp> = {
    orange_money: /^(69[0-9]|65[0-9]|68[6-9])\d{6}$/,
    mtn_momo:     /^(67[0-9]|68[0-5])\d{6}$/,
  };
  const regex = patterns[operateur];
  if (!regex) return null;
  return regex.test(valeur) ? null : { telephoneInvalide: true };
}

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
  nomDest    = signal('');        // Nom complet du titulaire du compte destinataire
  idemKey    = signal('');
  showOtp    = signal(false);
  loading    = signal(false);
  loadingDest = signal(false);   // Chargement pendant la vérification du compte
  erreur     = signal('');
  modeEnvoi  = signal<ModeEnvoi>('compte');
  beneficiaires = signal<BeneficiaireFrequent[]>([]);

  readonly hintTelephone = () => {
    const op = this.form?.get('operateur')?.value;
    return op === 'orange_money' ? 'Numéro Orange Money (69X / 65X)' : 'Numéro MTN MoMo (67X / 68X)';
  };

  constructor(
    private fb: FormBuilder,
    private txService: TransactionService,
    public  compte: CompteService,
    private auth: AuthService,
    private toast: ToastService
  ) {
    this.form = this.fb.group({
      mode_envoi:  ['compte'],
      // Mode compte
      compte_dest: ['', [Validators.pattern(/^DC-\d{3}-\d{4}$/)]],
      // Mode téléphone
      operateur:   ['orange_money'],
      telephone:   ['', [telephoneEnvoiValidator]],
      // Commun
      montant:     [null as number | null, [Validators.required, Validators.min(100)]],
      motif:       ['']
    });
  }

  ngOnInit() {
    this.compte.charger().subscribe();
    this.idemKey.set(this.txService.genererCleIdempotence());
    this.txService.getBeneficiairesFrequents().subscribe({
      next: data => this.beneficiaires.set(data),
      error: () => {}
    });

    // Réagir au changement de mode
    this.form.get('mode_envoi')!.valueChanges.subscribe((mode: ModeEnvoi) => {
      this.modeEnvoi.set(mode);
      this.destInfo.set('');
      this.nomDest.set('');
      this.erreur.set('');
      // Ajuster les validateurs dynamiquement
      const compteDest = this.form.get('compte_dest')!;
      const telephone  = this.form.get('telephone')!;
      if (mode === 'compte') {
        compteDest.setValidators([Validators.required, Validators.pattern(/^DC-\d{3}-\d{4}$/)]);
        telephone.clearValidators();
        telephone.setValue('');
      } else {
        telephone.setValidators([Validators.required, telephoneEnvoiValidator]);
        compteDest.clearValidators();
        compteDest.setValue('');
      }
      compteDest.updateValueAndValidity();
      telephone.updateValueAndValidity();
    });

    // Réagir au changement d'opérateur → re-valider téléphone
    this.form.get('operateur')!.valueChanges.subscribe(() => {
      this.form.get('telephone')!.updateValueAndValidity();
    });
  }

  isInvalid(f: string) { const c = this.form.get(f)!; return c.invalid && (c.dirty || c.touched); }

  erreurTelephone(): string {
    const ctrl = this.form.get('telephone')!;
    if (!ctrl.dirty && !ctrl.touched) return '';
    if (ctrl.hasError('required')) return 'Numéro requis.';
    if (ctrl.hasError('telephoneInvalide')) {
      const op = this.form.get('operateur')!.value;
      return op === 'orange_money'
        ? 'Numéro invalide. Utilisez 69X ou 65X (ex: 691234567)'
        : 'Numéro invalide. Utilisez 67X ou 68X (ex: 671234567)';
    }
    return '';
  }

  updatePreview() {
    const m = Number(this.form.value.montant) || 0;
    const f = Math.round(m * 0.005);
    this.montant.set(m); this.frais.set(f); this.total.set(m + f);
  }

  setDest(b: BeneficiaireFrequent) {
    this.form.patchValue({ compte_dest: b.compte_dest, mode_envoi: 'compte' });
    this.modeEnvoi.set('compte');
    this.destInfo.set(`${b.prenom} ${b.nom}`);
    this.nomDest.set(`${b.prenom} ${b.nom}`);
  }

  verifierDest() {
    const c = this.form.value.compte_dest?.trim();
    if (!c || !/^DC-\d{3}-\d{4}$/.test(c)) {
      this.destInfo.set('');
      this.nomDest.set('');
      return;
    }

    // D'abord chercher dans les bénéficiaires fréquents (sans appel réseau)
    const b = this.beneficiaires().find(x => x.compte_dest === c);
    if (b) {
      const nom = `${b.prenom} ${b.nom}`;
      this.destInfo.set(nom);
      this.nomDest.set(nom);
      return;
    }

    // Sinon appel backend
    this.loadingDest.set(true);
    this.nomDest.set('');
    this.txService.verifierCompteDest(c).subscribe({
      next: res => {
        const nom = `${res.prenom} ${res.nom}`;
        this.destInfo.set(nom);
        this.nomDest.set(nom);
        this.loadingDest.set(false);
      },
      error: () => {
        this.destInfo.set('');
        this.nomDest.set('');
        this.loadingDest.set(false);
      }
    });
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

    // Étape 1 : envoyer OTP
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
          this.erreur.set(err.error?.message || "Impossible d'envoyer le code OTP.");
        }
      });
      return;
    }

    // Étape 2 : confirmer le transfert
    if (this.getOtp().length !== 6) { this.toast.warn('Saisissez le code OTP à 6 chiffres'); return; }
    if (this.total() > this.compte.soldeDisponible()) { this.erreur.set('Solde insuffisant.'); return; }

    const mode = this.modeEnvoi();
    const dest = mode === 'compte'
      ? this.form.value.compte_dest!
      : this.form.value.telephone!.replace(/\s/g, '');

    this.loading.set(true);
    this.erreur.set('');

    this.txService.envoi({
      compte_dest:     dest,
      montant:         this.montant(),
      motif:           this.form.value.motif || undefined,
      idempotency_key: this.idemKey(),
      otp:             this.getOtp(),
      mode_envoi:      mode,
      operateur:       mode === 'telephone' ? this.form.value.operateur : undefined,
    }).subscribe({
      next: res => {
        this.loading.set(false);
        this.compte.majSolde(res.nouveau_solde);
        this.toast.success(`${this.montant().toLocaleString('fr-FR')} FCFA envoyés`);
        this.form.reset({ mode_envoi: 'compte', operateur: 'orange_money' });
        this.showOtp.set(false);
        this.otpCodes = ['','','','','',''];
        this.montant.set(0); this.frais.set(0); this.total.set(0);
        this.modeEnvoi.set('compte');
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