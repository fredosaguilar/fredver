-- Conversations added to the shared inbox from an employee's own mailbox.
ALTER TABLE threads ADD COLUMN IF NOT EXISTS source_mailbox text;
CREATE INDEX IF NOT EXISTS threads_source_mailbox ON threads(source_mailbox) WHERE source_mailbox IS NOT NULL;
