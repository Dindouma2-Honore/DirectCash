// src/app/profil/profil.component.ts
import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../shared/services/auth.service';
import { ToastService } from '../shared/services/toast.service';
import { environment } from '../../environments/environment';

type Onglet = 'apercu' | 'infos' | 'securite' | 'photo';

@Component({
  selector: 'app-profil',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './profil.component.html',
  styleUrls: ['./profil.component.css']
})
export class ProfilComponent implements OnInit {
  private readonly API = environment.apiUrl;

  ongletActif = signal<Onglet>('apercu');
  chargement = signal(false);
  photoPreview = signal<string | null>(null);
  photoFichier: File | null = null;
  showMdp  = signal(false);
  infoForm!: FormGroup;
  securiteForm!: FormGroup;

  readonly initiales = computed(() => {
    const u = this.auth.user();
    if (!u) return '??';
    return `${u.nom.charAt(0)}${u.prenom.charAt(0)}`.toUpperCase();
  });

  readonly nomComplet = computed(() => {
    const u = this.auth.user();
    return u ? `${u.prenom} ${u.nom}` : '';
  });

  readonly roleLabel = computed(() => {
    const r = this.auth.user()?.role;
    if (r === 'admin') return 'Administrateur';
    if (r === 'gestionnaire') return 'Gestionnaire';
    return 'Client';
  });

  readonly roleCouleur = computed(() => {
    const r = this.auth.user()?.role;
    if (r === 'admin') return 'badge-admin';
    if (r === 'gestionnaire') return 'badge-gestionnaire';
    return 'badge-client';
  });

  constructor(
    private fb: FormBuilder,
    public auth: AuthService,
    private http: HttpClient,
    private toast: ToastService
  ) { }

  ngOnInit() {
    const u = this.auth.user();

    this.infoForm = this.fb.group({
      nom: [u?.nom ?? '', [Validators.required, Validators.minLength(2)]],
      prenom: [u?.prenom ?? '', [Validators.required, Validators.minLength(2)]],
      email: [u?.email ?? '', [Validators.required, Validators.email]],
    });

    this.securiteForm = this.fb.group({
      ancien_mdp: ['', [Validators.required, Validators.minLength(8)]],
      nouveau_mdp: ['', [Validators.required, Validators.minLength(8)]],
      confirmation: ['', Validators.required],
    }, { validators: this.mdpIdentiques });
  }

  // ── Navigation onglets ──────────────────────────────────────────
  allerA(onglet: Onglet) {
    this.ongletActif.set(onglet);
  }

  // ── Modifier infos personnelles ─────────────────────────────────
  sauvegarderInfos() {
    if (this.infoForm.invalid) { this.infoForm.markAllAsTouched(); return; }

    this.chargement.set(true);
    this.http.put(`${this.API}/auth.php?action=profil`, this.infoForm.value)
      .subscribe({
        next: () => {
          // Mettre à jour le signal user localement
          const u = this.auth.user();
          if (u) {
            const updated = {
              ...u,
              nom: this.infoForm.value.nom.toUpperCase(),
              prenom: this.infoForm.value.prenom,
              email: this.infoForm.value.email,
            };
            localStorage.setItem('dc_user', JSON.stringify(updated));
          }
          this.toast.success('Informations mises à jour ✅');
          this.chargement.set(false);
        },
        error: (err) => {
          this.toast.error(err?.error?.message ?? 'Erreur lors de la mise à jour.');
          this.chargement.set(false);
        }
      });
  }

  // ── Modifier mot de passe ───────────────────────────────────────
  changerMotDePasse() {
    if (this.securiteForm.invalid) { this.securiteForm.markAllAsTouched(); return; }

    this.chargement.set(true);
    this.http.put(`${this.API}/auth.php?action=changer_mdp`, {
      ancien_mdp: this.securiteForm.value.ancien_mdp,
      nouveau_mdp: this.securiteForm.value.nouveau_mdp,
    }).subscribe({
      next: () => {
        this.toast.success('Mot de passe modifié avec succès ✅');
        this.securiteForm.reset();
        this.chargement.set(false);
      },
      error: (err) => {
        this.toast.error(err?.error?.message ?? 'Erreur lors du changement.');
        this.chargement.set(false);
      }
    });
  }

  // ── Photo de profil ─────────────────────────────────────────────
  onPhotoChoisie(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const fichier = input.files[0];
    if (fichier.size > 2 * 1024 * 1024) {
      this.toast.error('Photo trop lourde (max 2 Mo).'); return;
    }
    if (!fichier.type.startsWith('image/')) {
      this.toast.error('Format invalide (JPG, PNG, WEBP).'); return;
    }

    this.photoFichier = fichier;
    const reader = new FileReader();
    reader.onload = (e) => this.photoPreview.set(e.target?.result as string);
    reader.readAsDataURL(fichier);
  }

  uploaderPhoto() {
    if (!this.photoFichier) return;

    const formData = new FormData();
    formData.append('photo', this.photoFichier);

    this.chargement.set(true);
    this.http.post(`${this.API}/auth.php?action=upload_photo`, formData)
      .subscribe({
        next: (res: any) => {
          this.http.get<any>(`${this.API}/auth.php?action=profil`).subscribe(profil => {
            this.auth.setUser(profil); // ✅ met à jour le signal sans reload
            this.photoPreview.set(null);
          });
          this.toast.success('Photo mise à jour ✅');
          this.photoFichier = null;
          this.chargement.set(false);
        },
        error: () => {
          this.toast.error('Erreur lors de l\'upload.');
          this.chargement.set(false);
        }
      });
  }

  // ── Helpers ─────────────────────────────────────────────────────
  estInvalide(form: FormGroup, champ: string): boolean {
    const c = form.get(champ);
    return !!c && c.invalid && (c.dirty || c.touched);
  }

  private mdpIdentiques(group: AbstractControl) {
    const nv = group.get('nouveau_mdp')?.value;
    const co = group.get('confirmation')?.value;
    return nv === co ? null : { nonIdentiques: true };
  }

  formatDate(date?: string): string {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric'
    });
  }
}