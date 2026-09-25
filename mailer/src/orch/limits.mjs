// limits.mjs — spec 04: дефолты лимитов (в перспективе config/limits.yaml),
// расчёт caps из outreach_log, cooldown-политика. Цифры калибруем телеметрией.
export const DEFAULT_LIMITS = {
  dm_per_day_account: 25,
  dm_interval: [180, 360], // сек (owner 2026-09-25: кд 3–6 мин рандом, на ленте)
  profile_views_between_dm: [1, 2],
  session_max_age_hours: 12,
  daily_ramp_cap_new: 10, // логин < 14д
  cooldown: { soft_h: 4, hard_h: 24, repeated_h: 72 },
  confirm_timeout_ms: 15000,
  captcha_timeout_min: 10,
};

// cooldown-мультипликатор по severity: soft(1st)/hard(2nd)/repeated(3rd+)
export function cooldownHours(count) {
  const c = DEFAULT_LIMITS.cooldown;
  if (count <= 1) return c.soft_h;
  if (count === 2) return c.hard_h;
  return c.repeated_h;
}

export function cooldownUntil(hours, now = new Date()) {
  return new Date(now.getTime() + hours * 3600 * 1000).toISOString();
}

// Сколько DM аккаунт уже отправил сегодня (UTC-день по моменту sent_at)
export function sentToday(db, accountId, now = new Date(), cap) {
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).toISOString();
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM outreach_log WHERE account_id = ? AND outcome = 'sent' AND sent_at >= ?"
    )
    .get(accountId, dayStart);
  return { sent: row.n, cap: cap ?? DEFAULT_LIMITS.dm_per_day_account, dayStart };
}

export function capReached(db, account, now = new Date()) {
  const { sent, cap } = sentToday(db, account.id, now, account.daily_cap);
  return { reached: sent >= cap, sent, cap };
}

// Next interval between DMs: base [min,max] + jitter ±30%
export function nextDelaySecs(rng = Math.random) {
  const [min, max] = DEFAULT_LIMITS.dm_interval;
  const base = min + rng() * (max - min);
  return base * (0.7 + rng() * 0.6);
}
