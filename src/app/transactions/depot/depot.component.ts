import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TransactionService } from '../../shared/services/transaction.service';
import { CompteService } from '../../shared/services/compte.service';
import { ToastService } from '../../shared/services/toast.service';

@Component({
  selector: 'app-depot',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './depot.component.html',
  styleUrls: ['./depot.component.css']
})
export class DepotComponent implements OnInit {
  form: FormGroup;
  loading        = signal(false);
  erreur         = signal('');
  succes         = signal('');
  montantPreview = signal(0);

  methodes = [
    { icone: '🟠', nom: 'Orange Money', delai: 'Instant',  frais: 'Gratuit' },
    { icone: '🟡', nom: 'MTN MoMo',    delai: 'Instant',  frais: 'Gratuit' },
    { icone: '🏦', nom: 'Virement',     delai: '24-48h',   frais: 'Gratuit' },
    { icone: '🏢', nom: 'Agence',       delai: '1h',       frais: 'Gratuit' },
  ];

  constructor(
    private fb: FormBuilder,
    private txService: TransactionService,
    public  compte: CompteService,
    private toast: ToastService
  ) {
    this.form = this.fb.group({
      montant:           [null as number | null, [Validators.required, Validators.min(500)]],
      source:            ['orange_money', Validators.required],
      reference_externe: ['']
    });
  }

  ngOnInit() { this.compte.charger().subscribe(); }

  updatePreview() { this.montantPreview.set(Number(this.form.get('montant')?.value) || 0); }

  isInvalid(f: string) { const c = this.form.get(f)!; return c.invalid && (c.dirty || c.touched); }

  onSubmit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.loading.set(true); this.erreur.set(''); this.succes.set('');
    this.txService.depot({
      montant: Number(this.form.value.montant),
      source:  this.form.value.source!,
      reference_externe: this.form.value.reference_externe || undefined
    }).subscribe({
      next: res => {
        this.loading.set(false);
        this.compte.majSolde(res.nouveau_solde);
        this.succes.set(`Dépôt de ${Number(this.form.value.montant).toLocaleString('fr-FR')} FCFA confirmé — ${res.transaction.code}`);
        this.form.reset({ source: 'orange_money' });
        this.montantPreview.set(0);
        this.toast.success('Dépôt effectué avec succès !');
      },
      error: err => { this.loading.set(false); this.erreur.set(err.error?.message || 'Erreur lors du dépôt.'); }
    });
  }
}
