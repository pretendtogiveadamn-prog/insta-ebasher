-- spec 04: accounts, leads, outreach_log, llm_cache, events
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  label TEXT,
  anty_profile_id TEXT UNIQUE,
  username TEXT,
  proxy_note TEXT,
  daily_cap INTEGER NOT NULL DEFAULT 25 CHECK (daily_cap > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  cooldown_until TEXT,
  cooldown_reason TEXT,
  last_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  artist TEXT,
  track TEXT,
  source TEXT CHECK (source IN ('artistconnect','manual','youtube') OR source IS NULL),
  beat_ref TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','researching','ready','sent','rejected','failed_exact',
                      'dm_restricted','needs_manual','llm_failed','pending')),
  relevance REAL CHECK (relevance IS NULL OR (relevance >= 0 AND relevance <= 1)),
  dm_worth INTEGER CHECK (dm_worth IN (0, 1) OR dm_worth IS NULL),
  tone TEXT,
  personal_hook TEXT,
  draft TEXT,
  llm_model TEXT,
  llm_ts TEXT,
  account_id TEXT REFERENCES accounts(id),
  sent_at TEXT,
  replied INTEGER NOT NULL DEFAULT 0 CHECK (replied IN (0, 1)),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_leads_handle ON leads(handle);
CREATE INDEX idx_leads_status ON leads(status);

CREATE TABLE outreach_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  outcome TEXT NOT NULL
    CHECK (outcome IN ('sent','confirm_miss','dm_restricted','action_block',
                       'no_result','recipient_error','login_required','dry_run','captcha')),
  dry_run INTEGER NOT NULL DEFAULT 0 CHECK (dry_run IN (0, 1)),
  step TEXT,
  evidence_dir TEXT,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_outreach_acc_time ON outreach_log(account_id, sent_at);
CREATE INDEX idx_outreach_lead ON outreach_log(lead_id);

CREATE TABLE fp_baseline (
  profile_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (profile_id, key)
);

CREATE TABLE llm_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE events (
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  level TEXT NOT NULL,
  scope TEXT,
  code TEXT,
  msg TEXT,
  data TEXT
);
