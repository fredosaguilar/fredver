-- Fredver 1.0: notifications, templates, read state, tags, shared drafts, SLA, reports.
ALTER TABLE threads
  ADD COLUMN IF NOT EXISTS first_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_client_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS awaiting_reply boolean NOT NULL DEFAULT false;
ALTER TABLE inboxes ADD COLUMN IF NOT EXISTS sla_hours int NOT NULL DEFAULT 4;
CREATE TABLE IF NOT EXISTS notifications(
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  thread_id uuid REFERENCES threads(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('assigned','mention','reply','draft')),
  actor_id uuid REFERENCES users(id),
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS templates(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_id uuid NOT NULL REFERENCES inboxes(id),
  name text NOT NULL,
  body_html text NOT NULL,
  created_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS thread_reads(
  user_id uuid NOT NULL REFERENCES users(id),
  thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,thread_id));
CREATE TABLE IF NOT EXISTS tags(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_id uuid NOT NULL REFERENCES inboxes(id),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#5f6368',
  UNIQUE(inbox_id,name));
CREATE TABLE IF NOT EXISTS thread_tags(
  thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(thread_id,tag_id));
CREATE TABLE IF NOT EXISTS drafts(
  thread_id uuid PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  mode text NOT NULL DEFAULT 'reply',
  from_addr text NOT NULL DEFAULT 'shared',
  to_addrs text NOT NULL DEFAULT '',
  cc_addrs text NOT NULL DEFAULT '',
  bcc_addrs text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS threads_awaiting ON threads(inbox_id,awaiting_reply,status);
CREATE INDEX IF NOT EXISTS threads_first_msg ON threads(inbox_id,first_message_at);
CREATE INDEX IF NOT EXISTS audit_events_action ON audit_events(action,created_at);
INSERT INTO tags(inbox_id,name,color) SELECT id,'Urgent','#d93025' FROM inboxes ON CONFLICT DO NOTHING;
-- Refetch open conversations from Gmail once so the new SLA/report columns are filled in.
UPDATE threads SET gmail_history_id=NULL WHERE status<>'closed' OR last_message_at>now()-interval '45 days';
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO cbimail_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO cbimail_app;
-- Unread starts fresh at launch: older mail counts as read for everyone.
ALTER TABLE users ADD COLUMN IF NOT EXISTS read_baseline timestamptz NOT NULL DEFAULT now();
