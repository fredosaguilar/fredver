ALTER TABLE threads
  ADD COLUMN IF NOT EXISTS from_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS from_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS snippet text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS message_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gmail_history_id text;
CREATE INDEX IF NOT EXISTS threads_inbox_last_msg ON threads(inbox_id,last_message_at DESC);
CREATE TABLE IF NOT EXISTS presence(
  thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  activity text NOT NULL CHECK (activity IN ('viewing','replying')),
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(thread_id,user_id));
CREATE INDEX IF NOT EXISTS audit_events_thread ON audit_events(thread_id,created_at);
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO cbimail_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO cbimail_app;
