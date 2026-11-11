-- Deleted conversations (moved to Gmail Trash; hidden in Fredver; restorable).
ALTER TABLE threads ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS threads_deleted ON threads(inbox_id,deleted_at) WHERE deleted_at IS NOT NULL;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO cbimail_app;
