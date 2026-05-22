import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule, FormBuilder, FormGroup,
  Validators, AbstractControl, ValidationErrors
} from '@angular/forms';
import { TransactionService } from '../../shared/services/transaction.service';
import { CompteService } from '../../shared/services/compte.service';
import { AuthService } from '../../shared/services/auth.service';
import { ToastService } from '../../shared/services/toast.service';

type Etape = 'formulaire' | 'otp';

// ── Correspondance opérateur → préfixes Cameroun ──────────────────
const PREFIXES_OPERATEUR: Record<string, RegExp> = {
  orange_money: /^(69[0-9]|65[5-9]|68[5-9])\d{6}$/,   
  mtn_momo:     /^(67[0-9]|65[0-4]|68[0-3])\d{6}$/,  
  virement:     /^[0-9]{9}$/,                  // n'importe quel numéro valide 9 chiffres
  agence:       /^[0-9]{9}$/,
};

const LABEL_OPERATEUR: Record<string, string> = {
  orange_money: 'Orange Money',
  mtn_momo:     'MTN MoMo ',
  virement:     'Numéro de compte bancaire',
  agence:       'Numéro de téléphone',
};

function telephoneValidator(control: AbstractControl): ValidationErrors | null {
  // Le validateur a besoin du groupe parent pour lire le mode
  const group = control.parent as FormGroup | null;
  if (!group) return null;
  const mode = group.get('mode')?.value as string;
  const valeur = (control.value ?? '').replace(/\s/g, '');
  if (!valeur) return null;              // requis géré par Validators.required
  const regex = PREFIXES_OPERATEUR[mode];
  if (!regex) return null;
  return regex.test(valeur) ? null : { telephoneInvalide: true };
}

@Component({
  selector: 'app-retrait',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './retrait.component.html',
  styleUrls: ['./retrait.component.css']
})
export class RetraitComponent implements OnInit {
  form: FormGroup;
  otpCodes = ['', '', '', '', '', ''];

  // ── Signals ──────────────────────────────────────────────────────
  etape       = signal<Etape>('formulaire');
  loading     = signal(false);
  erreur      = signal('');
  emailMasque = signal('');

  // ── Hint dynamique pour le champ téléphone ───────────────────────
  readonly hintTelephone = computed(() => {
    const mode = this.form?.get('mode')?.value as string;
    return LABEL_OPERATEUR[mode] ?? 'Numéro de téléphone';
  });

  plafonds = [
    { label: 'Journalier',    utilise: 50000,  max: 500000  },
    { label: 'Mensuel',       utilise: 95000,  max: 3000000 },
    { label: 'Par opération', utilise: 0,      max: 1000000 },
  ];

  constructor(
    private fb: FormBuilder,
    private txService: TransactionService,
    public  compte: CompteService,
    private auth: AuthService,
    private toast: ToastService
  ) {
    this.form = this.fb.group({
      montant:   [null as number | null, [Validators.required, Validators.min(500)]],
      mode:      ['orange_money', Validators.required],
      telephone: ['', [Validators.required, telephoneValidator]],
      pin:       ['', [Validators.required, Validators.minLength(4)]],
    });
  }

  ngOnInit() {
    this.compte.charger().subscribe();

    // Quand le mode change → re-valider le téléphone
    this.form.get('mode')!.valueChanges.subscribe(() => {
      this.form.get('telephone')!.updateValueAndValidity();
    });
  }

  isInvalid(f: string) {
    const c = this.form.get(f)!;
    return c.invalid && (c.dirty || c.touched);
  }

  erreurTelephone(): string {
    const ctrl = this.form.get('telephone')!;
    if (!ctrl.dirty && !ctrl.touched) return '';
    if (ctrl.hasError('required')) return 'Numéro de téléphone invalide.';
    if (ctrl.hasError('telephoneInvalide')) {
      const mode = this.form.get('mode')!.value as string;
      const hints: Record<string, string> = {
        orange_money: 'Le numero est invalide',
        mtn_momo:     'Le numero est invalide',
        virement:     'Numéro invalide (9 chiffres attendus)',
        agence:       'Numéro invalide (9 chiffres attendus)',
      };
      return hints[mode] ?? 'Numéro invalide.';
    }
    return '';
  }

  pct(p: any)      { return Math.min(100, (p.utilise / p.max) * 100); }
  barColor(p: any) { return this.pct(p) > 80 ? '#ff5252' : '#e8b84b'; }

  // ── OTP helpers ──────────────────────────────────────────────────
  otpInput(e: Event, idx: number) {
    const el = e.target as HTMLInputElement;
    const v  = el.value.replace(/\D/, '').slice(-1);
    this.otpCodes[idx] = v; el.value = v;
    if (v && idx < 5)
      (document.getElementById(`rotp${idx + 1}`) as HTMLInputElement)?.focus();
  }
  otpKey(e: KeyboardEvent, idx: number) {
    if (e.key === 'Backspace' && !this.otpCodes[idx] && idx > 0) {
      this.otpCodes[idx - 1] = '';
      (document.getElementById(`rotp${idx - 1}`) as HTMLInputElement)?.focus();
    }
  }

  // ── Étape 1 : vérifier PIN puis envoyer OTP ──────────────────────
  onSubmit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    const m = Number(this.form.value.montant);
    if (m > this.compte.soldeDisponible()) {
      this.erreur.set('Solde insuffisant.');
      return;
    }

    this.loading.set(true);
    this.erreur.set('');

    this.txService.verifierPin(this.form.value.pin!).subscribe({
      next: () => this.demanderOTP(),
      error: (err) => {
        this.loading.set(false);
        this.erreur.set(err.error?.message || 'Code PIN incorrect.');
      }
    });
  }

  private demanderOTP() {
    this.txService.sendOTPRetrait().subscribe({
      next: (res) => {
        this.loading.set(false);
        this.emailMasque.set(res.email_masque);
        this.etape.set('otp');
        this.toast.success(`Code OTP envoyé à ${res.email_masque}`);
      },
      error: () => {
        this.loading.set(false);
        this.erreur.set("Impossible d'envoyer le code OTP. Réessayez.");
      }
    });
  }

  // ── Étape 2 : confirmer avec l'OTP ──────────────────────────────
  confirmerRetrait() {
    const otp = this.otpCodes.join('');
    if (otp.length !== 6) { this.toast.warn('Saisissez le code OTP complet'); return; }

    this.loading.set(true);
    this.erreur.set('');

    this.txService.retrait({
      montant:   Number(this.form.value.montant),
      mode:      this.form.value.mode!,
      compte_dest: this.form.value.telephone!,
      pin:       this.form.value.pin!,
      otp,
    }).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.compte.majSolde(res.nouveau_solde);
        this.toast.success(
          `Retrait de ${Number(this.form.value.montant).toLocaleString('fr-FR')} FCFA confirmé`
        );
        this.reinitialiser();
      },
      error: (err) => {
        this.loading.set(false);
        this.erreur.set(err.error?.message || 'Erreur lors du retrait.');
      }
    });
  }

  retourFormulaire() {
    this.etape.set('formulaire');
    this.otpCodes = ['', '', '', '', '', ''];
    this.erreur.set('');
  }

  private reinitialiser() {
    this.form.reset({ mode: 'orange_money' });
    this.otpCodes = ['', '', '', '', '', ''];
    this.etape.set('formulaire');
    this.emailMasque.set('');
  }
}