<?php
// ================================================================
// directcash/backend/helpers.php
// Fonctions partagées : OTP (génération + email)
// Inclus par auth.php ET otp.php
// ================================================================
declare(strict_types=1);

// Chargement automatique PHPMailer (composer)
if (file_exists(__DIR__ . '/vendor/autoload.php')) {
    require_once __DIR__ . '/vendor/autoload.php';
}

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as MailException;

// ── CRÉER ET STOCKER UN OTP ──────────────────────────────────────
function creerOTP(int $userId): string
{
    // Code aléatoire cryptographiquement sûr
    $code = str_pad((string)random_int(0, 999999), OTP_LENGTH, '0', STR_PAD_LEFT);
    $hash = hash('sha256', $code);

    // Stocker en clair  en développement
    $codePlain = (DC_ENV === 'development') ? $code : null;

    $pdo = getPDO();

    // Invalider les codes précédents non utilisés
    $pdo->prepare('UPDATE otps SET utilise=1, utilise_a=NOW() WHERE user_id=? AND utilise=0')
        ->execute([$userId]);

    // Insérer le nouveau code
    $pdo->prepare(
        'INSERT INTO otps (user_id, code_hash, code_plain, expire_a, created_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ' . OTP_EXPIRY . ' SECOND), NOW())'
    )->execute([$userId, $hash, $codePlain]);

    // Log en développement
    if (DC_ENV === 'development') {
        logSec('INFO', "OTP DEV généré — user_id={$userId} : {$code}");
    }

    return $code;
}

// ── ENVOI EMAIL OTP ──────────────────────────────────────────────
function envoyerEmailOTP(string $email, string $compte, string $code): void
{
    // Log immédiat en dev (visible même si SMTP échoue)
    if (DC_ENV === 'development') {
        logSec('INFO', "OTP DEV EMAIL — {$email} ({$compte}) : {$code}");
    }

    // Vérifier que PHPMailer est disponible
    if (!class_exists('PHPMailer\PHPMailer\PHPMailer')) {
        logSec('WARN', "PHPMailer non disponible — OTP non envoyé à {$email}. Installez : composer require phpmailer/phpmailer");
        return;
    }

    $expireMin = intdiv(OTP_EXPIRY, 60);

    try {
        $mail = new PHPMailer(true);

        // ── Config SMTP ──────────────────────────────────────────
        $mail->isSMTP();
        $mail->Host        = MAIL_HOST;
        $mail->SMTPAuth    = true;
        $mail->Username    = MAIL_USER;
        $mail->Password    = MAIL_PASS;
        $mail->SMTPSecure  = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port        = MAIL_PORT;
        $mail->CharSet     = 'UTF-8';
        $mail->Timeout     = 10;

        // ── Expéditeur / Destinataire ────────────────────────────
        $mail->setFrom(MAIL_FROM, MAIL_FROM_NAME);
        $mail->addAddress($email);

        // ── Contenu HTML ─────────────────────────────────────────
        $mail->isHTML(true);
        $mail->Subject = 'DirectCash — Votre code de vérification';
        $mail->Body    = "
<!DOCTYPE html>
<html lang='fr'>
<head><meta charset='UTF-8'></head>
<body style='margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;'>
  <table width='100%' cellpadding='0' cellspacing='0' style='background:#f4f6f9;padding:40px 0;'>
    <tr><td align='center'>
      <table width='480' cellpadding='0' cellspacing='0'
             style='background:#ffffff;border-radius:12px;
                    box-shadow:0 2px 12px rgba(0,0,0,0.08);overflow:hidden;'>

        <!-- Header -->
        <tr>
          <td style='background:#1a73e8;padding:28px 40px;text-align:center;'>
            <h1 style='margin:0;color:#ffffff;font-size:24px;letter-spacing:1px;'>
              💳 DirectCash
            </h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style='padding:36px 40px;'>
            <p style='margin:0 0 12px;color:#333;font-size:16px;'>
              Bonjour <strong>{$compte}</strong>,
            </p>
            <p style='margin:0 0 24px;color:#555;font-size:14px;line-height:1.6;'>
              Voici votre code de vérification pour accéder à votre compte DirectCash :
            </p>

            <!-- Code OTP -->
            <div style='background:#f0f7ff;border:2px dashed #1a73e8;border-radius:10px;
                        padding:24px;text-align:center;margin:0 0 24px;'>
              <span style='font-size:42px;font-weight:bold;letter-spacing:12px;
                           color:#1a73e8;font-family:monospace;'>
                {$code}
              </span>
            </div>

            <p style='margin:0 0 8px;color:#e53935;font-size:13px;text-align:center;'>
              ⏱ Ce code expire dans <strong>{$expireMin} minutes</strong>.
            </p>
            <p style='margin:0;color:#999;font-size:12px;text-align:center;'>
              Si vous n'avez pas demandé ce code, ignorez cet email.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style='background:#f9f9f9;padding:16px 40px;border-top:1px solid #eee;
                     text-align:center;'>
            <p style='margin:0;color:#aaa;font-size:11px;'>
              © " . date('Y') . " DirectCash Cameroun — Ne pas répondre à cet email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>";

        $mail->AltBody = "Votre code DirectCash : {$code}\nExpire dans {$expireMin} minutes.\nNe partagez jamais ce code.";

        $mail->send();
        logSec('INFO', "OTP email envoyé avec succès : {$email}");

    } catch (MailException $e) {
        logSec('WARN', "Échec envoi email OTP : {$email} — " . $mail->ErrorInfo);
        // On ne bloque pas le flux — en dev le code est déjà dans security.log
    }
}
