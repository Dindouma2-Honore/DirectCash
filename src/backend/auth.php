<?php
// ================================================================
// directcash/backend/auth.php
// Inscription · Connexion · Bcrypt · Rate limiting · OTP
// ================================================================
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/helpers.php';  // creerOTP + envoyerEmailOTP

$action = $_GET['action'] ?? 'login';
$method = $_SERVER['REQUEST_METHOD'];

match (true) {
    $action === 'login' && $method === 'POST' => login(),
    $action === 'register' && $method === 'POST' => inscrire(),
    $action === 'logout' && $method === 'POST' => logout(),
    $action === 'refresh' && $method === 'POST' => refreshToken(),
    $action === 'liste_users' && $method === 'GET' => listeUtilisateurs(),
    $action === 'deverrouiller' && $method === 'PUT' => deverrouiller(),
    $action === 'profil' && $method === 'GET' => getProfil(),
    $action === 'profil' && $method === 'PUT' => majProfil(),
    $action === 'sessions' && $method === 'GET' => getSessions(),
    $action === 'revoquer_session' && $method === 'DELETE' => revoquerSession(),
    $action === 'changer_mdp' && $method === 'PUT' => changerMotDePasse(),
    $action === 'upload_photo' && $method === 'POST' => uploadPhoto(),
    $action === 'verrouiller' && $method === 'PUT' => verrouillerCompte(),
    $action === 'suspendre' && $method === 'PUT' => suspendreCompte(),
    default => jsonError('Action inconnue.', 404),
};

// ── CONNEXION ────────────────────────────────────────────────────
function login(): void
{
    $data = readJSON();
    $compte = trim($data['compte'] ?? '');
    $mdp = trim($data['mot_de_passe'] ?? '');

    // Rate limiting par IP et par compte
    rateLimit('login_ip_' . getIP(), 5, 600);
    rateLimit('login_compte_' . md5($compte), MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION);

    $pdo = getPDO();

    // Vérifier verrouillage actif
    $stmt = $pdo->prepare(
        'SELECT verouille_jusqu_a FROM tentatives_auth
         WHERE compte = ? AND verouille_jusqu_a > NOW()
         ORDER BY verouille_jusqu_a DESC LIMIT 1'
    );
    $stmt->execute([$compte]);
    if ($verrou = $stmt->fetch()) {
        $restant = strtotime($verrou['verouille_jusqu_a']) - time();
        logSec('FAIL', "Connexion bloquée : {$compte}");
        jsonError('Compte verrouillé. Réessayez dans ' . ceil($restant / 60) . ' min.', 403);
        return;
    }

    // Récupérer l'utilisateur
    $stmt = $pdo->prepare(
        'SELECT id, compte, nom, prenom, email, telephone, role, statut, mdp_hash, twofa_active
         FROM utilisateurs WHERE compte = :c AND statut != :s LIMIT 1'
    );
    $stmt->execute([':c' => $compte, ':s' => 'suspendu']);
    $user = $stmt->fetch();

    // Vérification hash bcrypt (timing-safe)
    if (!$user || !password_verify($mdp, $user['mdp_hash'])) {
        enregistrerEchec($compte);
        logSec('FAIL', "Auth échouée : {$compte}");
        jsonError('Identifiants incorrects.', 401);
        return;
    }

    if ($user['statut'] === 'verrouille') {
        jsonError('Compte verrouillé. Contactez le support.', 403);
        return;
    }

    // Rehash si le coût bcrypt a changé
    if (password_needs_rehash($user['mdp_hash'], PASSWORD_BCRYPT, ['cost' => BCRYPT_COST])) {
        $pdo
            ->prepare('UPDATE utilisateurs SET mdp_hash=? WHERE id=?')
            ->execute([password_hash($mdp, PASSWORD_BCRYPT, ['cost' => BCRYPT_COST]), $user['id']]);
    }

    // Réinitialiser les échecs de connexion
    $pdo->prepare('DELETE FROM tentatives_auth WHERE compte=?')->execute([$compte]);

    $jwt = genererToken($user);
    $token_hash = hash('sha256', $jwt);
    $appareil = detecterAppareil();
    $localisation = detecterLocalisation();
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';

    $pdo->prepare('
        INSERT INTO sessions (user_id, token_hash, appareil, localisation, ip, created_at, derniere_activite)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())
    ')->execute([$user['id'], $token_hash, $appareil, $localisation, $ip]);  // ✅ $user['id'] au lieu de $userId

    // Stocker session temporaire en attente OTP
    $tempToken = bin2hex(random_bytes(32));
    $pdo->prepare(
        'REPLACE INTO sessions_temp (token, user_id, created_at)
         VALUES (?, ?, NOW())'
    )->execute([$tempToken, $user['id']]);

    // ✅ Générer l'OTP et l'envoyer par email
    $code = creerOTP($user['id']);
    envoyerEmailOTP($user['email'], $user['compte'], $code);

    logSec('AUTH', "Identifiants OK — OTP requis : {$compte}");
    jsonReponse([
        'otp_required' => true,
        'temp_token' => $tempToken,
        'token' => $jwt,  // ✅ JWT retourné pour que Angular puisse l'utiliser
        'message' => 'OTP envoyé par email.',
    ]);
}

// ============Localisation==============================
function detecterAppareil(): string
{
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? 'Inconnu';

    $icone = '💻';
    $appareil = 'Navigateur Web';

    // Détecter mobile/tablette
    if (preg_match('/Android/i', $ua)) {
        $icone = '📱';
        $appareil = 'Android';
        if (preg_match('/tablet|Tab/i', $ua)) {
            $icone = '📟';
            $appareil = 'Tablette Android';
        }
    } elseif (preg_match('/iPhone/i', $ua)) {
        $icone = '📱';
        $appareil = 'iPhone';
    } elseif (preg_match('/iPad/i', $ua)) {
        $icone = '📟';
        $appareil = 'iPad';
    }

    // Détecter OS desktop
    if (preg_match('/Windows NT 10/i', $ua))
        $os = 'Windows 10/11';
    elseif (preg_match('/Windows NT 6/i', $ua))
        $os = 'Windows 7/8';
    elseif (preg_match('/Macintosh/i', $ua))
        $os = 'macOS';
    elseif (preg_match('/Linux/i', $ua))
        $os = 'Linux';
    elseif (preg_match('/Android/i', $ua))
        $os = 'Android';
    else
        $os = 'OS inconnu';

    // Détecter navigateur
    if (preg_match('/Chrome\/(\d+)/i', $ua, $m))
        $nav = "Chrome {$m[1]}";
    elseif (preg_match('/Firefox\/(\d+)/i', $ua, $m))
        $nav = "Firefox {$m[1]}";
    elseif (preg_match('/Safari\/(\d+)/i', $ua, $m))
        $nav = 'Safari';
    elseif (preg_match('/Edge\/(\d+)/i', $ua, $m))
        $nav = "Edge {$m[1]}";
    else
        $nav = 'Navigateur inconnu';

    return "{$icone} {$nav} — {$os}";
    // Exemple : "💻 Chrome 124 — Windows 10/11"
}

function detecterLocalisation(): string
{
    $ip = $_SERVER['HTTP_X_FORWARDED_FOR']
        ?? $_SERVER['REMOTE_ADDR']
        ?? '0.0.0.0';

    // En local XAMPP → toujours 127.0.0.1
    if ($ip === '127.0.0.1' || $ip === '::1')
        return 'Local';

    // API gratuite de géolocalisation IP
    $data = @file_get_contents("http://ip-api.com/json/{$ip}?fields=city,country&lang=fr");
    if ($data) {
        $geo = json_decode($data, true);
        return ($geo['city'] ?? '') . ', ' . ($geo['country'] ?? '');
    }
    return 'Localisation inconnue';
}

// ── INSCRIPTION ──────────────────────────────────────────────────
function inscrire(): void
{
    $d = readJSON();
    foreach (['nom', 'prenom', 'email', 'telephone', 'mdp_hash', 'pin_hash'] as $c) {
        if (empty(trim($d[$c] ?? ''))) {
            jsonError("Champ manquant : {$c}.", 422);
            return;
        }
    }

    $nom = strtoupper(trim($d['nom']));
    $prenom = ucfirst(strtolower(trim($d['prenom'])));
    $email = strtolower(filter_var(trim($d['email']), FILTER_SANITIZE_EMAIL));
    $tel = preg_replace('/\s+/', '', $d['telephone']);
    $mdp = $d['mdp_hash'];
    $pin = $d['pin_hash'];

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        jsonError('Email invalide.', 422);
        return;
    }
    if (!preg_match('/^\+237[0-9]{9}$/', $tel)) {
        jsonError('Téléphone invalide.', 422);
        return;
    }
    if (strlen($mdp) < 8) {
        jsonError('Mot de passe trop court (8 caractères min).', 422);
        return;
    }

    $pdo = getPDO();
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM utilisateurs WHERE email=? OR telephone=?');
    $stmt->execute([$email, $tel]);
    if ((int) $stmt->fetchColumn() > 0) {
        jsonError('Email ou téléphone déjà utilisé.', 409);
        return;
    }

    $hash = password_hash($mdp, PASSWORD_BCRYPT, ['cost' => BCRYPT_COST]);
    $pinHash = hash('sha256', $pin);
    $compte = genNumeroCompte();

    $stmt = $pdo->prepare(
        'INSERT INTO utilisateurs (compte, nom, prenom, email, telephone, mdp_hash, pin_hash, role, statut, twofa_active, created_at)
         VALUES (:compte, :nom, :prenom, :email, :tel, :hash, :pin_hash, "client", "actif", 1, NOW())'
    );
    $stmt->execute([
        ':compte' => $compte,
        ':nom' => $nom,
        ':prenom' => $prenom,
        ':email' => $email,
        ':tel' => $tel,
        ':hash' => $hash,
        ':pin_hash' => $pinHash,
    ]);
    $uid = (int) $pdo->lastInsertId();

    // Créer le compte bancaire associé
    $pdo->prepare(
        'INSERT INTO comptes (user_id, numero, solde, plafond_journalier, plafond_mensuel, created_at)
         VALUES (?, ?, 0, 500000, 3000000, NOW())'
    )->execute([$uid, $compte]);

    // ✅ Générer et envoyer l'OTP d'activation
    $code = creerOTP($uid);
    envoyerEmailOTP($email, $compte, $code);

    logSec('AUTH', "Inscription : {$compte}");
    jsonReponse([
        'message' => 'Compte créé. OTP envoyé par email.',
        'compte' => $compte,
        'otp_required' => true,
    ], 201);
}

// ── REFRESH TOKEN ────────────────────────────────────────────────
function refreshToken(): void
{
    $p = authentifier();
    $pdo = getPDO();
    $stmt = $pdo->prepare('SELECT * FROM utilisateurs WHERE id=? AND statut="actif"');
    $stmt->execute([$p['sub']]);
    $u = $stmt->fetch();
    if (!$u) {
        jsonError('Utilisateur introuvable.', 401);
        return;
    }
    jsonReponse(['token' => genererToken($u), 'user' => sanitize($u)]);
}

// ── LOGOUT ───────────────────────────────────────────────────────
function logout(): void
{
    $p = authentifier();
    logSec('AUTH', "Déconnexion : {$p['compte']}");
    jsonReponse(['message' => 'Déconnecté avec succès.']);
}

// ── LISTE UTILISATEURS (admin/gestionnaire) ──────────────────────
function listeUtilisateurs(): void
{
    requireRole('admin', 'gestionnaire');
    $rows = getPDO()->query(
        'SELECT u.id, u.compte, u.nom, u.prenom, u.email, u.telephone,
                u.role, u.statut, u.twofa_active, u.created_at, u.last_login,
                COALESCE(c.solde, 0) AS solde
         FROM utilisateurs u
         LEFT JOIN comptes c ON c.user_id = u.id
         ORDER BY u.created_at DESC'
    )->fetchAll();
    jsonReponse($rows);
}

// ── DÉVERROUILLER COMPTE (admin) ─────────────────────────────────
function deverrouiller(): void
{
    requireRole('admin', 'gestionnaire');
    $compte = cleanXSS($_GET['compte'] ?? '');
    if (!$compte) {
        jsonError('Compte requis.', 422);
        return;
    }

    $pdo = getPDO();
    $pdo->prepare('UPDATE utilisateurs SET statut="actif" WHERE compte=?')->execute([$compte]);
    $pdo->prepare('DELETE FROM tentatives_auth WHERE compte=?')->execute([$compte]);

    logSec('AUTH', "Déverrouillage admin : {$compte}");
    jsonReponse(['message' => "Compte {$compte} déverrouillé avec succès."]);
}
// Verouiller les utilisateurs
function verrouillerCompte(): void
{
    requireRole('admin', 'gestionnaire');
    $compte = cleanXSS($_GET['compte'] ?? '');
    if (!$compte) { jsonError('Compte requis.', 422); return; }

    getPDO()->prepare('UPDATE utilisateurs SET statut = "verrouille" WHERE compte = ?')
            ->execute([$compte]);

    logSec('AUTH', "Verrouillage admin : {$compte}");
    jsonReponse(['message' => "Compte {$compte} verrouillé."]);
}
// Suspendre les utilisateurs
function suspendreCompte(): void
{
    requireRole('admin', 'gestionnaire');
    $compte = cleanXSS($_GET['compte'] ?? '');
    if (!$compte) { jsonError('Compte requis.', 422); return; }

    getPDO()->prepare('UPDATE utilisateurs SET statut = "suspendu" WHERE compte = ?')
            ->execute([$compte]);

    logSec('AUTH', "Suspension admin : {$compte}");
    jsonReponse(['message' => "Compte {$compte} suspendu."]);
}
// ── PROFIL ───────────────────────────────────────────────────────
function getProfil(): void
{
    $p = authentifier();
    $stmt = getPDO()->prepare(
        'SELECT u.*, COALESCE(c.solde, 0) AS solde
         FROM utilisateurs u
         LEFT JOIN comptes c ON c.user_id = u.id
         WHERE u.id = ?'
    );
    $stmt->execute([$p['sub']]);
    $u = $stmt->fetch();
    if (!$u) {
        jsonError('Utilisateur introuvable.', 404);
        return;
    }
    jsonReponse(sanitize($u));
}

function majProfil(): void
{
    $p = authentifier();
    $d = readJSON();
    $sets = [];
    $vals = [];

    if (!empty($d['nom'])) {
        $sets[] = 'nom=?';
        $vals[] = strtoupper(cleanXSS($d['nom']));
    }
    if (!empty($d['prenom'])) {
        $sets[] = 'prenom=?';
        $vals[] = ucfirst(strtolower(cleanXSS($d['prenom'])));
    }
    if (!empty($d['email'])) {
        $e = strtolower(filter_var($d['email'], FILTER_SANITIZE_EMAIL));
        if (!filter_var($e, FILTER_VALIDATE_EMAIL)) {
            jsonError('Email invalide.', 422);
            return;
        }
        $sets[] = 'email=?';
        $vals[] = $e;
    }

    if (!$sets) {
        jsonError('Aucun champ à mettre à jour.', 422);
        return;
    }

    $vals[] = $p['sub'];
    getPDO()
        ->prepare('UPDATE utilisateurs SET ' . implode(',', $sets) . ' WHERE id=?')
        ->execute($vals);

    logSec('AUTH', "Profil mis à jour : {$p['compte']}");
    jsonReponse(['message' => 'Profil mis à jour avec succès.']);
}

// ── ENREGISTRER ÉCHEC AUTH ───────────────────────────────────────
function enregistrerEchec(string $compte): void
{
    $pdo = getPDO();
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM tentatives_auth
         WHERE compte=? AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)'
    );
    $stmt->execute([$compte]);
    $nb = (int) $stmt->fetchColumn();

    $pdo
        ->prepare('INSERT INTO tentatives_auth (compte, ip, created_at) VALUES (?, ?, NOW())')
        ->execute([$compte, getIP()]);

    if ($nb + 1 >= MAX_LOGIN_ATTEMPTS) {
        $pdo->prepare(
            'INSERT INTO tentatives_auth (compte, ip, verouille_jusqu_a, created_at)
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ' . LOCKOUT_DURATION . ' SECOND), NOW())'
        )->execute([$compte, getIP()]);

        $pdo
            ->prepare('UPDATE utilisateurs SET statut="verrouille" WHERE compte=?')
            ->execute([$compte]);

        logSec('BLOCK', "Compte verrouillé : {$compte} ({$nb} échecs)");
    }
}

// ── UTILITAIRE ───────────────────────────────────────────────────
function sanitize(array $u): array
{
    unset($u['mdp_hash']);
    return $u;
}

// ── SESSIONS ACTIVES ─────────────────────────────────────────────
function getSessions(): void
{
    $payload = authentifier();
    $pdo = getPDO();
    $tokenActuel = hash('sha256', getBearerToken());

    $stmt = $pdo->prepare("
        SELECT 
            id,
            appareil,
            localisation,
            ip,
            DATE_FORMAT(derniere_activite, '%d/%m/%Y %H:%i') AS date,
            (token_hash = ?) AS actuel
        FROM sessions
        WHERE user_id = ?
        ORDER BY derniere_activite DESC
        LIMIT 10
    ");
    $stmt->execute([$tokenActuel, $payload['sub']]);
    jsonReponse($stmt->fetchAll());
}

// ── RÉVOQUER UNE SESSION ─────────────────────────────────────────
function revoquerSession(): void
{
    $payload = authentifier();
    $pdo = getPDO();
    $id = (int) ($_GET['id'] ?? 0);

    if (!$id) {
        jsonError('ID requis.', 422);
        return;
    }

    // Vérifie que la session appartient à cet utilisateur
    $stmt = $pdo->prepare('SELECT id, token_hash FROM sessions WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $payload['sub']]);
    $session = $stmt->fetch();

    if (!$session) {
        jsonError('Session introuvable.', 404);
        return;
    }

    // Empêcher de révoquer sa propre session active
    $tokenActuel = hash('sha256', getBearerToken());
    if ($session['token_hash'] === $tokenActuel) {
        jsonError('Impossible de révoquer votre session active.', 403);
        return;
    }

    $pdo->prepare('DELETE FROM sessions WHERE id = ?')->execute([$id]);
    logSec('AUTH', "Session révoquée id={$id} par uid={$payload['sub']}");
    jsonReponse(['message' => 'Session révoquée avec succès.']);
}

// ================================================================

// ── CHANGER MOT DE PASSE ─────────────────────────────────────────
function changerMotDePasse(): void
{
    $payload = authentifier();
    $d = readJSON();

    $ancienMdp = trim($d['ancien_mdp'] ?? '');
    $nouveauMdp = trim($d['nouveau_mdp'] ?? '');

    // Validations
    if (strlen($ancienMdp) < 8 || strlen($nouveauMdp) < 8) {
        jsonError('Mot de passe invalide (8 caractères minimum).', 422);
        return;
    }

    $pdo = getPDO();
    $stmt = $pdo->prepare(
        'SELECT mdp_hash FROM utilisateurs WHERE id = ? AND statut = "actif"'
    );
    $stmt->execute([$payload['sub']]);
    $user = $stmt->fetch();

    if (!$user) {
        jsonError('Utilisateur introuvable.', 404);
        return;
    }

    // Vérifier l'ancien mot de passe avec bcrypt
    if (!password_verify($ancienMdp, $user['mdp_hash'])) {
        logSec('FAIL', "Mauvais ancien MDP uid={$payload['sub']}");
        jsonError('Mot de passe actuel incorrect.', 401);
        return;
    }

    // Empêcher la réutilisation du même mot de passe
    if (password_verify($nouveauMdp, $user['mdp_hash'])) {
        jsonError("Le nouveau mot de passe doit être différent de l'ancien.", 422);
        return;
    }

    // Vérifier la complexité minimale
    if (!preg_match('/[A-Z]/', $nouveauMdp) || !preg_match('/[0-9]/', $nouveauMdp)) {
        jsonError('Le mot de passe doit contenir au moins une majuscule et un chiffre.', 422);
        return;
    }

    // Hasher et enregistrer
    $newHash = password_hash($nouveauMdp, PASSWORD_BCRYPT, ['cost' => BCRYPT_COST]);

    $pdo
        ->prepare('UPDATE utilisateurs SET mdp_hash = ? WHERE id = ?')
        ->execute([$newHash, $payload['sub']]);

    logSec('AUTH', "MDP modifié uid={$payload['sub']}");
    jsonReponse(['message' => 'Mot de passe modifié avec succès.']);
}

// ── UPLOAD PHOTO DE PROFIL ────────────────────────────────────────
function uploadPhoto(): void
{
    $payload = authentifier();

    // Vérifier qu'un fichier a été envoyé
    if (empty($_FILES['photo']) || $_FILES['photo']['error'] !== UPLOAD_ERR_OK) {
        jsonError("Aucun fichier reçu ou erreur d'upload.", 422);
        return;
    }

    $fichier = $_FILES['photo'];

    // Validation taille (2 Mo max)
    if ($fichier['size'] > 2 * 1024 * 1024) {
        jsonError('Fichier trop lourd (2 Mo maximum).', 422);
        return;
    }

    // Validation type MIME réel (pas juste l'extension)
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mimeType = $finfo->file($fichier['tmp_name']);
    $allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    if (!in_array($mimeType, $allowed, true)) {
        jsonError('Format invalide. JPG, PNG, WEBP ou GIF uniquement.', 422);
        return;
    }

    // Extensions autorisées
    $extensions = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
    ];
    $ext = $extensions[$mimeType];

    // Dossier de destination
    $dossier = __DIR__ . '/uploads/photos/';
    if (!is_dir($dossier)) {
        mkdir($dossier, 0755, true);
    }

    // Supprimer l'ancienne photo si elle existe
    $pdo = getPDO();
    $stmt = $pdo->prepare('SELECT photo_url FROM utilisateurs WHERE id = ?');
    $stmt->execute([$payload['sub']]);
    $ancienne = $stmt->fetchColumn();
    if ($ancienne) {
        $cheminAncien = __DIR__ . '/' . ltrim($ancienne, '/');
        if (file_exists($cheminAncien)) {
            unlink($cheminAncien);
        }
    }

    // Nom de fichier unique et sécurisé
    $nomFichier = 'user_' . $payload['sub'] . '_' . bin2hex(random_bytes(8)) . '.' . $ext;
    $destination = $dossier . $nomFichier;

    if (!move_uploaded_file($fichier['tmp_name'], $destination)) {
        jsonError('Erreur lors de la sauvegarde du fichier.', 500);
        return;
    }

    // URL publique relative
    $photoUrl = 'http://localhost/directcash/backend/uploads/photos/' . $nomFichier;

    // Enregistrer en base
    $pdo
        ->prepare('UPDATE utilisateurs SET photo_url = ? WHERE id = ?')
        ->execute([$photoUrl, $payload['sub']]);

    logSec('AUTH', "Photo mise à jour uid={$payload['sub']}");
    jsonReponse([
        'message' => 'Photo mise à jour avec succès.',
        'photo_url' => $photoUrl,
    ]);
}

