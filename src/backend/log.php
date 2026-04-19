<?php
// ================================================================
// directcash/backend/log.php
// Journaux sécurité · Alertes · Lecture des logs
// ================================================================
declare(strict_types=1);
require_once __DIR__ . '/config.php';

$action = $_GET['action'] ?? 'liste';
$method = $_SERVER['REQUEST_METHOD'];

match(true) {
    $action === 'alertes'  && $method === 'GET'  => getAlertes(),
    $action === 'resoudre' && $method === 'PUT'  => resoudreAlerte(),
    $method === 'GET'                            => getLogs(),
    default => jsonError('Action inconnue.', 404),
};

// ── LISTE DES LOGS ───────────────────────────────────────────────
function getLogs(): void
{
    requireRole('admin', 'gestionnaire');
    $pdo    = getPDO();
    $limit  = min(200, (int)($_GET['limit'] ?? 100));
    $type   = cleanXSS($_GET['type']  ?? '');
    $params = [];
    $where  = '';

    if ($type) {
        $where    = 'WHERE type=?';
        $params[] = $type;
    }

    $params[] = $limit;
    $stmt = $pdo->prepare(
        "SELECT id,type,message,ip,data,created_at
         FROM logs_securite {$where}
         ORDER BY created_at DESC LIMIT ?"
    );
    $stmt->execute($params);
    jsonReponse($stmt->fetchAll());
}

// ── ALERTES DE SÉCURITÉ ──────────────────────────────────────────
function getAlertes(): void
{
    requireRole('admin', 'gestionnaire');
    $stmt = getPDO()->query(
        "SELECT id, titre, description, severite, statut, type, ip, created_at
         FROM alertes_securite
         ORDER BY created_at DESC
         LIMIT 50"
    );
    jsonReponse($stmt->fetchAll());
}

// ── RÉSOUDRE UNE ALERTE ──────────────────────────────────────────
function resoudreAlerte(): void
{
    $payload = requireRole('admin', 'gestionnaire');
    $id      = (int)($_GET['id'] ?? 0);
    if (!$id) { jsonError('ID requis.', 422); return; }

    getPDO()->prepare(
        'UPDATE alertes_securite SET statut="resolue", resolue_par=?, resolue_a=NOW() WHERE id=?'
    )->execute([$payload['sub'], $id]);

    logSec('AUTH', "Alerte #{$id} résolue par {$payload['compte']}");
    jsonReponse(['message' => "Alerte #{$id} résolue."]);
}
