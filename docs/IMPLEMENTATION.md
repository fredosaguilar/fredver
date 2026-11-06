# CBI Mail — Implementation and security plan

## Current scope
This is an **early MVP starter scaffold**, not a production-ready Hiver replacement. The API provides database-backed inbox membership, thread listing, assignment/status updates, internal notes, and status analytics. The extension currently displays a nonfunctional Gmail overlay. No live Gmail sync, working Google login, encryption, automation execution, secure portal, or reply sending is implemented.

## Local setup
1. Create a PostgreSQL database and run `psql "$DATABASE_URL" -f backend/sql/schema.sql`.
2. Create inboxes, users, and inbox_members using administrator-controlled provisioning (never allow self-registration).
3. Copy `backend/.env.example` to `backend/.env` and supply your own values. Run `npm install` in backend.
4. Export env variables (e.g. `set -a; source .env; set +a`) and run `npm run dev`.
5. In Chrome extensions developer mode, load the `extension` folder as unpacked. The overlay is a visual shell only.

## Required before real-world use
- Implement Chrome extension OAuth authorization code with PKCE, verify ID token audience/issuer, add short sessions and CSRF controls. Do not confuse Google access tokens with ID tokens.
- Configure Google Workspace domain and Workspace administrator consent; use the minimum Gmail scopes. Confirm verification/security assessment requirements.
- Implement mailbox sync using Gmail API watch/history, Google Pub/Sub, deduplication, watch renewal, reconciliation, and least-privilege delegated mailbox access. Never rely on scraping Gmail DOM for durable thread identity.
- Implement message sending via Gmail API, shared-mailbox authorization, idempotency and delivery failure handling.
- Build encrypted portal: per-message envelope encryption using AES-256-GCM, KMS wrapping, key rotation, authenticated recipients, independent MFA for sensitive content, short-lived access sessions, rate limits, malware scanning, audit events, and retention/revocation policies. Never send message plaintext in notification emails.
- Implement automations with deterministic rule evaluation, event queue, retries, idempotency, loop prevention, and auditable rule changes.
- Implement realtime assignment collision controls, internal note visibility tests, and proper tenant boundaries.
- Add authorization tests (cross-inbox access, assignment checks, disabled users), rate limiting, structured logging with redaction, CSP, vulnerability scans, backup/restore, penetration test, incident response and legal/compliance review.
- Do not put OAuth secrets, KMS credentials, or encryption keys in the extension. Use managed secrets and HTTPS in production.

## API endpoints in scaffold
GET /health
GET /api/me
GET /api/inboxes
GET /api/threads?inboxId=<uuid>&status=open
PATCH /api/threads/:id {"status":"pending","assigneeId":"<uuid>"}
GET /api/threads/:id/notes
POST /api/threads/:id/notes {"body":"Internal note"}
GET /api/analytics/summary

## Architecture recommendation
Use Chrome MV3 extension + Node/TypeScript API + PostgreSQL + Gmail API + Pub/Sub + Cloud Run + Cloud KMS + encrypted object storage. Use an independently authenticated Next.js client portal. Maintain audit records and retention rules separate from Gmail.

## Compliance status
No compliance certification or security assurance is asserted. Insurance privacy, Washington/Oregon laws, GLBA applicability, contracts, and security controls must be reviewed before handling real customer data.
