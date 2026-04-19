<?php
// ================================================================
// directcash/backend/notification.php
// Notifications utilisateur
// ================================================================
declare(strict_types=1);
require_once __DIR__ . '/config.php';

$action = $_GET['action'] ?? 'liste';
$method = $_SERVER['REQUEST_METHOD'];

match(true) {
    $action === 'tout_lire' && $method === 'PUT' => marquerToutLu(),
    $method === 'GET'                            => getNotifications(),
    $method === 'PUT'                            => marquerLu(),
    default => jsonError('Action inconnue.', 404),
};

function getNotifications(): void
{
    $payload = authentifier();
    $stmt    = getPDO()->prepare(
        'SELECT id,titre,corps,lu,type,created_at FROM notifications
         WHERE user_id=? ORDER BY created_at DESC LIMIT 50'
    );
    $stmt->execute([$payload['sub']]);
    jsonReponse($stmt->fetchAll());
}

function marquerLu(): void
{
    $payload = authentifier();
    $id      = (int)($_GET['id'] ?? 0);
    if (!$id) { jsonError('ID requis.', 422); return; }
    getPDO()->prepare('UPDATE notifications SET lu=1 WHERE id=? AND user_id=?')
        ->execute([$id, $payload['sub']]);
    jsonReponse(['message' => 'Notification lue.']);
}

function marquerToutLu(): void
{
    $payload = authentifier();
    getPDO()->prepare('UPDATE notifications SET lu=1 WHERE user_id=?')
        ->execute([$payload['sub']]);
    jsonReponse(['message' => 'Toutes les notifications lues.']);
}
