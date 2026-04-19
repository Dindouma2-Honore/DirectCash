<?php
// ================================================================
// directcash/backend/config.php
// ================================================================
// CORS MUST be the very first thing — before declare(), before output
// ================================================================

declare(strict_types=1);

// Content-Type uniquement (CORS géré par .htaccess)
header('Content-Type: application/json; charset=utf-8');

// ── Constantes ───────────────────────────────────────────────────
define('DC_ENV',             getenv('DC_ENV')        ?: 'development');
define('DB_HOST',            getenv('DB_HOST')       ?: 'localhost');
define('DB_NAME',            getenv('DB_NAME')       ?: 'directcash');
define('DB_USER',            getenv('DB_USER')       ?: 'root');
define('DB_PASS',            getenv('DB_PASS')       ?: '');
define('DB_CHARSET',         'utf8mb4');
define('JWT_SECRET',         getenv('JWT_SECRET')    ?: 'DC_S3CR3T_K3Y_CHANGE_EN_PROD_2024');
define('JWT_EXPIRY',         900);
define('BCRYPT_COST',        12);
define('OTP_EXPIRY',         300);
define('OTP_LENGTH',         6);
define('MAX_LOGIN_ATTEMPTS', 3);
define('LOCKOUT_DURATION',   900);
define('LOG_SECRET',         getenv('LOG_SECRET')    ?: 'DC_LOG_HMAC_2024');
define('LOG_PATH',           __DIR__ . '/logs/security.log');

// ── Email (OTP) ──────────────────────────────────────────────────
define('MAIL_HOST',     'smtp.gmail.com');      // ou smtp.orange.cm, etc.
define('MAIL_PORT',     587);
define('MAIL_USER',     'dindoumahonore@gmail.com'); // ← ton adresse
define('MAIL_PASS',     'wxljzredrtrmerfk');// ← mot de passe app Gmail
define('MAIL_FROM',     'dindoumahonore@gmail.com');
define('MAIL_FROM_NAME','DirectCash');
// ================================================================
// PDO SINGLETON
// ================================================================
function getPDO(): PDO
{
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', DB_HOST, DB_NAME, DB_CHARSET);
    try {
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci",
        ]);
    } catch (PDOException $e) {
        jsonError('Base de données inaccessible.', 503);
        exit;
    }
    return $pdo;
}

// ================================================================
// JWT HS256
// ================================================================
function b64url_encode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}
function b64url_decode(string $data): string
{
    return base64_decode(strtr($data, '-_', '+/'));
}
function jwtEncode(array $payload): string
{
    $h = b64url_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $p = b64url_encode(json_encode($payload));
    $s = b64url_encode(hash_hmac('sha256', "{$h}.{$p}", JWT_SECRET, true));
    return "{$h}.{$p}.{$s}";
}
function jwtDecode(string $token): array
{
    $parts = explode('.', $token);
    if (count($parts) !== 3) throw new RuntimeException('Token malformé', 401);
    [$h, $p, $s] = $parts;
    $expected = b64url_encode(hash_hmac('sha256', "{$h}.{$p}", JWT_SECRET, true));
    if (!hash_equals($expected, $s)) throw new RuntimeException('Signature invalide', 401);
    $payload = json_decode(b64url_decode($p), true);
    if (!$payload) throw new RuntimeException('Payload invalide', 401);
    if (isset($payload['exp']) && $payload['exp'] < time()) {
        throw new RuntimeException('Token expiré', 401);
    }
    return $payload;
}
function genererToken(array $user): string
{
    return jwtEncode([
        'sub'    => $user['id'],
        'compte' => $user['compte'],
        'role'   => $user['role'],
        'iss'    => 'directcash.cm',
        'iat'    => time(),
        'exp'    => time() + JWT_EXPIRY,
        'jti'    => bin2hex(random_bytes(8)),
    ]);
}

// ================================================================
// AUTH MIDDLEWARE
// ================================================================

function getBearerToken(): ?string
{
    // Source 1 — header standard
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        return $_SERVER['HTTP_AUTHORIZATION'];
    }
    // Source 2 — Apache mod_rewrite redirect
    if (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        return $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    // Source 3 — getallheaders() (fonctionne sur la plupart des configs Apache)
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $key => $value) {
            if (strtolower($key) === 'authorization') {
                return $value;
            }
        }
    }
    // Source 4 — Lire les headers bruts depuis apache_request_headers()
    if (function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $key => $value) {
            if (strtolower($key) === 'authorization') {
                return $value;
            }
        }
    }
    return null;
}
 
function authentifier(): array
{
    $auth = getBearerToken();
 
    if (!$auth || !str_starts_with($auth, 'Bearer ')) {
        jsonError('Token manquant.', 401);
        exit;
    }
 
    try {
        return jwtDecode(substr($auth, 7));
    } catch (RuntimeException $e) {
        jsonError($e->getMessage(), (int)$e->getCode() ?: 401);
        exit;
    }
}

function requireRole(string ...$roles): array
{
    $payload = authentifier();
    if (!in_array($payload['role'], $roles, true)) {
        jsonError('Accès refusé.', 403); exit;
    }
    return $payload;
}

// ================================================================
// AUTOMATE DÉTECTION SQL INJECTION
// ================================================================
function detecterSQL(string $input): bool
{
    $patterns = [
        '/UNION\s+SELECT/i', '/OR\s+\d+\s*=\s*\d+/i',
        "/'\s*OR\s*'1'\s*=\s*'1/i", '/DROP\s+(TABLE|DATABASE)/i',
        '/DELETE\s+FROM/i', '/;\s*--/i', '/SLEEP\s*\(/i',
        '/BENCHMARK\s*\(/i', '/EXEC\s*\(/i', '/INTO\s+OUTFILE/i',
        '/INFORMATION_SCHEMA/i', '/\/\*.*\*\//s',
    ];
    foreach ($patterns as $p) {
        if (preg_match($p, $input)) return true;
    }
    return false;
}
function validerEntrees(array $data): void
{
    array_walk_recursive($data, function ($val) {
        if (is_string($val) && detecterSQL($val)) {
            logSec('BLOCK', 'SQL injection tentée', ['val' => substr($val, 0, 80)]);
            jsonError('Saisie invalide détectée.', 400);
            exit;
        }
    });
}

// ================================================================
// PROTECTION XSS
// ================================================================
function cleanXSS(mixed $input): mixed
{
    if (is_array($input)) return array_map('cleanXSS', $input);
    if (!is_string($input)) return $input;
    $input = strip_tags($input);
    $input = htmlspecialchars($input, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $input = preg_replace('/\b(javascript|vbscript|data)\s*:/i', '', $input);
    $input = preg_replace('/\bon\w+\s*=/i', '', $input);
    return trim($input);
}

// ================================================================
// LECTURE JSON SÉCURISÉE
// ================================================================
function readJSON(): array
{
    $raw = file_get_contents('php://input');
    if (empty($raw)) return [];
    $data = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        jsonError('JSON invalide.', 400); exit;
    }
    validerEntrees($data);
    return cleanXSS($data);
}

// ================================================================
// RATE LIMITING
// ================================================================
function rateLimit(string $cle, int $max = 10, int $fenetre = 60): void
{
    $fichier = sys_get_temp_dir() . '/dc_rl_' . md5($cle) . '.json';
    $now     = time();
    $data    = file_exists($fichier)
        ? (json_decode(file_get_contents($fichier), true) ?? [])
        : [];
    $hits    = array_filter($data['hits'] ?? [], fn($t) => $t > $now - $fenetre);
    if (count($hits) >= $max) {
        logSec('BLOCK', "Rate limit : {$cle}", ['ip' => getIP()]);
        jsonError('Trop de requêtes. Réessayez dans quelques instants.', 429);
        exit;
    }
    $hits[] = $now;
    file_put_contents($fichier, json_encode(['hits' => array_values($hits)]), LOCK_EX);
}

// ================================================================
// LOGS SÉCURITÉ
// ================================================================
function logSec(string $type, string $msg, array $data = []): void
{
    $entry = [
        'ts'      => date('c'),
        'type'    => $type,
        'message' => $msg,
        'ip'      => getIP(),
        'data'    => $data,
    ];
    $entry['hash'] = hash_hmac('sha256', json_encode($entry), LOG_SECRET);
    $dir = dirname(LOG_PATH);
    if (!is_dir($dir)) mkdir($dir, 0750, true);
    file_put_contents(LOG_PATH, json_encode($entry) . PHP_EOL, FILE_APPEND | LOCK_EX);
    try {
        $pdo  = getPDO();
        $stmt = $pdo->prepare(
            'INSERT INTO logs_securite (type, message, ip, data, created_at)
             VALUES (:type, :message, :ip, :data, NOW())'
        );
        $stmt->execute([':type'=>$type,':message'=>$msg,':ip'=>getIP(),':data'=>json_encode($data)]);
    } catch (PDOException) {}
}

// ================================================================
// UTILITAIRES
// ================================================================
function getIP(): string
{
    foreach (['HTTP_CF_CONNECTING_IP','HTTP_X_FORWARDED_FOR','REMOTE_ADDR'] as $k) {
        if (!empty($_SERVER[$k])) return trim(explode(',', $_SERVER[$k])[0]);
    }
    return '0.0.0.0';
}
function genCodeTx(): string
{
    return 'DC-TXN-' . strtoupper(bin2hex(random_bytes(4)));
}
function genNumeroCompte(): string
{
    $pdo = getPDO();
    do {
        $n    = 'DC-237-' . str_pad((string)random_int(1, 9999), 4, '0', STR_PAD_LEFT);
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM utilisateurs WHERE compte = ?');
        $stmt->execute([$n]);
    } while ((int)$stmt->fetchColumn() > 0);
    return $n;
}
function jsonReponse(mixed $data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
function jsonError(string $msg, int $code = 400): void
{
    jsonReponse(['error' => true, 'message' => $msg], $code);
}
?>