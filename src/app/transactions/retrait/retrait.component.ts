import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TransactionService } from '../../shared/services/transaction.service';
import { CompteService } from '../../shared/services/compte.service';
import { AuthService } from '../../shared/services/auth.service';
import { ToastService } from '../../shared/services/toast.service';

@Component({
  selector: 'app-retrait',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './retrait.component.html',
  styleUrls: ['./retrait.component.css']
})
export class RetraitComponent implements OnInit {
  form: FormGroup;
  otpCodes = ['','','','','',''];
  showOtp  = signal(false);
  loading  = signal(false);
  erreur   = signal('');

  plafonds = [
    { label: 'Journalier',     utilise: 50000,  max: 500000  },
    { label: 'Mensuel',        utilise: 95000,  max: 3000000 },
    { label: 'Par opération',  utilise: 0,      max: 1000000 },
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
      pin:     ['', [Validators.required, Validators.minLength(4)]]
    });
  }

  ngOnInit() { this.compte.charger().subscribe(); }

  isInvalid(f: string) { const c = this.form.get(f)!; return c.invalid && (c.dirty || c.touched); }
  pct(p: any) { return Math.min(100, (p.utilise / p.max) * 100); }
  barColor(p: any) { return this.pct(p) > 80 ? '#ff5252' : '#e8b84b'; }

  otpInput(e: Event, idx: number) {
    const el = e.target as HTMLInputElement;
    const v  = el.value.replace(/\D/,'').slice(-1);
    this.otpCodes[idx] = v; el.value = v;
    if (v && idx < 5) (document.getElementById(`rotp${idx+1}`) as HTMLInputElement)?.focus();
  }
  otpKey(e: KeyboardEvent, idx: number) {
    if (e.key === 'Backspace' && !this.otpCodes[idx] && idx > 0) {
      this.otpCodes[idx-1] = '';
      (document.getElementById(`rotp${idx-1}`) as HTMLInputElement)?.focus();
    }
  }

  onSubmit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const m = Number(this.form.value.montant);
    if (m > this.compte.soldeDisponible()) { this.erreur.set('Solde insuffisant.'); return; }
    if (!this.showOtp()) { this.showOtp.set(true); return; }
    const otp = this.otpCodes.join('');
    if (otp.length !== 6) { this.toast.warn('Saisissez le code OTP'); return; }
    this.loading.set(true); this.erreur.set('');
    this.txService.retrait({
      montant: m, mode: this.form.value.mode!, pin: this.form.value.pin!, otp
    }).subscribe({
      next: res => {
        this.loading.set(false);
        this.compte.majSolde(res.nouveau_solde);
        this.toast.success(`Retrait de ${m.toLocaleString('fr-FR')} FCFA confirmé`);
        this.form.reset({ mode: 'orange_money' });
        this.otpCodes = ['','','','','','']; this.showOtp.set(false);
      },
      error: err => { this.loading.set(false); this.erreur.set(err.error?.message || 'Erreur lors du retrait.'); this.showOtp.set(false); }
    });
  }
}
