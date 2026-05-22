<?php
// ================================================================
// directcash/backend/security.php
// Automate SQL · Sanitisation XSS · JWT · Validation JWT
// ================================================================
declare(strict_types=1);

require_once __DIR__ . '/config.php';

// ================================================================
//  1. PROTECTION SQL — AUTOMATE DE DÉTECTION AVEC POIDS
// ================================================================
class SqlGuard
{
    /**
     * Chaque entrée est un tableau [pattern, poids].
     * Le poids (1–10) reflète la dangerosité intrinsèque du motif.
     * Le cumul des poids déclenchés détermine la sévérité de l'alerte.
     *
     * Grille de sévérité :
     *   poids >= 8  → critique
     *   poids >= 5  → haute
     *   poids >= 3  → moyenne
     *   poids <  3  → faible
     */
    private static array $patterns = [

        // ── Exfiltration de données ──────────────────────────────── poids 8–10
        ['/\bUNION\s+(ALL\s+)?SELECT\b/i',                              9],
        ['/\bINTO\s+(OUTFILE|DUMPFILE)\b/i',                           10],
        ['/\bLOAD_FILE\s*\(/i',                                        10],
        ['/\bINFORMATION_SCHEMA\b/i',                                   8],

        // ── Destruction / modification de données ────────────────── poids 9–10
        ['/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i',                      10],
        ['/\bTRUNCATE\s+TABLE\b/i',                                     9],
        ['/;\s*(DROP|DELETE|UPDATE|INSERT|ALTER)\b/i',                  9],

        // ── Exécution de code / procédures stockées ──────────────── poids 8–9
        ['/\bEXEC(\s|\()/i',                                            8],
        ['/\bEXECUTE\s+(IMMEDIATE|SP_)\b/i',                            9],

        // ── Injections temporelles — Blind SQLi ─────────────────── poids 7–8
        ['/\bSLEEP\s*\(\s*\d+\s*\)/i',                                 8],
        ['/\bBENCHMARK\s*\(\s*\d+/i',                                  8],
        ['/\bWAITFOR\s+DELAY\b/i',                                      8],

        // ── Contournement d'authentification ────────────────────── poids 6–7
        ["/'\s*OR\s+'?\d+'?\s*=\s*'?\d+/i",                            7],
        ["/'\s*OR\s+'[^']*'\s*=\s*'[^']*/i",                           7],
        ['/\bOR\s+1\s*=\s*1\b/i',                                       6],

        // ── Encodage / obfuscation ───────────────────────────────── poids 5–6
        ['/0x[0-9a-fA-F]{4,}/i',                                        6],
        ['/\bCAST\s*\(.*\bAS\s+\w+\s*\)/i',                            5],
        ['/\bCONVERT\s*\(.*USING\b/i',                                  5],
        ['/\b(CHAR|NCHAR|VARCHAR|NVARCHAR)\s*\(\s*\d+\s*\)\s*\+/i',    5],

        // ── Commentaires SQL — masquage de payload ───────────────── poids 3–4
        ['/\/\*.*?\*\//s',                                              4],
        ['/--\s/',                                                      3],
        ['/#\s/',                                                       3],
    ];

    // ----------------------------------------------------------------
    //  Analyse complète : retourne détection, poids cumulé et motifs
    // ----------------------------------------------------------------

    /**
     * Parcourt tous les patterns et cumule les poids des motifs qui matchent.
     *
     * @return array{detected: bool, poids: int, motifs: list<array{pattern: string, poids: int}>}
     */
    public static function analyze(string $input): array
    {
        $totalWeight = 0;
        $matched     = [];

        foreach (self::$patterns as [$pattern, $weight]) {
            if (preg_match($pattern, $input)) {
                $totalWeight += $weight;
                $matched[]    = ['pattern' => $pattern, 'poids' => $weight];
            }
        }

        return [
            'detected' => $totalWeight > 0,
            'poids'    => $totalWeight,
            'motifs'   => $matched,
        ];
    }

    // ----------------------------------------------------------------
    //  Conversion poids → sévérité
    // ----------------------------------------------------------------

    /**
     * Traduit un score de poids cumulé en niveau de sévérité métier.
     *
     * | Poids    | Sévérité |
     * |----------|----------|
     * | >= 8     | critique |
     * | >= 5     | haute    |
     * | >= 3     | moyenne  |
     * | <  3     | faible   |
     */
    public static function severite(int $poids): string
    {
        return match (true) {
            $poids >= 8 => 'critique',
            $poids >= 5 => 'haute',
            $poids >= 3 => 'moyenne',
            default     => 'faible',
        };
    }

    // ----------------------------------------------------------------
    //  API publique
    // ----------------------------------------------------------------

    /**
     * Retourne true si une injection SQL est détectée.
     * (Conservé pour rétrocompatibilité avec les appels existants.)
     */
    public static function detect(string $input): bool
    {
        return self::analyze($input)['detected'];
    }

    /**
     * Valide un tableau de champs.
     * Si une attaque est détectée :
     *   1. Calcule le poids cumulé des motifs déclenchés.
     *   2. Dérive la sévérité (faible / moyenne / haute / critique).
     *   3. Écrit un log de sécurité horodaté.
     *   4. Insère une alerte en base avec la sévérité dynamique.
     *   5. Interrompt la requête avec HTTP 422.
     */
    public static function validateAll(array $fields): void
    {
        foreach ($fields as $name => $value) {
            if (!is_string($value)) continue;

            $result = self::analyze($value);
            if (!$result['detected']) continue;

            $severite     = self::severite($result['poids']);
            $nbMotifs     = count($result['motifs']);
            $payloadCourt = substr($value, 0, 100);
            $payloadLong  = substr($value, 0, 200);

            // — Log structuré —
            LogService::write('BLOCK', sprintf(
                'SQL injection · champ="%s" · poids=%d · sévérité=%s · motifs=%d · payload="%s" · IP=%s',
                $name,
                $result['poids'],
                $severite,
                $nbMotifs,
                $payloadCourt,
                getIP()
            ));

            // — Alerte en base avec sévérité calculée dynamiquement —
            LogService::creerAlerte(
                type:        'sql_injection',
                titre:       "Injection SQL détectée — champ « {$name} »",
                description: sprintf(
                    'Payload : "%s" | Poids cumulé : %d | Motifs déclenchés : %d | Sévérité calculée : %s',
                    $payloadLong,
                    $result['poids'],
                    $nbMotifs,
                    $severite
                ),
                severite: $severite
            );

            jsonError('Saisie invalide détectée. Requête bloquée.', 422);
        }
    }

    /**
     * Valider un seul champ (raccourci).
     */
    public static function validateField(string $name, string $value): void
    {
        self::validateAll([$name => $value]);
    }
}


// ================================================================
//  2. PROTECTION XSS — SANITISATION
// ================================================================
class XssGuard
{
    /**
     * Nettoie une chaîne contre les attaques XSS.
     */
    public static function clean(string $input): string
    {
        // Étape 1 : Supprimer les balises dangereuses
        $input = strip_tags($input, '<b><i><u><br><p>');

        // Étape 2 : Convertir les caractères spéciaux HTML
        $input = htmlspecialchars($input, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        // Étape 3 : Supprimer les protocoles dangereux
        $input = preg_replace('/javascript\s*:/i', '', $input);
        $input = preg_replace('/vbscript\s*:/i',   '', $input);
        $input = preg_replace('/on\w+\s*=/i',      '', $input);  // onclick=, onerror=…
        $input = preg_replace('/data\s*:/i',        '', $input);

        return trim($input);
    }

    /**
     * Nettoyer un tableau de champs.
     */
    public static function cleanAll(array $data): array
    {
        $cleaned = [];
        foreach ($data as $key => $value) {
            $cleaned[$key] = is_string($value) ? self::clean($value) : $value;
        }
        return $cleaned;
    }

    /**
     * Détecter sans nettoyer (pour les logs).
     */
    public static function detect(string $input): bool
    {
        $patterns = [
            '/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/i',
            '/<iframe\b/i',
            '/on\w+\s*=/i',
            '/javascript\s*:/i',
            '/vbscript\s*:/i',
            '/<img[^>]+src\s*=\s*["\']?\s*x["\']?\s+onerror/i',
        ];
        foreach ($patterns as $p) {
            if (preg_match($p, $input)) return true;
        }
        return false;
    }
}


// ================================================================
//  3. JWT — GÉNÉRATION ET VALIDATION (HS256)
// ================================================================
class JwtService
{
    /**
     * Générer un JWT HS256.
     */
    public static function generate(array $payload): string
    {
        $header = self::b64e(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));

        $defaultClaims = [
            'iss' => 'directcash.cm',
            'iat' => time(),
            'exp' => time() + JWT_EXPIRY,
            'jti' => bin2hex(random_bytes(8)),
        ];

        $fullPayload = self::b64e(json_encode($defaultClaims + $payload));
        $signature   = self::b64e(hash_hmac('sha256', "{$header}.{$fullPayload}", JWT_SECRET, true));

        return "{$header}.{$fullPayload}.{$signature}";
    }

    /**
     * Valider et décoder un JWT.
     * Retourne le payload ou lève une exception HTTP 401.
     */
    public static function validate(string $token): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            jsonError('Token invalide.', 401);
        }
        [$header, $payload, $sig] = $parts;

        // Vérifier la signature (hash_equals contre timing attacks)
        $expectedSig = self::b64e(
            hash_hmac('sha256', "{$header}.{$payload}", JWT_SECRET, true)
        );
        if (!hash_equals($expectedSig, $sig)) {
            jsonError('Signature JWT invalide.', 401);
        }

        $data = json_decode(self::b64d($payload), true);
        if (!$data) jsonError('Payload JWT corrompu.', 401);

        // Vérifier l'expiration
        if (($data['exp'] ?? 0) < time()) {
            jsonError('Session expirée. Reconnectez-vous.', 401);
        }

        // Vérifier la blacklist (tokens révoqués)
        if (self::isBlacklisted($data['jti'] ?? '')) {
            jsonError('Token révoqué.', 401);
        }

        return $data;
    }

    /**
     * Extraire + valider le JWT depuis l'en-tête Authorization.
     */
    public static function requireAuth(): array
    {
        $token = getBearerToken();
        if (!$token) {
            jsonError('Authentification requise.', 401);
        }
        return self::validate($token);
    }

    /**
     * Révoquer un JWT (logout, changement de mot de passe…).
     */
    public static function revoke(string $jti): void
    {
        $pdo  = getPDO();
        $stmt = $pdo->prepare(
            'INSERT IGNORE INTO jwt_blacklist (jti, expire_at) VALUES (:jti, FROM_UNIXTIME(:exp))'
        );
        $stmt->execute([':jti' => $jti, ':exp' => time() + JWT_EXPIRY]);
    }

    // ----------------------------------------------------------------
    //  Méthodes privées
    // ----------------------------------------------------------------

    private static function isBlacklisted(string $jti): bool
    {
        if (!$jti) return false;
        $pdo  = getPDO();
        $stmt = $pdo->prepare(
            'SELECT id FROM jwt_blacklist WHERE jti = :jti AND expire_at > NOW()'
        );
        $stmt->execute([':jti' => $jti]);
        return (bool) $stmt->fetch();
    }

    private static function b64e(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function b64d(string $data): string
    {
        return base64_decode(strtr($data, '-_', '+/'));
    }
}


// ================================================================
//  4. SERVICE DE LOGS DE SÉCURITÉ
// ================================================================
class LogService
{
    /**
     * Écrire un événement de sécurité en base + fichier de secours.
     */
    public static function write(
        string  $type,
        string  $message,
        ?string $compte = null,
        ?string $ip     = null
    ): void {
        $ip      = $ip     ?? getIP();
        $compte  = $compte ?? '';
        $created = date('Y-m-d H:i:s');

        // Signature HMAC pour intégrité du log
        $hash = hash_hmac('sha256', "{$type}|{$message}|{$ip}|{$created}", LOG_SECRET);

        try {
            $pdo  = getPDO();
            $stmt = $pdo->prepare(
                'INSERT INTO security_logs (type, message, ip, compte, hash_integrite, created_at)
                 VALUES (:type, :msg, :ip, :compte, :hash, :ts)'
            );
            $stmt->execute([
                ':type'   => $type,
                ':msg'    => $message,
                ':ip'     => $ip,
                ':compte' => $compte,
                ':hash'   => $hash,
                ':ts'     => $created,
            ]);
        } catch (PDOException) {
            // Fallback fichier si la base est indisponible
            $line = json_encode(compact('type', 'message', 'ip', 'compte', 'hash', 'created'));
            @file_put_contents(
                __DIR__ . '/logs/security.log',
                $line . PHP_EOL,
                FILE_APPEND | LOCK_EX
            );
        }
    }

    /**
     * Créer une alerte de sécurité en base.
     * La sévérité est désormais calculée dynamiquement par SqlGuard::severite()
     * et transmise ici — elle n'est plus codée en dur.
     *
     * @param string $type        Catégorie technique  (ex: "sql_injection", "xss", "brute_force")
     * @param string $titre       Titre lisible de l'alerte
     * @param string $description Description détaillée (payload, contexte…)
     * @param string $severite    Niveau calculé : "faible" | "moyenne" | "haute" | "critique"
     * @param string|null $ip     IP source (auto-détectée si null)
     */
    public static function creerAlerte(
        string  $type,
        string  $titre,
        string  $description,
        string  $severite = 'faible',   // ← plus de 'haute' en dur
        ?string $ip       = null
    ): void {
        $pdo  = getPDO();
        $stmt = $pdo->prepare(
            'INSERT INTO alertes_securite (type, titre, description, severite, ip, statut)
             VALUES (:type, :titre, :desc, :sev, :ip, "active")'
        );
        $stmt->execute([
            ':type'  => $type,
            ':titre' => $titre,
            ':desc'  => $description,
            ':sev'   => $severite,
            ':ip'    => $ip ?? getIP(),
        ]);
    }
}


// ================================================================
//  5. RATE LIMITER
// ================================================================
class RateLimiter
{
    /**
     * Vérifier si une IP/compte a dépassé sa limite de tentatives.
     *
     * @param string $key     Identifiant unique (IP, compte…)
     * @param int    $max     Nombre max de tentatives
     * @param int    $window  Fenêtre temporelle en secondes
     */
    public static function check(string $key, int $max, int $window): void
    {
        $pdo = getPDO();

        // Nettoyer les anciennes entrées expirées
        $pdo->prepare('DELETE FROM rate_limit WHERE expire_at < NOW()')->execute();

        $stmt = $pdo->prepare(
            'SELECT tentatives FROM rate_limit WHERE cle = :key AND expire_at > NOW()'
        );
        $stmt->execute([':key' => $key]);
        $row = $stmt->fetch();

        if ($row && (int)$row['tentatives'] >= $max) {
            LogService::write('BLOCK', "Rate limit dépassé · clé={$key}");
            jsonError("Trop de tentatives. Réessayez dans {$window} secondes.", 429);
        }
    }

    /**
     * Incrémenter le compteur de tentatives.
     */
    public static function increment(string $key, int $window): void
    {
        $pdo  = getPDO();
        $stmt = $pdo->prepare(
            'INSERT INTO rate_limit (cle, tentatives, expire_at)
             VALUES (:key, 1, DATE_ADD(NOW(), INTERVAL :w SECOND))
             ON DUPLICATE KEY UPDATE tentatives = tentatives + 1'
        );
        $stmt->execute([':key' => $key, ':w' => $window]);
    }

    /**
     * Réinitialiser le compteur (après succès d'authentification).
     */
    public static function reset(string $key): void
    {
        $pdo = getPDO();
        $pdo->prepare('DELETE FROM rate_limit WHERE cle = :key')->execute([':key' => $key]);
    }
}