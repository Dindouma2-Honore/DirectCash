import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TransactionService } from '../../shared/services/transaction.service';
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

  beneficiaires = [
    { nom: 'NKUISSI Marie', compte: 'DC-237-0099', initiales: 'NM', color: 'teal'   },
    { nom: 'TAGNE Paul',    compte: 'DC-237-0042', initiales: 'TP', color: 'blue'   },
    { nom: 'EKANE Sophie',  compte: 'DC-237-0175', initiales: 'ES', color: 'purple' },
  ];

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
  }

  isInvalid(f: string) { const c = this.form.get(f)!; return c.invalid && (c.dirty || c.touched); }

  updatePreview() {
    const m = Number(this.form.value.montant) || 0;
    const f = Math.round(m * 0.005);
    this.montant.set(m); this.frais.set(f); this.total.set(m + f);
  }

  setDest(b: any) { this.form.patchValue({ compte_dest: b.compte }); this.destInfo.set(b.nom); }

  verifierDest() {
    const c = this.form.value.compte_dest;
    const b = this.beneficiaires.find(x => x.compte === c);
    this.destInfo.set(b?.nom ?? '');
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
    if (!this.showOtp()) { this.showOtp.set(true); return; }
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
      error: err => { this.loading.set(false); this.erreur.set(err.error?.message || 'Erreur lors du transfert.'); this.showOtp.set(false); }
    });
  }
}
