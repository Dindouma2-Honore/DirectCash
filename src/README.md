# DirectCash — Frontend Angular 17+

## Installation rapide

```bash
npm install
npm start
# → http://localhost:4200
```

`npm start` lance le serveur avec le **proxy CORS** intégré :
les requêtes `/api/*` sont redirigées vers `http://localhost/directcash/backend/*`
sans aucun problème CORS.

---

## Structure des dossiers XAMPP (obligatoire)

```
C:\xampp\htdocs\
└── directcash\
    └── backend\          ← coller le contenu du dossier backend/ ici
        ├── config.php
        ├── auth.php
        ├── otp.php
        ├── compte.php
        ├── transaction.php
        ├── log.php
        ├── notification.php
        ├── database.sql
        └── .htaccess
```

> L'erreur `http://localhost/directcash/auth.php` (sans `/backend/`) signifie
> que les fichiers PHP sont au mauvais endroit — ils doivent être dans
> `htdocs/directcash/backend/`, pas dans `htdocs/directcash/`.

---

## Démarrage avec XAMPP

1. Lancer **Apache** + **MySQL** dans XAMPP Control Panel
2. Ouvrir **phpMyAdmin** → importer `backend/database.sql`
3. Dans le terminal du projet Angular :
   ```bash
   npm start
   ```

---

## Identifiants de connexion

| Compte | Mot de passe | Rôle | OTP |
|---|---|---|---|
| `DC-237-0001` | `DirectCash2024!` | Admin | voir logs |
| `DC-237-0099` | `DirectCash2024!` | Client | voir logs |
| `DC-237-0175` | `DirectCash2024!` | Gestionnaire | voir logs |

Le code OTP est écrit dans `backend/logs/security.log` après chaque tentative.

### Mode démo (sans XAMPP)

Si XAMPP n'est pas lancé, le frontend bascule automatiquement en **mode démo local**.
Un bandeau orange apparaît. Le code OTP fixe est `482917`.

---

## Résolution des erreurs courantes

| Erreur | Cause | Solution |
|---|---|---|
| `CORS policy blocked` | PHP pas au bon endroit OU `mod_headers` Apache désactivé | Vérifier la structure des dossiers ci-dessus |
| `Identifiants incorrects` | Backend inaccessible | XAMPP non lancé → mode démo avec `482917` |
| `No 'Access-Control-Allow-Origin'` | `.htaccess` ignoré | Activer `mod_rewrite` et `mod_headers` dans Apache |

### Activer mod_headers dans XAMPP

Ouvrir `C:\xampp\apache\conf\httpd.conf` et décommenter :
```
LoadModule headers_module modules/mod_headers.so
```
Puis redémarrer Apache.
