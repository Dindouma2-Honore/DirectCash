<?php
// ================================================================
// directcash/backend/compte.php
// Solde · Numéro de compte · Supervision
// ================================================================
declare(strict_types=1);
require_once __DIR__ . '/config.php';

$action = $_GET['action'] ?? 'solde';
$method = $_SERVER['REQUEST_METHOD'];


match (true) {
    $action === 'solde'       && $method === 'GET'  => getSolde(),
    $action === 'supervision' && $method === 'GET'  => getSupervision(),
    $action === 'plafonds'    && $method === 'GET'  => getPlafonds(),
    $action === 'sessions'    && $method === 'GET'  => getSessions(),
    $action === 'changer_pin' && $method === 'PUT'  => changerPin(),
    // ✅ GET sans action → retourner le solde par défaut
    $action === ''            && $method === 'GET'  => getSolde(),
    default => jsonError("Action inconnue: '{$action}'", 404),
};

function getSolde(): void
{
    $payload = authentifier();
    $pdo     = getPDO();
    $stmt    = $pdo->prepare(
        'SELECT c.numero, c.solde, c.solde_bloque,
                c.plafond_journalier, c.plafond_mensuel,
                COALESCE(SUM(CASE WHEN t.type="retrait" AND DATE(t.created_at)=CURDATE()
                               AND t.statut="valide" THEN t.montant ELSE 0 END), 0) AS depense_jour,
                COALESCE(SUM(CASE WHEN t.type IN("retrait","envoi")
                               AND MONTH(t.created_at)=MONTH(NOW())
                               AND t.statut="valide" THEN t.montant ELSE 0 END), 0) AS depense_mois
         FROM comptes c
         LEFT JOIN transactions t ON t.compte_source = c.numero
         WHERE c.user_id = ?
         GROUP BY c.id'
    );
    $stmt->execute([$payload['sub']]);
    $compte = $stmt->fetch();
 if (!$compte) { jsonError('Compte introuvable.', 404); return; }
    jsonReponse($compte);
    if (!$compte) {
    // Retourner un solde vide plutôt qu'un 404 qui déclenche logout()
    jsonReponse([
        'numero'             => null,
        'solde'              => 0,
        'solde_bloque'       => 0,
        'plafond_journalier' => 0,
        'plafond_mensuel'    => 0,
        'depense_jour'       => 0,
        'depense_mois'       => 0,
    ]);
    return;
}
}

function getPlafonds(): void
{
    $payload = authentifier();
    $pdo     = getPDO();
    $stmt    = $pdo->prepare('SELECT plafond_journalier,plafond_mensuel FROM comptes WHERE user_id=?');
    $stmt->execute([$payload['sub']]);
    jsonReponse($stmt->fetch() ?: []);
}
// GET /compte.php?action=sessions
function getSessions(): void {
    $payload    = authentifier();
    $pdo        = getPDO();
    $tokenActuel = hash('sha256', getBearerToken());

    $stmt = $pdo->prepare("
        SELECT id, appareil, localisation, ip,
               DATE_FORMAT(derniere_activite, '%d/%m/%Y %H:%i') AS date,
               (token_hash = ?) AS actuel
        FROM sessions
        WHERE user_id = ?
        ORDER BY derniere_activite DESC
        LIMIT 5
    ");
    $stmt->execute([$tokenActuel, $payload['sub']]);
    jsonReponse($stmt->fetchAll());
}
function getSupervision(): void
{
    requireRole('admin','gestionnaire');
    $pdo = getPDO();

    $stats = $pdo->query(
        'SELECT
           (SELECT COUNT(*) FROM utilisateurs WHERE statut="actif") AS utilisateurs_actifs,
           (SELECT COALESCE(SUM(montant),0) FROM transactions
            WHERE DATE(created_at)=CURDATE() AND statut="valide") AS volume_jour,
           (SELECT COUNT(*) FROM transactions
            WHERE DATE(created_at)=CURDATE() AND statut="valide") AS nb_transactions_jour,
           99.8 AS disponibilite,
           (SELECT COUNT(*) FROM logs_securite
            WHERE type="BLOCK" AND DATE(created_at)=CURDATE()) AS attaques_bloquees'
    )->fetch();

    jsonReponse($stats);
}
// Changer PIN
function changerPin(): void
{
    $payload = authentifier();
    $d       = readJSON();

    $ancienPin  = trim($d['ancien_pin'] ?? '');
    $nouveauPin = trim($d['nouveau_pin'] ?? '');

    if (strlen($ancienPin) < 4 || strlen($nouveauPin) < 4) {
        jsonError('PIN invalide (4 caractères minimum).', 422);
        return;
    }

    $pdo  = getPDO();
    $stmt = $pdo->prepare('SELECT pin_hash FROM utilisateurs WHERE id = ? AND statut = "actif"');
    $stmt->execute([$payload['sub']]);
    $user = $stmt->fetch();

    if (!$user) {
        jsonError('Utilisateur introuvable.', 404);
        return;
    }

    // SHA256 — cohérent avec verifierPin() et retrait()
    if (!hash_equals($user['pin_hash'], hash('sha256', $ancienPin))) {
        logSec('FAIL', "Mauvais ancien PIN uid={$payload['sub']}");
        jsonError('Ancien PIN incorrect.', 401);
        return;
    }

    // Empêcher réutilisation du même PIN
    if (hash_equals($user['pin_hash'], hash('sha256', $nouveauPin))) {
        jsonError('Le nouveau PIN doit être différent de l\'ancien.', 422);
        return;
    }

    // ✅ Stocker en SHA256 — cohérent avec le reste
    $newHash = hash('sha256', $nouveauPin);

    $pdo->prepare('UPDATE utilisateurs SET pin_hash = ? WHERE id = ?')
        ->execute([$newHash, $payload['sub']]);

    logSec('AUTH', "PIN modifié uid={$payload['sub']}");
    jsonReponse(['message' => 'PIN mis à jour avec succès.']);
}
