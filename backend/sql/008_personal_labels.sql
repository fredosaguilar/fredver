-- Copies of shared conversations saved into an employee's own mailbox under one of their Gmail labels.
CREATE TABLE IF NOT EXISTS personal_copies(
  thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  gmail_thread_id text,
  copied_message_ids text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(thread_id,user_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO cbimail_app;
