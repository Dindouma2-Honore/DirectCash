import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';

function mdpMatch(ctrl: AbstractControl): ValidationErrors | null {
  const p = ctrl.get('mot_de_passe')?.value;
  const c = ctrl.get('confirmation')?.value;
  return p && c && p !== c ? { mismatch: true } : null;
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent {
  form: FormGroup;
  loading = signal(false);
  erreur  = signal('');

  constructor(private fb: FormBuilder, private auth: AuthService) {
    this.form = this.fb.group({
      nom:          ['', Validators.required],
      prenom:       ['', Validators.required],
      email:        ['', [Validators.required, Validators.email]],
      telephone:    ['', [Validators.required, Validators.pattern(/^\+237[0-9]{9}$/)]],
      mot_de_passe: ['', [Validators.required, Validators.minLength(8)]],
      confirmation: ['', Validators.required],
      type_compte:  ['client']
    }, { validators: mdpMatch });
  }

  isInvalid(f: string) {
    const c = this.form.get(f) as AbstractControl;
    return c.invalid && (c.dirty || c.touched);
  }

  pwdStrength(): number {
    const p = this.form.get('mot_de_passe')?.value ?? '';
    let s = 0;
    if (p.length >= 8)  s += 25;
    if (p.length >= 12) s += 15;
    if (/[A-Z]/.test(p)) s += 20;
    if (/[0-9]/.test(p)) s += 20;
    if (/[^A-Za-z0-9]/.test(p)) s += 20;
    return Math.min(100, s);
  }

  pwdLabel(): string {
    const s = this.pwdStrength();
    return s < 40 ? '🔴 Faible' : s < 75 ? '🟡 Moyen' : '🟢 Fort';
  }

  onSubmit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.loading.set(true); this.erreur.set('');
    const { confirmation, ...payload } = this.form.value as any;
    this.auth.inscrire(payload).subscribe({
      next: () => this.loading.set(false),
      error: err => { this.loading.set(false); this.erreur.set(err.error?.message || "Erreur lors de l'inscription."); }
    });
  }
}
