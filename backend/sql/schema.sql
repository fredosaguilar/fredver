CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, display_name text NOT NULL DEFAULT '', role text NOT NULL DEFAULT 'agent' CHECK (role IN ('admin','agent')), active boolean NOT NULL DEFAULT true);
CREATE TABLE inboxes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, name text NOT NULL);
CREATE TABLE inbox_members (inbox_id uuid REFERENCES inboxes(id), user_id uuid REFERENCES users(id), PRIMARY KEY(inbox_id,user_id));
CREATE TABLE threads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inbox_id uuid NOT NULL REFERENCES inboxes(id), gmail_thread_id text NOT NULL, subject text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','pending','closed')), assignee_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(inbox_id,gmail_thread_id));
CREATE TABLE notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL REFERENCES threads(id), author_id uuid NOT NULL REFERENCES users(id), body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_events (id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id), thread_id uuid REFERENCES threads(id), action text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE automation_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inbox_id uuid NOT NULL REFERENCES inboxes(id), name text NOT NULL, match_subject text NOT NULL, action_status text CHECK(action_status IN ('open','pending','closed')), assignee_id uuid REFERENCES users(id), enabled boolean NOT NULL DEFAULT true);
CREATE INDEX ON threads(inbox_id,status,updated_at DESC);
CREATE INDEX ON notes(thread_id,created_at);

CREATE TABLE IF NOT EXISTS rule_applied(thread_id uuid REFERENCES threads(id) ON DELETE CASCADE,rule_id uuid REFERENCES automation_rules(id) ON DELETE CASCADE,PRIMARY KEY(thread_id,rule_id));
