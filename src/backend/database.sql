-- ================================================================
-- directcash/backend/database.sql
-- Schéma complet de la base de données DirectCash
-- ================================================================

CREATE DATABASE IF NOT EXISTS directcash
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE directcash;

-- ── Utilisateurs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS utilisateurs (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    compte          VARCHAR(20)  NOT NULL UNIQUE,
    nom             VARCHAR(100) NOT NULL,
    prenom          VARCHAR(100) NOT NULL,
    email           VARCHAR(180) NOT NULL UNIQUE,
    telephone       VARCHAR(20)  NOT NULL UNIQUE,
    mdp_hash        VARCHAR(255) NOT NULL,
    pin_hash        VARCHAR(64)  DEFAULT NULL,
    role            ENUM('client','gestionnaire','admin') NOT NULL DEFAULT 'client',
    statut          ENUM('actif','suspendu','verrouille')  NOT NULL DEFAULT 'actif',
    twofa_active    TINYINT(1)   NOT NULL DEFAULT 1,
    last_login      DATETIME     DEFAULT NULL,
    created_at      DATETIME     NOT NULL,
    INDEX idx_compte  (compte),
    INDEX idx_email   (email),
    INDEX idx_statut  (statut)
) ENGINE=InnoDB;

-- ── Comptes bancaires ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comptes (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id             INT UNSIGNED NOT NULL,
    numero              VARCHAR(20)  NOT NULL UNIQUE,
    solde               DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    solde_bloque        DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    plafond_journalier  DECIMAL(15,2) NOT NULL DEFAULT 500000.00,
    plafond_mensuel     DECIMAL(15,2) NOT NULL DEFAULT 3000000.00,
    created_at          DATETIME     NOT NULL,
    FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
    INDEX idx_user    (user_id),
    INDEX idx_numero  (numero)
) ENGINE=InnoDB;

-- ── OTPs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otps (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED NOT NULL,
    code_hash   VARCHAR(64)  NOT NULL,
    utilise     TINYINT(1)   NOT NULL DEFAULT 0,
    utilise_a   DATETIME     DEFAULT NULL,
    expire_a    DATETIME     NOT NULL,
    created_at  DATETIME     NOT NULL,
    FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
    INDEX idx_user_utilise (user_id, utilise),
    INDEX idx_expire (expire_a)
) ENGINE=InnoDB;

-- ── Tentatives d'authentification ───────────────────────────────
CREATE TABLE IF NOT EXISTS tentatives_auth (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    compte              VARCHAR(20)  NOT NULL,
    ip                  VARCHAR(45)  NOT NULL,
    verouille_jusqu_a   DATETIME     DEFAULT NULL,
    created_at          DATETIME     NOT NULL,
    INDEX idx_compte    (compte),
    INDEX idx_verrou    (compte, verouille_jusqu_a)
) ENGINE=InnoDB;

-- ── Sessions temporaires (entre login et OTP) ────────────────────
CREATE TABLE IF NOT EXISTS sessions_temp (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token       VARCHAR(64)  NOT NULL UNIQUE,
    user_id     INT UNSIGNED NOT NULL,
    created_at  DATETIME     NOT NULL,
    FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Transactions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code             VARCHAR(30)   NOT NULL UNIQUE,
    type             ENUM('depot','envoi','retrait') NOT NULL,
    compte_source    VARCHAR(20)   NOT NULL,
    compte_dest      VARCHAR(20)   DEFAULT NULL,
    montant          DECIMAL(15,2) NOT NULL,
    frais            DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    motif            VARCHAR(255)  DEFAULT NULL,
    mode_retrait     VARCHAR(50)   DEFAULT NULL,
    reference_externe VARCHAR(100) DEFAULT NULL,
    statut           ENUM('valide','en_cours','echoue','annule') NOT NULL DEFAULT 'en_cours',
    idempotency_key  VARCHAR(100)  NOT NULL,
    created_at       DATETIME      NOT NULL,
    INDEX idx_source  (compte_source),
    INDEX idx_dest    (compte_dest),
    INDEX idx_statut  (statut),
    INDEX idx_date    (created_at),
    INDEX idx_idem    (idempotency_key)
) ENGINE=InnoDB;

-- ── Clés d'idempotence ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cle         VARCHAR(100)  NOT NULL,
    user_id     INT UNSIGNED  NOT NULL,
    result_json TEXT          NOT NULL,
    created_at  DATETIME      NOT NULL,
    UNIQUE KEY uk_cle_user (cle, user_id),
    FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Logs de sécurité ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logs_securite (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type        ENUM('AUTH','TXN','WARN','FAIL','BLOCK','XSS','JWT','INFO') NOT NULL,
    message     VARCHAR(500) NOT NULL,
    ip          VARCHAR(45)  DEFAULT NULL,
    compte      VARCHAR(20)  DEFAULT NULL,
    data        JSON         DEFAULT NULL,
    created_at  DATETIME     NOT NULL,
    INDEX idx_type  (type),
    INDEX idx_date  (created_at),
    INDEX idx_ip    (ip)
) ENGINE=InnoDB;

-- ── Alertes de sécurité ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alertes_securite (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    titre        VARCHAR(200) NOT NULL,
    description  TEXT         NOT NULL,
    severite     ENUM('critique','haute','moyenne','basse') NOT NULL DEFAULT 'haute',
    statut       ENUM('active','resolue','ignoree')          NOT NULL DEFAULT 'active',
    type         ENUM('sql_injection','xss','brute_force','autre') NOT NULL DEFAULT 'autre',
    ip           VARCHAR(45)  DEFAULT NULL,
    resolue_par  INT UNSIGNED DEFAULT NULL,
    resolue_a    DATETIME     DEFAULT NULL,
    created_at   DATETIME     NOT NULL,
    INDEX idx_statut (statut),
    INDEX idx_date   (created_at)
) ENGINE=InnoDB;

-- ── Notifications ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED NOT NULL,
    titre       VARCHAR(200) NOT NULL,
    corps       TEXT         NOT NULL,
    lu          TINYINT(1)   NOT NULL DEFAULT 0,
    type        ENUM('transaction','securite','systeme') NOT NULL DEFAULT 'transaction',
    created_at  DATETIME     NOT NULL,
    FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
    INDEX idx_user_lu (user_id, lu)
) ENGINE=InnoDB;

-- ================================================================
-- TRIGGERS
-- ================================================================

-- Génération automatique du numéro de référence après INSERT
DELIMITER $$

CREATE TRIGGER IF NOT EXISTS after_transaction_insert
AFTER INSERT ON transactions
FOR EACH ROW
BEGIN
    -- Créer une alerte si injection SQL détectée dans les logs
    IF NEW.statut = 'echoue' THEN
        INSERT INTO logs_securite (type, message, created_at)
        VALUES ('WARN', CONCAT('Transaction échouée : ', NEW.code), NOW());
    END IF;
END$$

-- Nettoyage automatique des OTPs expirés (EVENT ou via cron)
CREATE EVENT IF NOT EXISTS evt_nettoyer_otps
ON SCHEDULE EVERY 1 HOUR
DO
    DELETE FROM otps WHERE expire_a < NOW() AND utilise = 0;

CREATE EVENT IF NOT EXISTS evt_nettoyer_sessions_temp
ON SCHEDULE EVERY 1 HOUR
DO
    DELETE FROM sessions_temp WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR);

DELIMITER ;

-- ================================================================
-- DONNÉES DE DÉMONSTRATION
-- ================================================================

-- Utilisateur admin (mot de passe : DirectCash2024!)
-- Hash bcrypt cost 12
INSERT IGNORE INTO utilisateurs
    (compte, nom, prenom, email, telephone, mdp_hash, role, statut, twofa_active, created_at)
VALUES
    ('DC-237-0001', 'KAMGA', 'Jean-Pierre', 'jean.kamga@gmail.com',
     '+237677123456',
     '$2y$10$z2CyE6HcSrvfZoWrjCMNSO1mfFjJWbWqy8pr2V4BSQOsxl8vznhFy',
     'admin', 'actif', 1, NOW()),
    ('DC-237-0099', 'NKUISSI', 'Marie', 'm.nkuissi@gmail.com',
     '+237699456789',
     '$2y$10$z2CyE6HcSrvfZoWrjCMNSO1mfFjJWbWqy8pr2V4BSQOsxl8vznhFy',
     'client', 'actif', 1, NOW()),
    ('DC-237-0042', 'TAGNE', 'Paul', 'paul.tagne@yahoo.fr',
     '+237677789012',
     '$2y$10$z2CyE6HcSrvfZoWrjCMNSO1mfFjJWbWqy8pr2V4BSQOsxl8vznhFy',
     'client', 'verrouille', 0, NOW()),
    ('DC-237-0175', 'EKANE', 'Sophie', 's.ekane@directcash.cm',
     '+237690234567',
     '$2y$10$z2CyE6HcSrvfZoWrjCMNSO1mfFjJWbWqy8pr2V4BSQOsxl8vznhFy',
     'gestionnaire', 'actif', 1, NOW());

INSERT IGNORE INTO comptes (user_id, numero, solde, plafond_journalier, plafond_mensuel, created_at)
SELECT id, compte,
    CASE compte
        WHEN 'DC-237-0001' THEN 150000
        WHEN 'DC-237-0099' THEN 75500
        WHEN 'DC-237-0042' THEN 0
        WHEN 'DC-237-0175' THEN 320000
    END,
    500000, 3000000, NOW()
FROM utilisateurs WHERE compte IN ('DC-237-0001','DC-237-0099','DC-237-0042','DC-237-0175');
