import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TransactionService } from '../../shared/services/transaction.service';
import { CompteService } from '../../shared/services/compte.service';
import { AuthService } from '../../shared/services/auth.service';
import { ToastService } from '../../shared/services/toast.service';

type Etape = 'formulaire' | 'otp';

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
  etape        = signal<Etape>('formulaire');
  loading      = signal(false);
  erreur       = signal('');
  emailMasque  = signal('');

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
      montant: [null as number | null, [Validators.required, Validators.min(500)]],
      mode:    ['orange_money', Validators.required],
      pin:     ['', [Validators.required, Validators.minLength(4)]],
    });
  }

  ngOnInit() { this.compte.charger().subscribe(); }

  isInvalid(f: string) {
    const c = this.form.get(f)!;
    return c.invalid && (c.dirty || c.touched);
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

  // ── Étape 1 : soumettre le formulaire → vérifier PIN ────────────
  onSubmit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    const m = Number(this.form.value.montant);
    if (m > this.compte.soldeDisponible()) {
      this.erreur.set('Solde insuffisant.');
      return;
    }

    this.loading.set(true);
    this.erreur.set('');

    // 1. Vérifier PIN côté backend — BLOQUER si erreur
    this.txService.verifierPin(this.form.value.pin!).subscribe({
      next: () => {
        // PIN OK → demander l'OTP par email
        this.demanderOTP();
      },
      error: (err) => {
        this.loading.set(false);
        this.erreur.set(err.error?.message || 'Code PIN incorrect.');
        // On reste sur l'étape formulaire, on ne passe PAS à l'OTP
      }
    });
  }

  // ── Étape 1b : envoyer l'OTP par email ──────────────────────────
  private demanderOTP() {
    this.txService.sendOTPRetrait().subscribe({
      next: (res) => {
        this.loading.set(false);
        this.emailMasque.set(res.email_masque);
        this.etape.set('otp'); // ← on passe à l'étape OTP seulement ici
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
      montant: Number(this.form.value.montant),
      mode:    this.form.value.mode!,
      pin:     this.form.value.pin!,
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

  // ── Retour à l'étape formulaire ──────────────────────────────────
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