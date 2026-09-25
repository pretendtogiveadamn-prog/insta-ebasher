# 04 — State, лимиты, телеметрия

## SQLite schema (node:sqlite, `state/insta-ebasher-v2.db`)
```sql
accounts(
  id TEXT PRIMARY KEY,          -- id профиля Anty
  label TEXT, anty_profile_id TEXT UNIQUE,
  username TEXT,                -- @, из логина
  proxy_note TEXT,              -- человекочитаемо (прокси живёт в Anty-профиле)
  daily_cap INTEGER NOT NULL DEFAULT 25,
  enabled INTEGER NOT NULL DEFAULT 1,
  cooldown_until TEXT, cooldown_reason TEXT,
  last_sent_at TEXT, created_at TEXT
);

leads(
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,         -- exact, побуквенно
  artist TEXT, track TEXT,
  source TEXT,                  -- artistconnect / manual / youtube
  beat_ref TEXT,                -- наш бит (для compose)
  status TEXT NOT NULL,         -- new|researching|ready|sent|rejected|failed_exact
                                -- |dm_restricted|needs_manual|llm_failed
  relevance REAL, dm_worth INTEGER, tone TEXT,
  personal_hook TEXT, draft TEXT,
  llm_model TEXT, llm_ts TEXT,
  account_id TEXT,              -- кто шлёт
  sent_at TEXT, replied INTEGER DEFAULT 0,
  last_error TEXT, created_at TEXT, updated_at TEXT
);

outreach_log(                   -- источник правды (как 1.0)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL, lead_id TEXT NOT NULL,
  outcome TEXT NOT NULL,        -- sent|confirm_miss|dm_restricted|action_block
                                -- |no_result|recipient_error|login_required|dry_run
  dry_run INTEGER DEFAULT 0, step TEXT,
  evidence_dir TEXT, sent_at TEXT NOT NULL
);
CREATE INDEX idx_outreach_acc_time ON outreach_log(account_id, sent_at);
CREATE INDEX idx_outreach_lead ON outreach_log(lead_id);

llm_cache(key TEXT PRIMARY KEY, payload TEXT, model TEXT, created_at TEXT);
events(ts TEXT, level TEXT, scope TEXT, code TEXT, msg TEXT, data TEXT);  -- jsonl-зеркало
```

## Лимиты (дефолты, все в `config/limits.yaml`, перестраиваются по телеметрии)
- `dm_per_day_account: 25` (старт ниже форумного safe 50-70 — буфер; 1.0 шёл с 35 и 5–7 мин)
- `dm_interval: [300s, 420s]`
- `profile_views_between_dm: 1-2` (человеческий «прогулялся»)
- `session_max_age: 12h`
- `daily_ramp`: новый аккаунт (login <14д) — cap 10.
- Cooldowns: action_block soft 4h, hard 24h, repeated 72h; 2 ошибки подряд → manual_needed.

## Scheduler
- Один воркер на enabled-аккаунт, волны (wave size = аккаунтов), между DM — интервал + jitter ±30%.
- Плейн-цикл: take ready leads (FIFO, без повторения handle у другого lead — как 1.0 claimNextCase) → precheck → DM-flow → log.
- Время: сессии в «день» по часовому поясу аккаунта (Anty tz); ночи — пауза (опц. `active_window`).
- Stagger при старте: +0..90s на аккаунт.

## Teleметрия
- Каждый step/овер-переход → `events` + jsonl `state/logs/`.
- Ежесуточный свод: `ih stats` — sent/reply-rate/outcome-разбивка по аккаунтам, trend 7д.
- Правило: цифры лимитов меняем только по своему reply-rate/outcome, не по форумам.

## CLI
```
ih doctor                     панель/CDP/proxy/db/llm креды
ih selfcheck <profile>        7 пунктов fp
ih accounts [list|add|pause|cap]
ih leads [list|add <handle> --artist ... --track ...|status]
ih classify [--limit N]       только LLM-слой (IH_CLASSIFY_ONLY)
ih send [--lead-id|--account N|--dry-run]
ih run                        демоn: scheduler + waves
ih stats [--days 7]
ih evidence <lead-id>         путь к скринам
```
