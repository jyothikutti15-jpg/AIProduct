const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "..", "data.db");
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    company TEXT DEFAULT '',
    plan TEXT DEFAULT 'free',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    analyses_used INTEGER DEFAULT 0,
    analyses_reset_at TEXT DEFAULT (datetime('now')),
    oauth_provider TEXT DEFAULT '',
    oauth_id TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    email_notifications INTEGER DEFAULT 1,
    email_deadline_alerts INTEGER DEFAULT 1,
    email_weekly_digest INTEGER DEFAULT 1,
    onboarding_completed INTEGER DEFAULT 0,
    totp_secret TEXT DEFAULT '',
    totp_enabled INTEGER DEFAULT 0,
    backup_codes TEXT DEFAULT '',
    team_id INTEGER,
    team_role TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    saml_id TEXT DEFAULT '',
    saml_provider TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    analysis_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    document_type TEXT,
    risk_score INTEGER,
    risk_label TEXT,
    folder_id INTEGER,
    tags TEXT DEFAULT '',
    version_group TEXT DEFAULT '',
    version_number INTEGER DEFAULT 1,
    team_id INTEGER,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#4f46e5',
    team_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS shared_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    analysis_id TEXT NOT NULL,
    data TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    analysis_id TEXT NOT NULL,
    clause_index INTEGER DEFAULT -1,
    note TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS contract_deadlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    analysis_id TEXT,
    title TEXT NOT NULL,
    deadline_date TEXT NOT NULL,
    contract_name TEXT DEFAULT '',
    alert_days INTEGER DEFAULT 30,
    is_auto_renewal INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    email_type TEXT NOT NULL,
    subject TEXT NOT NULL,
    sent_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    plan TEXT DEFAULT 'free',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS team_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    invite_code TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    key_prefix TEXT NOT NULL,
    name TEXT DEFAULT 'Default',
    last_used_at TEXT,
    requests_today INTEGER DEFAULT 0,
    requests_reset_at TEXT DEFAULT (date('now')),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    events TEXT NOT NULL,
    secret TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    last_triggered_at TEXT,
    failure_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS custom_clauses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    team_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS obligations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    analysis_id TEXT NOT NULL,
    party TEXT NOT NULL,
    obligation TEXT NOT NULL,
    due_date TEXT DEFAULT '',
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending',
    clause_reference TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER,
    user_id INTEGER NOT NULL,
    user_name TEXT DEFAULT '',
    action TEXT NOT NULL,
    resource_type TEXT DEFAULT '',
    resource_id TEXT DEFAULT '',
    details TEXT DEFAULT '',
    ip_address TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS approval_workflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    team_id INTEGER,
    analysis_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'pending_review',
    current_step INTEGER DEFAULT 1,
    total_steps INTEGER DEFAULT 1,
    reviewers TEXT DEFAULT '[]',
    comments TEXT DEFAULT '[]',
    submitted_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS risk_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    team_id INTEGER,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    field TEXT NOT NULL,
    operator TEXT NOT NULL,
    value TEXT NOT NULL,
    severity TEXT DEFAULT 'warning',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    team_id INTEGER,
    type TEXT NOT NULL,
    name TEXT DEFAULT '',
    config TEXT DEFAULT '{}',
    is_active INTEGER DEFAULT 1,
    last_used_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS white_label (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL UNIQUE,
    company_name TEXT DEFAULT '',
    logo_url TEXT DEFAULT '',
    primary_color TEXT DEFAULT '#4f46e5',
    accent_color TEXT DEFAULT '#7c3aed',
    custom_domain TEXT DEFAULT '',
    footer_text TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS esign_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    analysis_id TEXT DEFAULT '',
    provider TEXT NOT NULL,
    envelope_id TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    signers TEXT DEFAULT '[]',
    document_name TEXT DEFAULT '',
    sent_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id);
  CREATE INDEX IF NOT EXISTS idx_analyses_folder ON analyses(folder_id);
  CREATE INDEX IF NOT EXISTS idx_analyses_version ON analyses(version_group);
  CREATE INDEX IF NOT EXISTS idx_analyses_team ON analyses(team_id);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);
  CREATE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_id);
  CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);
  CREATE INDEX IF NOT EXISTS idx_shared ON shared_analyses(share_id);
  CREATE INDEX IF NOT EXISTS idx_annotations ON annotations(user_id, analysis_id);
  CREATE INDEX IF NOT EXISTS idx_deadlines ON contract_deadlines(user_id);
  CREATE INDEX IF NOT EXISTS idx_folders ON folders(user_id);
  CREATE INDEX IF NOT EXISTS idx_api_keys ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
  CREATE INDEX IF NOT EXISTS idx_webhooks ON webhooks(user_id);
  CREATE INDEX IF NOT EXISTS idx_custom_clauses ON custom_clauses(user_id);
  CREATE INDEX IF NOT EXISTS idx_team_invites ON team_invites(invite_code);
  CREATE INDEX IF NOT EXISTS idx_obligations ON obligations(user_id, analysis_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log ON audit_log(team_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_approvals ON approval_workflows(user_id);
  CREATE INDEX IF NOT EXISTS idx_approvals_team ON approval_workflows(team_id);
  CREATE INDEX IF NOT EXISTS idx_risk_rules ON risk_rules(user_id);
  CREATE INDEX IF NOT EXISTS idx_integrations ON integrations(user_id);
  CREATE INDEX IF NOT EXISTS idx_white_label ON white_label(team_id);
  CREATE INDEX IF NOT EXISTS idx_esign ON esign_requests(user_id);
`);

module.exports = db;
