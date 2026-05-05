<?php
// ================================================================
// directcash/backend/transaction.php
// Dépôt · Envoi · Retrait · Historique · Idempotence
// ================================================================
declare(strict_types=1);

require_once __DIR__ . '/config.php';

// PHPMailer (installer via : composer require phpmailer/phpmailer)
use PHPMailer\PHPMailer\Exception as MailException;
use PHPMailer\PHPMailer\PHPMailer;

require_once __DIR__ . '/vendor/autoload.php';

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

match (true) {
    $action === 'beneficiaires_frequents' && $method === 'GET' => beneficiairesFrequents(),
    $action === 'depot' && $method === 'POST' => depot(),
    $action === 'verifier_pin' && $method === 'POST' => verifierPin(),
    $action === 'send_otp_retrait' && $method === 'POST' => sendOTPRetrait(),
    $action === 'send_otp_envoi' && $method === 'POST' => sendOTPEnvoi(),
    $action === 'envoi' && $method === 'POST' => envoi(),
    $action === 'retrait' && $method === 'POST' => retrait(),

    $action === 'export_csv' && $method === 'GET' => exportCSV(),
    !empty($_GET['code']) && $method === 'GET' => getDetail(),
    $method === 'GET' => historique(),
    default => jsonError('Action inconnue.', 404),
};

// ================================================================
// GÉNÉRATION ET ENVOI DE L'OTP PAR EMAIL (pour le retrait)
// Appeler AVANT la route retrait, depuis le frontend.
// POST /transaction.php?action=send_otp_retrait
// Header: Authorization: Bearer <token>
// ================================================================
function sendOTPRetrait(): void
{
    $payload = authentifier();
    $pdo = getPDO();

    // Rate limit : max 3 demandes OTP / 5 min par utilisateur
    rateLimit('otp_retrait_' . $payload['sub'], 3, 300);

    // Récupérer email + nom de l'utilisateur
    $stmt = $pdo->prepare('SELECT email, prenom, nom FROM utilisateurs WHERE id = ?');
    $stmt->execute([$payload['sub']]);
    $user = $stmt->fetch();
    if (!$user) {
        jsonError('Utilisateur introuvable.', 404);
        return;
    }

    // Générer un OTP à 6 chiffres cryptographiquement sûr
    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $codeHash = hash('sha256', $code);
    $expireAt = date('Y-m-d H:i:s', time() + OTP_EXPIRY);  // OTP_EXPIRY = 300 s (config.php)

    // Invalider les anciens OTP non utilisés de cet utilisateur
    $pdo
        ->prepare('UPDATE otps SET utilise = 1 WHERE user_id = ? AND utilise = 0')
        ->execute([$payload['sub']]);

    // Sauvegarder le nouvel OTP en base
    $pdo->prepare(
        'INSERT INTO otps (user_id, code_hash, utilise, expire_a, created_at)
         VALUES (?, ?, 0, ?, NOW())'
    )->execute([$payload['sub'], $codeHash, $expireAt]);

    // Envoyer l'email
    $nomComplet = trim($user['prenom'] . ' ' . $user['nom']);
    $envoye = envoyerOTPEmail($user['email'], $nomComplet, $code);

    if (!$envoye) {
        logSec('OTP', "Échec envoi email OTP retrait : {$user['email']}");
        jsonError("Impossible d'envoyer l'email OTP. Réessayez.", 500);
        return;
    }

    logSec('OTP', "OTP retrait envoyé par email à {$user['email']}");
    jsonReponse([
        'message' => 'Code OTP envoyé à votre adresse email.',
        'email_masque' => maskEmail($user['email']),
        'expire_dans' => OTP_EXPIRY,  // secondes
    ]);
}

function sendOTPEnvoi(): void
{
    $payload = authentifier();
    $pdo = getPDO();

    // Rate limit : max 3 demandes OTP / 5 min par utilisateur
    rateLimit('otp_envoi_' . $payload['sub'], 3, 300);

    // Récupérer email + nom de l'utilisateur
    $stmt = $pdo->prepare('SELECT email, prenom, nom FROM utilisateurs WHERE id = ?');
    $stmt->execute([$payload['sub']]);
    $user = $stmt->fetch();
    if (!$user) {
        jsonError('Utilisateur introuvable.', 404);
        return;
    }

    // Générer un OTP à 6 chiffres cryptographiquement sûr
    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $codeHash = hash('sha256', $code);
    $expireAt = date('Y-m-d H:i:s', time() + OTP_EXPIRY);  // OTP_EXPIRY = 300 s (config.php)

    // Invalider les anciens OTP non utilisés de cet utilisateur
    $pdo
        ->prepare('UPDATE otps SET utilise = 1 WHERE user_id = ? AND utilise = 0')
        ->execute([$payload['sub']]);

    // Sauvegarder le nouvel OTP en base
    $pdo->prepare(
        'INSERT INTO otps (user_id, code_hash, utilise, expire_a, created_at)
         VALUES (?, ?, 0, ?, NOW())'
    )->execute([$payload['sub'], $codeHash, $expireAt]);

    // Envoyer l'email
    $nomComplet = trim($user['prenom'] . ' ' . $user['nom']);
    $envoye = envoyerOTPEmailEnvoi($user['email'], $nomComplet, $code);

    if (!$envoye) {
        logSec('OTP', "Échec envoi email OTP envoi : {$user['email']}");
        jsonError("Impossible d'envoyer l'email OTP. Réessayez.", 500);
        return;
    }

    logSec('OTP', "OTP envoi envoyé par email à {$user['email']}");
    jsonReponse([
        'message' => 'Code OTP envoyé à votre adresse email.',
        'email_masque' => maskEmail($user['email']),
        'expire_dans' => OTP_EXPIRY,  // secondes
    ]);
}

// ================================================================
// ENVOI EMAIL VIA PHPMAILER (SMTP Gmail — config dans config.php)
// ================================================================
function envoyerOTPEmail(string $email, string $nomComplet, string $code): bool
{
    $mail = new PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host = MAIL_HOST;  // smtp.gmail.com
        $mail->SMTPAuth = true;
        $mail->Username = MAIL_USER;  // dindoumahonore@gmail.com
        $mail->Password = MAIL_PASS;  // mot de passe App Gmail
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port = MAIL_PORT;  // 587
        $mail->CharSet = 'UTF-8';

        $mail->setFrom(MAIL_FROM, MAIL_FROM_NAME);
        $mail->addAddress($email, $nomComplet);

        $mail->isHTML(true);
        $mail->Subject = 'DirectCash — Code de confirmation de retrait';
        $mail->Body = genererCorpsEmail($nomComplet, $code);
        $mail->AltBody = genererCorpsEmailTexte($nomComplet, $code);

        $mail->send();
        return true;
    } catch (MailException) {
        logSec('MAIL', "PHPMailer erreur: {$mail->ErrorInfo}");
        return false;
    }
}

// ================================================================
// ENVOI EMAIL d'envoi VIA PHPMAILER (SMTP Gmail — config dans config.php)
// ================================================================
function envoyerOTPEmailEnvoi(string $email, string $nomComplet, string $code): bool
{
    $mail = new PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host = MAIL_HOST;  // smtp.gmail.com
        $mail->SMTPAuth = true;
        $mail->Username = MAIL_USER;  // dindoumahonore@gmail.com
        $mail->Password = MAIL_PASS;  // mot de passe App Gmail
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port = MAIL_PORT;  // 587
        $mail->CharSet = 'UTF-8';

        $mail->setFrom(MAIL_FROM, MAIL_FROM_NAME);
        $mail->addAddress($email, $nomComplet);

        $mail->isHTML(true);
        $mail->Subject = 'DirectCash — Code de confirmation de transfert';
        $mail->Body = genererDetailEmail($nomComplet, $code);
        $mail->AltBody = genererCorpsEmailTexte($nomComplet, $code);

        $mail->send();
        return true;
    } catch (MailException) {
        logSec('MAIL', "PHPMailer erreur: {$mail->ErrorInfo}");
        return false;
    }
}

// ── Template HTML ─────────────────────────────────────────────────
function genererCorpsEmail(string $nom, string $code): string
{
    $expireMin = (int) (OTP_EXPIRY / 60);
    return <<<HTML
        <!DOCTYPE html>
        <html lang="fr">
        <head><meta charset="UTF-8"></head>
        <body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px;">
          <div style="max-width:480px;margin:auto;background:#fff;border-radius:8px;
                      box-shadow:0 2px 8px rgba(0,0,0,.12);overflow:hidden;">

            <!-- En-tête -->
            <div style="background:#1a73e8;padding:24px;text-align:center;">
              <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:1px;">DirectCash</h1>
              <p style="color:#cfe2ff;margin:4px 0 0;font-size:13px;">
                Plateforme de paiement mobile sécurisée
              </p>
            </div>

            <!-- Corps -->
            <div style="padding:32px 28px;">
              <p style="color:#333;font-size:15px;margin-top:0;">
                Bonjour <strong>{$nom}</strong>,
              </p>
              <p style="color:#555;font-size:14px;line-height:1.7;">
                Vous avez initié une opération de <strong>retrait</strong> sur votre compte DirectCash.<br>
                Voici votre code de confirmation à usage unique :
              </p>

              <!-- Code OTP bien visible -->
              <div style="text-align:center;margin:28px 0;">
                <span style="display:inline-block;background:#f0f4ff;
                             border:2px dashed #1a73e8;border-radius:10px;
                             padding:18px 44px;font-size:38px;font-weight:bold;
                             letter-spacing:12px;color:#1a73e8;">
                  {$code}
                </span>
              </div>

              <p style="color:#c62828;font-size:13px;text-align:center;font-weight:bold;margin:0;">
                ⏱ Ce code expire dans <strong>{$expireMin} minutes</strong>.
              </p>

              <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">

              <p style="color:#888;font-size:12px;line-height:1.6;margin:0;">
                Si vous n'êtes pas à l'origine de cette demande, ignorez cet email et
                contactez immédiatement notre support.<br>
                <strong>Ne communiquez jamais ce code à qui que ce soit.</strong>
              </p>
            </div>

            <!-- Pied de page -->
            <div style="background:#f8f8f8;padding:14px;text-align:center;border-top:1px solid #eee;">
              <p style="color:#bbb;font-size:11px;margin:0;">
                &copy; DirectCash Cameroun &mdash; Sécurité &amp; Confiance
              </p>
            </div>
          </div>
        </body>
        </html>
        HTML;
}

function genererDetailEmail(string $nom, string $code): string
{
    $expireMin = (int) (OTP_EXPIRY / 60);
    return <<<HTML
        <!DOCTYPE html>
        <html lang="fr">
        <head><meta charset="UTF-8"></head>
        <body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px;">
          <div style="max-width:480px;margin:auto;background:#fff;border-radius:8px;
                      box-shadow:0 2px 8px rgba(0,0,0,.12);overflow:hidden;">

            <!-- En-tête -->
            <div style="background:#1a73e8;padding:24px;text-align:center;">
              <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:1px;">DirectCash</h1>
              <p style="color:#cfe2ff;margin:4px 0 0;font-size:13px;">
                Plateforme de paiement mobile sécurisée
              </p>
            </div>

            <!-- Corps -->
            <div style="padding:32px 28px;">
              <p style="color:#333;font-size:15px;margin-top:0;">
                Bonjour <strong>{$nom}</strong>,
              </p>
              <p style="color:#555;font-size:14px;line-height:1.7;">
                Vous avez initié une opération d'<strong>Envoi</strong> sur votre compte DirectCash.<br>
                Voici votre code de confirmation à usage unique :
              </p>

              <!-- Code OTP bien visible -->
              <div style="text-align:center;margin:28px 0;">
                <span style="display:inline-block;background:#f0f4ff;
                             border:2px dashed #1a73e8;border-radius:10px;
                             padding:18px 44px;font-size:38px;font-weight:bold;
                             letter-spacing:12px;color:#1a73e8;">
                  {$code}
                </span>
              </div>

              <p style="color:#c62828;font-size:13px;text-align:center;font-weight:bold;margin:0;">
                ⏱ Ce code expire dans <strong>{$expireMin} minutes</strong>.
              </p>

              <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">

              <p style="color:#888;font-size:12px;line-height:1.6;margin:0;">
                Si vous n'êtes pas à l'origine de cette demande, ignorez cet email et
                contactez immédiatement notre support.<br>
                <strong>Ne communiquez jamais ce code à qui que ce soit.</strong>
              </p>
            </div>

            <!-- Pied de page -->
            <div style="background:#f8f8f8;padding:14px;text-align:center;border-top:1px solid #eee;">
              <p style="color:#bbb;font-size:11px;margin:0;">
                &copy; DirectCash Cameroun &mdash; Sécurité &amp; Confiance
              </p>
            </div>
          </div>
        </body>
        </html>
        HTML;
}

// ── Version texte brut (fallback anti-spam) ───────────────────────
function genererCorpsEmailTexte(string $nom, string $code): string
{
    $expireMin = (int) (OTP_EXPIRY / 60);
    return "Bonjour {$nom},\n\n"
        . "Votre code OTP pour confirmer votre retrait DirectCash est :\n\n"
        . "  {$code}\n\n"
        . "Ce code expire dans {$expireMin} minutes.\n\n"
        . "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.\n\n"
        . '— DirectCash Cameroun';
}

// ── Masquage email pour la réponse API (ex: di***@gmail.com) ─────
function maskEmail(string $email): string
{
    [$local, $domain] = explode('@', $email, 2);
    $visible = substr($local, 0, 2);
    $stars = str_repeat('*', max(2, strlen($local) - 2));
    return "{$visible}{$stars}@{$domain}";
}

// ================================================================
// DÉPÔT
// ================================================================
function depot(): void
{
    $payload = authentifier();
    $d = readJSON();
    $montant = (float) ($d['montant'] ?? 0);
    $source = cleanXSS($d['source'] ?? '');
    $ref = cleanXSS($d['reference_externe'] ?? '');

    if ($montant < 500) {
        jsonError('Montant minimum : 500 FCFA.', 422);
        return;
    }
    if ($montant > 2000000) {
        jsonError('Montant maximum : 2 000 000 FCFA.', 422);
        return;
    }
    if (!$source) {
        jsonError('Source requise.', 422);
        return;
    }

    $pdo = getPDO();

    $stmt = $pdo->prepare('SELECT id, numero, solde FROM comptes WHERE user_id = ?');
    $stmt->execute([$payload['sub']]);
    $compte = $stmt->fetch();
    if (!$compte) {
        jsonError('Compte introuvable.', 404);
        return;
    }

    $code = genCodeTx();

    $pdo->beginTransaction();
    try {
        $pdo
            ->prepare('UPDATE comptes SET solde = solde + ? WHERE id = ?')
            ->execute([$montant, $compte['id']]);

        $pdo->prepare(
            'INSERT INTO transactions
               (code, type, compte_source, compte_dest, montant, frais, statut,
                reference_externe, idempotency_key, created_at)
             VALUES (?,?,?,?,?,0,"valide",?,?,NOW())'
        )->execute([$code, 'depot', 'EXTERNE', $compte['numero'], $montant, $ref, $code]);

        creerNotification($payload['sub'], 'Dépôt reçu',
            "+{$montant} FCFA de {$source} — {$code}");

        $pdo->commit();
        logSec('TXN', "Dépôt +{$montant} FCFA : {$compte['numero']}");
        jsonReponse([
            'transaction' => ['code' => $code, 'type' => 'depot', 'montant' => $montant],
            'nouveau_solde' => $compte['solde'] + $montant,
        ], 201);
    } catch (PDOException $e) {
        $pdo->rollBack();
        logSec('TXN', "Échec dépôt : {$e->getMessage()}");
        jsonError('Erreur lors du dépôt.', 500);
    }
}

// ================================================================
// ENVOI D'ARGENT
// ================================================================
function envoi(): void
{
    $payload = authentifier();
    $d = readJSON();
    $montant = (float) ($d['montant'] ?? 0);
    $dest = trim(cleanXSS($d['compte_dest'] ?? ''));
    $motif = cleanXSS($d['motif'] ?? '');
    $idemKey = cleanXSS($d['idempotency_key'] ?? '');
    $otp = trim($d['otp'] ?? '');

    if ($montant < 100) {
        jsonError('Montant minimum : 100 FCFA.', 422);
        return;
    }
    if (!$dest) {
        jsonError('Compte destinataire requis.', 422);
        return;
    }
    if (!$idemKey) {
        jsonError("Clé d'idempotence manquante.", 422);
        return;
    }
    if (strlen($otp) !== 6) {
        jsonError('Code OTP requis.', 422);
        return;
    }

    $pdo = getPDO();

    // Idempotence
    $stmt = $pdo->prepare('SELECT result_json FROM idempotency_keys WHERE cle = ? AND user_id = ?');
    $stmt->execute([$idemKey, $payload['sub']]);
    if ($existing = $stmt->fetch()) {
        jsonReponse(json_decode($existing['result_json'], true));
        return;
    }

    // Vérifier OTP
    $stmt = $pdo->prepare(
        'SELECT id FROM otps
         WHERE user_id = ? AND code_hash = ? AND utilise = 0 AND expire_a > NOW()
         LIMIT 1'
    );
    $stmt->execute([$payload['sub'], hash('sha256', $otp)]);
    $otpRow = $stmt->fetch();
    if (!$otpRow) {
        logSec('FAIL', "OTP email invalide ou expiré — retrait uid={$payload['sub']}");
        jsonError('Code OTP invalide ou expiré.', 401);
        return;
    }

    // Consommer l'OTP (usage unique)
    $pdo
        ->prepare('UPDATE otps SET utilise = 1, utilise_a = NOW() WHERE id = ?')
        ->execute([$otpRow['id']]);

    // Vérifier destinataire
    $stmt = $pdo->prepare('SELECT id, numero, solde FROM comptes WHERE numero = ?');
    $stmt->execute([$dest]);
    $compteDest = $stmt->fetch();
    if (!$compteDest) {
        jsonError('Compte destinataire introuvable.', 404);
        return;
    }

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT id, numero, solde FROM comptes WHERE user_id = ? FOR UPDATE');
        $stmt->execute([$payload['sub']]);
        $compteSource = $stmt->fetch();

        $frais = round($montant * 0.005, 0);
        $total = $montant + $frais;

        if ($compteSource['solde'] < $total) {
            $pdo->rollBack();
            jsonError('Solde insuffisant.', 402);
            return;
        }
        if ($compteSource['numero'] === $dest) {
            $pdo->rollBack();
            jsonError("Impossible d'envoyer à son propre compte.", 422);
            return;
        }

        $code = genCodeTx();

        $pdo
            ->prepare('UPDATE comptes SET solde = solde - ? WHERE id = ?')
            ->execute([$total, $compteSource['id']]);
        $pdo
            ->prepare('UPDATE comptes SET solde = solde + ? WHERE id = ?')
            ->execute([$montant, $compteDest['id']]);

        $pdo->prepare(
            'INSERT INTO transactions
               (code,type,compte_source,compte_dest,montant,frais,motif,statut,idempotency_key,created_at)
             VALUES (?,?,?,?,?,?,?,"valide",?,NOW())'
        )->execute([$code, 'envoi', $compteSource['numero'], $dest, $montant, $frais, $motif, $idemKey]);

        $result = [
            'transaction' => ['code' => $code, 'type' => 'envoi', 'montant' => $montant],
            'nouveau_solde' => $compteSource['solde'] - $total,
        ];
        $pdo->prepare(
            'INSERT INTO idempotency_keys (cle, user_id, result_json, created_at) VALUES (?,?,?,NOW())'
        )->execute([$idemKey, $payload['sub'], json_encode($result)]);

        creerNotification($payload['sub'], 'Envoi effectué',
            "-{$montant} FCFA → {$dest} — {$code}");

        $pdo->commit();
        logSec('TXN', "Envoi {$compteSource['numero']} → {$dest} : {$montant} FCFA");
        jsonReponse($result, 201);
    } catch (PDOException $e) {
        $pdo->rollBack();
        logSec('TXN', "Échec envoi : {$e->getMessage()}");
        jsonError('Erreur lors du transfert.', 500);
    }
}

// ================================================================
// RETRAIT  ← OTP désormais reçu par EMAIL (via sendOTPRetrait)
// ================================================================
function retrait(): void
{
    $payload = authentifier();
    $d = readJSON();
    $montant = (float) ($d['montant'] ?? 0);
    $mode = cleanXSS($d['mode'] ?? '');
    $pin = trim($d['pin'] ?? '');
    $otp = trim($d['otp'] ?? '');

    if ($montant < 500) {
        jsonError('Montant minimum : 500 FCFA.', 422);
        return;
    }
    if (!$mode) {
        jsonError('Mode de retrait requis.', 422);
        return;
    }
    if (strlen($pin) < 4) {
        jsonError('PIN requis (4-6 chiffres).', 422);
        return;
    }
    if (strlen($otp) !== 6) {
        jsonError('Code OTP requis.', 422);
        return;
    }

    $pdo = getPDO();

    // ── 1. Vérifier PIN ───────────────────────────────────────────
    $stmt = $pdo->prepare('SELECT pin_hash FROM utilisateurs WHERE id = ?');
    $stmt->execute([$payload['sub']]);
    $user = $stmt->fetch();
    if (!$user || !hash_equals($user['pin_hash'] ?? '', hash('sha256', $pin))) {
        logSec('FAIL', "PIN incorrect : {$payload['compte']}");
        jsonError('Code PIN incorrect.', 401);
        return;
    }

    // ── 2. Vérifier OTP reçu par email ───────────────────────────
    $stmt = $pdo->prepare(
        'SELECT id FROM otps
         WHERE user_id = ? AND code_hash = ? AND utilise = 0 AND expire_a > NOW()
         LIMIT 1'
    );
    $stmt->execute([$payload['sub'], hash('sha256', $otp)]);
    $otpRow = $stmt->fetch();
    if (!$otpRow) {
        logSec('FAIL', "OTP email invalide ou expiré — retrait uid={$payload['sub']}");
        jsonError('Code OTP invalide ou expiré.', 401);
        return;
    }

    // Consommer l'OTP (usage unique)
    $pdo
        ->prepare('UPDATE otps SET utilise = 1, utilise_a = NOW() WHERE id = ?')
        ->execute([$otpRow['id']]);

    // ── 3. Transaction sécurisée ──────────────────────────────────
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare(
            'SELECT id, numero, solde, plafond_journalier FROM comptes WHERE user_id = ? FOR UPDATE'
        );
        $stmt->execute([$payload['sub']]);
        $compte = $stmt->fetch();

        if ($compte['solde'] < $montant) {
            $pdo->rollBack();
            jsonError('Solde insuffisant.', 402);
            return;
        }

        $code = genCodeTx();

        $pdo
            ->prepare('UPDATE comptes SET solde = solde - ? WHERE id = ?')
            ->execute([$montant, $compte['id']]);

        $pdo->prepare(
            'INSERT INTO transactions
               (code, type, compte_source, montant, frais, mode_retrait, statut, idempotency_key, created_at)
             VALUES (?,?,?,?,0,?,"valide",?,NOW())'
        )->execute([$code, 'retrait', $compte['numero'], $montant, $mode, $code]);

        creerNotification($payload['sub'], 'Retrait effectué',
            "-{$montant} FCFA via {$mode} — {$code}");

        $pdo->commit();
        logSec('TXN', "Retrait -{$montant} FCFA : {$compte['numero']}");
        jsonReponse([
            'transaction' => ['code' => $code, 'type' => 'retrait', 'montant' => $montant],
            'nouveau_solde' => $compte['solde'] - $montant,
        ], 201);
    } catch (PDOException $e) {
        $pdo->rollBack();
        logSec('TXN', "Échec retrait : {$e->getMessage()}");
        jsonError('Erreur lors du retrait.', 500);
    }
}

// ===============================================================
// Verifier le code pin
// ================================================================
function verifierPin(): void
{
    $payload = authentifier();
    $d = readJSON();
    $pin = trim($d['pin'] ?? '');

    if (strlen($pin) < 4) {
        jsonError('PIN requis (4-6 chiffres).', 422);
        return;
    }

    $pdo = getPDO();
    $stmt = $pdo->prepare('SELECT pin_hash FROM utilisateurs WHERE id = ?');
    $stmt->execute([$payload['sub']]);
    $user = $stmt->fetch();

    if (!$user || !$user['pin_hash']) {
        jsonError('PIN non configuré. Contactez le support.', 403);
        return;
    }

    if (!hash_equals($user['pin_hash'], hash('sha256', $pin))) {
        logSec('FAIL', "PIN incorrect uid={$payload['sub']}");
        jsonError('Code PIN incorrect.', 401);
        return;
    }

    logSec('INFO', "PIN validé uid={$payload['sub']}");
    jsonReponse(['valide' => true]);
}

// ================================================================
// HISTORIQUE
// ================================================================
function historique(): void
{
    $payload = authentifier();
    $pdo = getPDO();

    $page = max(1, (int) ($_GET['page'] ?? 1));
    $limit = min(50, max(1, (int) ($_GET['limit'] ?? 10)));
    $offset = ($page - 1) * $limit;

    $stmt = $pdo->prepare('SELECT numero FROM comptes WHERE user_id = ?');
    $stmt->execute([$payload['sub']]);
    $numero = $stmt->fetchColumn();

    $where = ['(t.compte_source = ? OR t.compte_dest = ?)'];
    $params = [$numero, $numero];

    if (!empty($_GET['type'])) {
        $where[] = 't.type = ?';
        $params[] = cleanXSS($_GET['type']);
    }
    if (!empty($_GET['statut'])) {
        $where[] = 't.statut = ?';
        $params[] = cleanXSS($_GET['statut']);
    }
    if (!empty($_GET['date'])) {
        $where[] = 'DATE(t.created_at)=?';
        $params[] = cleanXSS($_GET['date']);
    }
    if (!empty($_GET['search'])) {
        $where[] = '(t.code LIKE ? OR t.compte_dest LIKE ? OR t.motif LIKE ?)';
        $s = '%' . cleanXSS($_GET['search']) . '%';
        $params = array_merge($params, [$s, $s, $s]);
    }

    $whereSQL = 'WHERE ' . implode(' AND ', $where);
    $stmtCount = $pdo->prepare("SELECT COUNT(*) FROM transactions t {$whereSQL}");
    $stmtCount->execute($params);
    $total = (int) $stmtCount->fetchColumn();

    $params[] = $limit;
    $params[] = $offset;
    $stmt = $pdo->prepare(
        "SELECT t.id,t.code,t.type,t.compte_source,t.compte_dest,t.montant,t.frais,
                t.motif,t.statut,t.idempotency_key,t.created_at
         FROM transactions t {$whereSQL}
         ORDER BY t.created_at DESC
         LIMIT ? OFFSET ?"
    );
    $stmt->execute($params);

    jsonReponse(['data' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'limit' => $limit]);
}
// ================================================================
// BÉNÉFICIAIRES FRÉQUENTS (top 10 destinataires d'envois)
// ================================================================
function beneficiairesFrequents(): void
{
    $payload = authentifier();
    $pdo     = getPDO();

    $stmt = $pdo->prepare('SELECT numero FROM comptes WHERE user_id = ?');
    $stmt->execute([$payload['sub']]);
    $numero = $stmt->fetchColumn();
    if (!$numero) { jsonError('Compte introuvable.', 404); return; }

    $stmt = $pdo->prepare("
        SELECT
            t.compte_dest,
            u.prenom,
            u.nom,
            u.telephone,
            COUNT(*)        AS nb_envois,
            SUM(t.montant)  AS total_envoye
        FROM transactions t
        JOIN comptes c  ON c.numero  = t.compte_dest
        JOIN utilisateurs u ON u.id = c.user_id
        WHERE t.compte_source = ?
          AND t.type           = 'envoi'
          AND t.statut         = 'valide'
        GROUP BY t.compte_dest, u.prenom, u.nom, u.telephone
        ORDER BY nb_envois DESC, total_envoye DESC
        LIMIT 10
    ");
    $stmt->execute([$numero]);
    jsonReponse($stmt->fetchAll());
}

// ================================================================
// DÉTAIL TRANSACTION
// ================================================================
function getDetail(): void
{
    $payload = authentifier();
    $code = cleanXSS($_GET['code'] ?? '');
    if (!$code) {
        jsonError('Code requis.', 422);
        return;
    }

    $stmt = getPDO()->prepare(
        'SELECT t.* FROM transactions t
         JOIN comptes c ON c.numero = t.compte_source OR c.numero = t.compte_dest
         WHERE t.code = ? AND c.user_id = ? LIMIT 1'
    );
    $stmt->execute([$code, $payload['sub']]);
    $tx = $stmt->fetch();
    if (!$tx) {
        jsonError('Transaction introuvable.', 404);
        return;
    }
    jsonReponse($tx);
}

// ================================================================
// EXPORT CSV
// ================================================================
function exportCSV(): void
{
    $payload = authentifier();
    $pdo = getPDO();

    $stmt = $pdo->prepare('SELECT numero FROM comptes WHERE user_id = ?');
    $stmt->execute([$payload['sub']]);
    $numero = $stmt->fetchColumn();

    $stmt = $pdo->prepare(
        'SELECT code, type, compte_source, compte_dest, montant, frais, motif, statut, created_at
         FROM transactions WHERE compte_source = ? OR compte_dest = ?
         ORDER BY created_at DESC LIMIT 1000'
    );
    $stmt->execute([$numero, $numero]);
    $rows = $stmt->fetchAll();

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="directcash-transactions-' . date('Y-m-d') . '.csv"');

    $out = fopen('php://output', 'w');
    fputcsv($out, ['Code', 'Type', 'Compte source', 'Compte dest', 'Montant', 'Frais', 'Motif', 'Statut', 'Date']);
    foreach ($rows as $r) {
        fputcsv($out, array_values($r));
    }
    fclose($out);
}

// ================================================================
// NOTIFICATION INTERNE
// ================================================================
function creerNotification(int $userId, string $titre, string $corps): void
{
    try {
        getPDO()->prepare(
            'INSERT INTO notifications (user_id, titre, corps, lu, type, created_at)
             VALUES (?, ?, ?, 0, "transaction", NOW())'
        )->execute([$userId, $titre, $corps]);
    } catch (PDOException) {
    }
}

// =====================================
//  action=stats_mois
// ========================================
// if (($_GET['action'] ?? '') === 'stats_mois') {
//     $mois = date('Y-m'); // mois actuel
//     $stmt = $pdo->prepare("
//         SELECT
//             type,
//             SUM(montant) AS total_montant,
//             COUNT(*)     AS nb_transactions
//         FROM transactions
//         WHERE compte_source = ?
//           AND statut = 'valide'
//           AND DATE_FORMAT(created_at, '%Y-%m') = ?
//         GROUP BY type
//     ");
//     $stmt->execute([$numero_compte, $mois]);
//     $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

//     $stats = ['depot' => ['total' => 0, 'nb' => 0],
//               'envoi' => ['total' => 0, 'nb' => 0],
//               'retrait' => ['total' => 0, 'nb' => 0]];
//     foreach ($rows as $r) {
//         $stats[$r['type']] = ['total' => (float)$r['total_montant'], 'nb' => (int)$r['nb_transactions']];
//     }
//     echo json_encode($stats);
//     exit;
// }
