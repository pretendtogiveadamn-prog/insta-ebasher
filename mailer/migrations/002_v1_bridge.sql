-- v1-bridge: маппинг v2-аккаунта на аккаунт v1 (lease-протокол, ADR v2-over-v1)
ALTER TABLE accounts ADD COLUMN v1_account_id TEXT;
