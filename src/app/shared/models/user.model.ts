// src/app/shared/models/user.model.ts
export interface User {
  id: number;
  compte: string;
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  photo_url?:string;
  
  
  role: 'client' | 'gestionnaire' | 'admin';
  statut: 'actif' | 'suspendu' | 'verrouille';
  solde: number;
  twofa_active: boolean;
  created_at: string;
  last_login?: string;
}
