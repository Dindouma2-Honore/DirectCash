<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/vendor/autoload.php';
use PHPMailer\PHPMailer\PHPMailer;

$mail = new PHPMailer(true);
try {
    $mail->isSMTP();
    $mail->Host       = MAIL_HOST;
    $mail->SMTPAuth   = true;
    $mail->Username   = MAIL_USER;
    $mail->Password   = MAIL_PASS;
    $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
    $mail->Port       = MAIL_PORT;
    $mail->setFrom(MAIL_FROM, MAIL_FROM_NAME);
    $mail->addAddress(MAIL_USER); // s'envoyer à soi-même
    $mail->Subject = 'Test DirectCash';
    $mail->Body    = 'OTP test : 123456';
    $mail->send();
    echo 'Email envoyé OK';
} catch (Exception $e) {
    echo 'Erreur : ' . $mail->ErrorInfo;
}
