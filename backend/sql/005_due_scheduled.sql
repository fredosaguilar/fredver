-- Manual due dates and scheduled sends.
ALTER TABLE threads ADD COLUMN IF NOT EXISTS due_at timestamptz;
CREATE TABLE IF NOT EXISTS scheduled_sends(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_id uuid NOT NULL REFERENCES inboxes(id),
  thread_id uuid REFERENCES threads(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('reply','compose')),
  payload jsonb NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}',
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','canceled')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  result_thread_id uuid);
CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled_sends(status,send_at);
CREATE INDEX IF NOT EXISTS scheduled_thread ON scheduled_sends(thread_id);
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('assigned','mention','reply','draft','scheduled_failed'));
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO cbimail_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO cbimail_app;
