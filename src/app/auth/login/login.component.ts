import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  form: FormGroup;
  loading  = signal(false);
  erreur   = signal('');
  showMdp  = signal(false);

  constructor(private fb: FormBuilder, public auth: AuthService) {
    this.form = this.fb.group({
      compte:       ['', [Validators.required, Validators.pattern(/^DC-\d{3}-\d{4}$/)]],
      mot_de_passe: ['', Validators.required]
    });
  }

  isInvalid(f: string) {
    const c = this.form.get(f) as AbstractControl;
    return c.invalid && (c.dirty || c.touched);
  }

  onSubmit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.loading.set(true); this.erreur.set('');
    const { compte, mot_de_passe } = this.form.value;
    this.auth.login(compte!, mot_de_passe!).subscribe({
      next: () => this.loading.set(false),
      error: err => {
        this.loading.set(false);
        this.erreur.set(this.auth.loginAttempts() <= 0
          ? '🔒 Compte verrouillé. Réessayez dans 15 minutes.'
          : err.error?.message || 'Identifiants incorrects.');
      }
    });
  }
}
