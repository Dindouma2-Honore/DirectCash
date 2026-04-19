# DirectCash — Plateforme de Paiement Sécurisée

## Structure du projet

```
directcash/
├── frontend/  (Angular 17+)
│   └── src/app/
│       ├── auth/           login · register · otp
│       ├── dashboard/      solde · résumé
│       ├── transactions/   depot · envoi · retrait · historique
│       ├── securite/       logs · alertes · parametres-2fa
│       ├── admin/          users · supervision
│       └── shared/
│           ├── models/     user · transaction · log
│           ├── services/   auth · transaction · compte · log · toast
│           ├── guards/     authGuard · adminGuard · guestGuard
│           └── interceptors/ jwt · error
│
└── backend/  (PHP 8.2 / PDO / MySQL)
    ├── config.php        → PDO · CORS · JWT · sanitisation · rate limit
    ├── auth.php          → inscription · connexion bcrypt · verrouillage
    ├── otp.php           → génération OTP · vérification · renvoi
    ├── compte.php        → solde · plafonds · supervision
    ├── transaction.php   → dépôt · envoi · retrait · idempotence
    ├── log.php           → journaux sécurité · alertes
    ├── notification.php  → notifications utilisateur
    └── database.sql      → schéma MySQL complet + données démo
```

---

## Installation rapide

### Backend PHP (XAMPP)

```bash
# 1. Copier le dossier backend dans htdocs
cp -r directcash/backend /opt/lampp/htdocs/directcash/

# 2. Créer la base de données
mysql -u root -p < backend/database.sql

# 3. Configurer config.php
# Modifier DB_USER, DB_PASS si nécessaire
# Changer DC_JWT_SECRET en production !
```

### Frontend Angular

```bash
cd frontend
npm install
ng serve       # http://localhost:4200
```

### Connexion de démo
| Compte        | Mot de passe | PIN  | OTP    | Rôle  |
|---------------|-------------|------|--------|-------|
| DC-237-0001   | password123 | 1234 | 482917 | Admin |
| DC-237-0099   | password123 | 1234 | (SMS)  | Client|

---

## Sécurités implémentées

### 1. Protection SQL (config.php + tous les fichiers)
- **Requêtes préparées PDO** — `ATTR_EMULATE_PREPARES = false`
- **Automate regex** — 24 patterns détectés (UNION, DROP, SLEEP, etc.)
- **Aucune concaténation** de données utilisateur dans les requêtes

### 2. Protection XSS (config.php)
- `htmlspecialchars()` avec `ENT_QUOTES | ENT_HTML5`
- `strip_tags()` — seules `<b><i><u><br>` autorisées
- Détection et log des tentatives

### 3. Authentification (auth.php + otp.php)
- `password_hash($mdp, PASSWORD_BCRYPT, ['cost' => 12])`
- OTP 6 chiffres cryptographique (`random_int`)
- OTP **hashé en base** avant stockage
- Verrouillage après 3 échecs (15 min)
- Rate limiting par IP

### 4. Transactions (transaction.php)
- `PDO::beginTransaction()` + `FOR UPDATE` (verrou exclusif)
- Vérification solde **dans la transaction**
- Clé d'idempotence unique — anti-double paiement
- Vérification plafonds journalier / mensuel / par TX

### 5. API (config.php)
- JWT HS256 — signature HMAC-SHA256
- `hash_equals()` — comparaison sécurisée (anti timing-attack)
- Blacklist JWT — révocation à la déconnexion
- En-têtes : `X-Content-Type-Options`, `X-Frame-Options`, `HSTS`
- CORS restreint aux origines autorisées

---

## Variables d'environnement à changer en production

```php
// config.php
define('DC_ENV',        'production');   // désactive OTP debug
define('DC_JWT_SECRET', 'VOTRE_CLE_SECRETE_256_BITS');
define('DB_USER',       'directcash_user');
define('DB_PASS',       'MOT_DE_PASSE_FORT');
```

---

## API Endpoints

| Méthode | URL                              | Auth | Description               |
|---------|----------------------------------|------|---------------------------|
| POST    | /auth.php?action=register        | ✗    | Inscription               |
| POST    | /auth.php?action=login           | ✗    | Connexion étape 1          |
| POST    | /auth.php?action=logout          | ✓    | Déconnexion               |
| POST    | /otp.php?action=verify           | ✗    | Vérification OTP + JWT     |
| POST    | /otp.php?action=resend           | ✗    | Renvoi OTP                |
| GET     | /compte.php                      | ✓    | Solde + infos compte       |
| GET     | /compte.php?action=verifier&numero=X | ✓ | Vérifier destinataire  |
| POST    | /transaction.php?action=depot    | ✓    | Dépôt                     |
| POST    | /transaction.php?action=envoi    | ✓    | Envoi (OTP requis)         |
| POST    | /transaction.php?action=retrait  | ✓    | Retrait (PIN + OTP)        |
| GET     | /transaction.php                 | ✓    | Historique (filtrable)     |
| GET     | /transaction.php?action=export_csv | ✓  | Export CSV                |
| GET     | /log.php                         | ✓    | Journaux sécurité          |
| GET     | /log.php?action=alertes          | Admin| Alertes actives           |
| PUT     | /log.php?action=resoudre&id=X    | Admin| Résoudre alerte           |
| GET     | /notification.php                | ✓    | Notifications              |
| PUT     | /notification.php?id=X           | ✓    | Marquer lu                |
| GET     | /compte.php?action=supervision   | Admin| Stats globales            |
