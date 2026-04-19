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

match(true) {
    $action === 'login'         && $method === 'POST' => login(),
    $action === 'register'      && $method === 'POST' => inscrire(),
    $action === 'logout'        && $method === 'POST' => logout(),
    $action === 'refresh'       && $method === 'POST' => refreshToken(),
    $action === 'liste_users'   && $method === 'GET'  => listeUtilisateurs(),
    $action === 'deverrouiller' && $method === 'PUT'  => deverrouiller(),
    $action === 'profil'        && $method === 'GET'  => getProfil(),
    $action === 'profil'        && $method === 'PUT'  => majProfil(),
    default => jsonError('Action inconnue.', 404),
};

// ── CONNEXION ────────────────────────────────────────────────────
function login(): void
{
    $data   = readJSON();
    $compte = trim($data['compte'] ?? '');
    $mdp    = trim($data['mot_de_passe'] ?? '');

    if (!$compte || !$mdp) {
        jsonError('Compte et mot de passe requis.', 422);
        return;
    }

    // Rate limiting par IP et par compte
    rateLimit('login_ip_'     . getIP(),         5, 600);
    rateLimit('login_compte_' . md5($compte),    MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION);

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
        $pdo->prepare('UPDATE utilisateurs SET mdp_hash=? WHERE id=?')
            ->execute([password_hash($mdp, PASSWORD_BCRYPT, ['cost' => BCRYPT_COST]), $user['id']]);
    }

    // Réinitialiser les échecs de connexion
    $pdo->prepare('DELETE FROM tentatives_auth WHERE compte=?')->execute([$compte]);

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
        'temp_token'   => $tempToken,
        'message'      => 'OTP envoyé par email.',
    ]);
}

// ── INSCRIPTION ──────────────────────────────────────────────────
function inscrire(): void
{
    $d = readJSON();
    foreach (['nom', 'prenom', 'email', 'telephone', 'mot_de_passe'] as $c) {
        if (empty(trim($d[$c] ?? ''))) {
            jsonError("Champ manquant : {$c}.", 422);
            return;
        }
    }

    $nom    = strtoupper(trim($d['nom']));
    $prenom = ucfirst(strtolower(trim($d['prenom'])));
    $email  = strtolower(filter_var(trim($d['email']), FILTER_SANITIZE_EMAIL));
    $tel    = preg_replace('/\s+/', '', $d['telephone']);
    $mdp    = $d['mot_de_passe'];

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { jsonError('Email invalide.', 422); return; }
    if (!preg_match('/^\+237[0-9]{9}$/', $tel))     { jsonError('Téléphone invalide.', 422); return; }
    if (strlen($mdp) < 8)                           { jsonError('Mot de passe trop court (8 caractères min).', 422); return; }

    $pdo  = getPDO();
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM utilisateurs WHERE email=? OR telephone=?');
    $stmt->execute([$email, $tel]);
    if ((int)$stmt->fetchColumn() > 0) {
        jsonError('Email ou téléphone déjà utilisé.', 409);
        return;
    }

    $hash   = password_hash($mdp, PASSWORD_BCRYPT, ['cost' => BCRYPT_COST]);
    $compte = genNumeroCompte();

    $stmt = $pdo->prepare(
        'INSERT INTO utilisateurs (compte, nom, prenom, email, telephone, mdp_hash, role, statut, twofa_active, created_at)
         VALUES (:compte, :nom, :prenom, :email, :tel, :hash, "client", "actif", 1, NOW())'
    );
    $stmt->execute([
        ':compte' => $compte, ':nom' => $nom, ':prenom' => $prenom,
        ':email'  => $email,  ':tel' => $tel, ':hash'   => $hash,
    ]);
    $uid = (int)$pdo->lastInsertId();

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
        'message'      => 'Compte créé. OTP envoyé par email.',
        'compte'       => $compte,
        'otp_required' => true,
    ], 201);
}

// ── REFRESH TOKEN ────────────────────────────────────────────────
function refreshToken(): void
{
    $p    = authentifier();
    $pdo  = getPDO();
    $stmt = $pdo->prepare('SELECT * FROM utilisateurs WHERE id=? AND statut="actif"');
    $stmt->execute([$p['sub']]);
    $u = $stmt->fetch();
    if (!$u) { jsonError('Utilisateur introuvable.', 401); return; }
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
    if (!$compte) { jsonError('Compte requis.', 422); return; }

    $pdo = getPDO();
    $pdo->prepare('UPDATE utilisateurs SET statut="actif" WHERE compte=?')->execute([$compte]);
    $pdo->prepare('DELETE FROM tentatives_auth WHERE compte=?')->execute([$compte]);

    logSec('AUTH', "Déverrouillage admin : {$compte}");
    jsonReponse(['message' => "Compte {$compte} déverrouillé avec succès."]);
}

// ── PROFIL ───────────────────────────────────────────────────────
function getProfil(): void
{
    $p    = authentifier();
    $stmt = getPDO()->prepare(
        'SELECT u.*, COALESCE(c.solde, 0) AS solde
         FROM utilisateurs u
         LEFT JOIN comptes c ON c.user_id = u.id
         WHERE u.id = ?'
    );
    $stmt->execute([$p['sub']]);
    $u = $stmt->fetch();
    if (!$u) { jsonError('Utilisateur introuvable.', 404); return; }
    jsonReponse(sanitize($u));
}

function majProfil(): void
{
    $p    = authentifier();
    $d    = readJSON();
    $sets = [];
    $vals = [];

    if (!empty($d['nom']))    { $sets[] = 'nom=?';    $vals[] = strtoupper(cleanXSS($d['nom'])); }
    if (!empty($d['prenom'])) { $sets[] = 'prenom=?'; $vals[] = ucfirst(strtolower(cleanXSS($d['prenom']))); }
    if (!empty($d['email']))  {
        $e = strtolower(filter_var($d['email'], FILTER_SANITIZE_EMAIL));
        if (!filter_var($e, FILTER_VALIDATE_EMAIL)) { jsonError('Email invalide.', 422); return; }
        $sets[] = 'email=?';
        $vals[] = $e;
    }

    if (!$sets) { jsonError('Aucun champ à mettre à jour.', 422); return; }

    $vals[] = $p['sub'];
    getPDO()->prepare('UPDATE utilisateurs SET ' . implode(',', $sets) . ' WHERE id=?')
            ->execute($vals);

    logSec('AUTH', "Profil mis à jour : {$p['compte']}");
    jsonReponse(['message' => 'Profil mis à jour avec succès.']);
}

// ── ENREGISTRER ÉCHEC AUTH ───────────────────────────────────────
function enregistrerEchec(string $compte): void
{
    $pdo  = getPDO();
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM tentatives_auth
         WHERE compte=? AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)'
    );
    $stmt->execute([$compte]);
    $nb = (int)$stmt->fetchColumn();

    $pdo->prepare('INSERT INTO tentatives_auth (compte, ip, created_at) VALUES (?, ?, NOW())')
        ->execute([$compte, getIP()]);

    if ($nb + 1 >= MAX_LOGIN_ATTEMPTS) {
        $pdo->prepare(
            'INSERT INTO tentatives_auth (compte, ip, verouille_jusqu_a, created_at)
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ' . LOCKOUT_DURATION . ' SECOND), NOW())'
        )->execute([$compte, getIP()]);

        $pdo->prepare('UPDATE utilisateurs SET statut="verrouille" WHERE compte=?')
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
