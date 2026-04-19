<?php
// ================================================================
// directcash/backend/compte.php
// Solde · Numéro de compte · Supervision
// ================================================================
declare(strict_types=1);
require_once __DIR__ . '/config.php';

$action = $_GET['action'] ?? 'solde';
$method = $_SERVER['REQUEST_METHOD'];

match(true) {
    $action === 'solde'       && $method === 'GET'  => getSolde(),
    $action === 'supervision' && $method === 'GET'  => getSupervision(),
    $action === 'plafonds'    && $method === 'GET'  => getPlafonds(),
    default => getSolde(),
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
}

function getPlafonds(): void
{
    $payload = authentifier();
    $pdo     = getPDO();
    $stmt    = $pdo->prepare('SELECT plafond_journalier,plafond_mensuel FROM comptes WHERE user_id=?');
    $stmt->execute([$payload['sub']]);
    jsonReponse($stmt->fetch() ?: []);
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
