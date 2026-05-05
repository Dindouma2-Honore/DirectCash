import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ToastService } from '../../shared/services/toast.service';
import { User } from '../../shared/models/user.model';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.css']
})
export class UsersComponent implements OnInit {
  users        = signal<User[]>([]);
  showModal    = signal(false);
  loading      = signal(false);
  loadingModal = signal(false);
  // champs de filtre
  recherche    = '';
  filtreRole   = '';
  filtreStatut = '';
  addForm: FormGroup;

  usersFiltres = () => this.users().filter(u => {
    const s = this.recherche.toLowerCase();
    const ok = !s || [u.nom, u.prenom, u.compte, u.email].some(v => v.toLowerCase().includes(s));
    return ok && (!this.filtreRole || u.role === this.filtreRole) && (!this.filtreStatut || u.statut === this.filtreStatut);
  });

  constructor(private http: HttpClient, private fb: FormBuilder, private toast: ToastService) {
    this.addForm = this.fb.group({
      nom:       ['', Validators.required],
      prenom:    ['', Validators.required],
      email:     ['', [Validators.required, Validators.email]],
      telephone: ['', Validators.required],
      pin_hash:['',Validators.required],
      mdp_hash:['',Validators.required],
      role:      ['client']
    });
  }

  ngOnInit() { this.charger(); }

  charger() {
    this.loading.set(true);
    this.http.get<User[]>(`${environment.apiUrl}/auth.php?action=liste_users`).subscribe({
      next: l => { this.users.set(l); this.loading.set(false); },
      error: () => {
        this.loading.set(false);
        this.users.set([
          { id:1, compte:'DC-237-0001', nom:'KAMGA',   prenom:'Jean-Pierre', email:'jean.kamga@gmail.com',  telephone:'+237677123456', role:'admin',        statut:'actif',      solde:150000, twofa_active:true,  created_at:'2024-01-15', last_login:'Maintenant'  },
          { id:2, compte:'DC-237-0099', nom:'NKUISSI', prenom:'Marie',       email:'m.nkuissi@gmail.com',   telephone:'+237699456789', role:'client',       statut:'actif',      solde:75500,  twofa_active:true,  created_at:'2024-02-10', last_login:'il y a 2h'   },
          { id:3, compte:'DC-237-0042', nom:'TAGNE',   prenom:'Paul',        email:'paul.tagne@yahoo.fr',   telephone:'+237677789012', role:'client',       statut:'verrouille', solde:0,      twofa_active:false, created_at:'2024-03-05', last_login:'il y a 30min'},
          { id:4, compte:'DC-237-0175', nom:'EKANE',   prenom:'Sophie',      email:'s.ekane@directcash.cm', telephone:'+237690234567', role:'gestionnaire', statut:'actif',      solde:320000, twofa_active:true,  created_at:'2024-01-20', last_login:'il y a 1j'   },
        ]);
      }
    });
  }

  avatarColor(role: string) { return role === 'admin' ? 'gold' : role === 'gestionnaire' ? 'purple' : 'teal'; }

  roleClass(role: string): string {
    return role === 'admin' ? 'gold' : role === 'gestionnaire' ? 'purple' : 'info';
  }

  statutClass(statut: string): string {
    return statut === 'actif' ? 'success' : statut === 'verrouille' ? 'danger' : 'warn';
  }

  deverrouiller(u: User) {
    this.http.put(`${environment.apiUrl}/auth.php?action=deverrouiller&compte=${u.compte}`, {}).subscribe({
      next: () => { this.setStatut(u.id, 'actif'); this.toast.success(`${u.compte} déverrouillé ✅`); },
      error: () => { this.setStatut(u.id, 'actif'); this.toast.success(`${u.compte} déverrouillé (démo)`); }
    });
  }
 verrouiller(u: User) {
  this.http.put(`${environment.apiUrl}/auth.php?action=verrouiller&compte=${u.compte}`, {})
    .subscribe({
      next: () => { this.setStatut(u.id, 'verrouille'); this.toast.warn(`${u.compte} verrouillé`); },
      error: () => this.toast.error('Erreur lors du verrouillage.')
    });
}

suspendre(u: User) {
  this.http.put(`${environment.apiUrl}/auth.php?action=suspendre&compte=${u.compte}`, {})
    .subscribe({
      next: () => { this.setStatut(u.id, 'suspendu'); this.toast.warn(`${u.compte} suspendu`); },
      error: () => this.toast.error('Erreur lors de la suspension.')
    });
}

  private setStatut(id: number, statut: User['statut']) {
    this.users.update(l => l.map(x => x.id === id ? { ...x, statut } : x));
  }

  creerUser() {
    if (this.addForm.invalid) { this.addForm.markAllAsTouched(); return; }
    this.loadingModal.set(true);
    this.http.post(`${environment.apiUrl}/auth.php?action=register`, this.addForm.value).subscribe({
      next: () => { this.toast.success('Créé — OTP envoyé ✅'); this.showModal.set(false); this.loadingModal.set(false); this.addForm.reset({ role:'client' }); this.charger(); },
      error: () => { this.toast.success('Ajouté (démo)'); this.showModal.set(false); this.loadingModal.set(false); }
    });
  }

  isInvalid(f: string) { const c = this.addForm.get(f)!; return c.invalid && (c.dirty || c.touched); }
}
