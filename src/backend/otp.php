<?php
// ================================================================
// directcash/backend/otp.php
// Vérification OTP · Renvoi · Génération
// ================================================================
declare(strict_types=1);
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/helpers.php';  // creerOTP + envoyerEmailOTP

// Routeur — uniquement si appelé directement (pas via include)
if (basename($_SERVER['SCRIPT_FILENAME']) === basename(__FILE__)) {
    $action = $_GET['action'] ?? 'verify';
    $method = $_SERVER['REQUEST_METHOD'];

    match(true) {
        $action === 'verify'   && $method === 'POST' => verifierOTP(),
        $action === 'resend'   && $method === 'POST' => renvoyerOTP(),
        $action === 'generate' && $method === 'POST' => genererOTP(),
        default => jsonError('Action inconnue.', 404),
    };
}

// ── VÉRIFICATION OTP ─────────────────────────────────────────────
function verifierOTP(): void
{
    $d          = readJSON();
    $compte     = trim($d['compte']     ?? '');
    $otp        = trim($d['otp']        ?? '');
    $tempToken  = trim($d['temp_token'] ?? '');

    if (!$compte || !$otp) {
        jsonError('Compte et OTP requis.', 422);
        return;
    }

    // Rate limiting : 3 tentatives OTP / 5 minutes
    rateLimit('otp_' . md5($compte), 3, 300);

    $pdo = getPDO();

    // Vérifier le temp_token si fourni
    if ($tempToken) {
        $stmt = $pdo->prepare(
            'SELECT st.user_id FROM sessions_temp st
             JOIN utilisateurs u ON u.id = st.user_id
             WHERE st.token = ? AND u.compte = ?
               AND st.created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)'
        );
        $stmt->execute([$tempToken, $compte]);
        if (!$stmt->fetch()) {
            logSec('FAIL', "Temp token invalide ou expiré : {$compte}");
            jsonError('Session expirée. Veuillez vous reconnecter.', 401);
            return;
        }
    }

    // Récupérer l'OTP valide en base
    $stmt = $pdo->prepare(
        'SELECT o.id, o.code_hash, o.user_id,
                u.compte, u.nom, u.prenom, u.email, u.telephone, u.role, u.statut
         FROM otps o
         JOIN utilisateurs u ON u.id = o.user_id
         WHERE u.compte  = :compte
           AND o.utilise  = 0
           AND o.expire_a > NOW()
         ORDER BY o.created_at DESC
         LIMIT 1'
    );
    $stmt->execute([':compte' => $compte]);
    $row = $stmt->fetch();

    if (!$row) {
        logSec('FAIL', "OTP expiré ou inexistant : {$compte}");
        jsonError('Code OTP expiré ou invalide. Demandez un nouveau code.', 401);
        return;
    }

    // Vérification hash timing-safe
    if (!hash_equals($row['code_hash'], hash('sha256', $otp))) {
        logSec('FAIL', "OTP incorrect : {$compte}");
        jsonError('Code OTP incorrect.', 401);
        return;
    }

    // Invalider l'OTP (usage unique)
    $pdo->prepare('UPDATE otps SET utilise=1, utilise_a=NOW() WHERE id=?')
        ->execute([$row['id']]);

    // Supprimer la session temporaire
    if ($tempToken) {
        $pdo->prepare('DELETE FROM sessions_temp WHERE token=?')->execute([$tempToken]);
    }

    // Mettre à jour la dernière connexion
    $pdo->prepare('UPDATE utilisateurs SET last_login=NOW() WHERE id=?')
        ->execute([$row['user_id']]);

    // Générer le JWT
    $token = genererToken([
        'id'     => $row['user_id'],
        'compte' => $row['compte'],
        'role'   => $row['role'],
    ]);

    logSec('AUTH', "OTP validé — connexion établie : {$compte}");
    jsonReponse([
        'token' => $token,
        'user'  => [
            'id'           => $row['user_id'],
            'compte'       => $row['compte'],
            'nom'          => $row['nom'],
            'prenom'       => $row['prenom'],
            'email'        => $row['email'],
            'telephone'    => $row['telephone'],
            'role'         => $row['role'],
            'statut'       => $row['statut'],
            'twofa_active' => true,
        ],
    ]);
}

// ── RENVOI OTP ───────────────────────────────────────────────────
function renvoyerOTP(): void
{
    $d      = readJSON();
    $compte = trim($d['compte'] ?? '');

    if (!$compte) {
        jsonError('Compte requis.', 422);
        return;
    }

    // Rate limiting : max 3 renvois / 5 minutes
    rateLimit('otp_resend_' . md5($compte), 3, 300);

    $pdo  = getPDO();
    $stmt = $pdo->prepare(
        'SELECT id, email FROM utilisateurs WHERE compte = ? AND statut = "actif"'
    );
    $stmt->execute([$compte]);
    $user = $stmt->fetch();

    if (!$user) {
        jsonError('Compte introuvable ou inactif.', 404);
        return;
    }

    // Générer et envoyer le nouveau code
    $code = creerOTP($user['id']);           // invalide les anciens automatiquement
    envoyerEmailOTP($user['email'], $compte, $code);

    logSec('AUTH', "OTP renvoyé : {$compte}");
    jsonReponse(['message' => 'Nouveau code OTP envoyé par email.']);
}

// ── GÉNÉRATION OTP (endpoint authentifié) ────────────────────────
function genererOTP(): void
{
    $payload = authentifier();
    $pdo     = getPDO();

    $stmt = $pdo->prepare('SELECT email FROM utilisateurs WHERE id = ?');
    $stmt->execute([$payload['sub']]);
    $user = $stmt->fetch();

    if (!$user) {
        jsonError('Utilisateur introuvable.', 404);
        return;
    }

    $code = creerOTP($payload['sub']);
    envoyerEmailOTP($user['email'], $payload['compte'], $code);

    jsonReponse(['message' => 'OTP généré et envoyé par email.']);
}
