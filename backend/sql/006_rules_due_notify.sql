-- Auto-assign rules (subject and/or sender match; assign, status, tag), due-date notifications.
ALTER TABLE automation_rules ALTER COLUMN match_subject SET DEFAULT '';
ALTER TABLE automation_rules
  ADD COLUMN IF NOT EXISTS match_from text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tag_id uuid REFERENCES tags(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE threads ADD COLUMN IF NOT EXISTS due_notified_at timestamptz;
UPDATE threads SET due_notified_at=now() WHERE due_at IS NOT NULL AND due_at<now();
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('assigned','mention','reply','draft','scheduled_failed','due'));
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO cbimail_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO cbimail_app;
