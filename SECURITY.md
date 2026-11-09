# Fredver security overview (for an independent reviewer)

Fredver is an internal shared-inbox tool for Columbia Basin Insurance. It handles client email, which can
contain nonpublic personal information (NPI) under GLBA and Washington/Oregon insurance privacy rules.
This document summarizes the design and the controls in place, and lists what a reviewer should test.
**No independent review has been done yet.**

## Architecture
- **Chrome extension** (`extension/`): UI inside Gmail. Force-installed from Admin Console (store item
  `oaappehaeobmmmdjalpmfdpjeoifanii`, private to the domain).
- **Backend** (`backend/`): Node/Express on Cloud Run `cbi-mail-api` (project `cbi-mail-pilot`, us-west1).
  Public URL; every `/api` request is authenticated in the app (see below).
- **Database**: Cloud SQL Postgres 16 `cbi-mail-db`, reached only through the Cloud SQL connector; app user
  `cbimail_app` with DML-only grants; connection string in Secret Manager `cbi-mail-database-url`.
- **Gmail access**: domain-wide delegation to service account `cbi-mail-gmail` (client ID
  116406524663315383692), scopes `gmail.readonly` and `gmail.send`. **No service-account key exists**: the
  backend's identity signs JWTs through the IAM Credentials API (`signJwt`).
- **Sync**: Cloud Run job `cbi-mail-sync` every 5 minutes (Cloud Scheduler) plus optional Gmail push via
  Pub/Sub (push requests are verified as Google-signed OIDC tokens for `cbi-mail-pubsub`).

## Authentication and authorization
- Extension signs users in with Google (OIDC implicit flow, `nonce` + `state` checked, `hd` hint).
  ID tokens are kept in `chrome.storage.session` (memory only, not readable by content scripts).
- Backend verifies every ID token's signature and audience (`google-auth-library`), requires
  `email_verified`, `hd == columbiabasininsurance.com`, a matching email domain, and an **active,
  admin-provisioned** user row. Unknown employees get 403.
- Every conversation, attachment, note, tag, draft and template request checks inbox membership.
- Admin-only: team management, settings, tag deletion, manual sync. Admins can't remove their own admin role.
- "Send from my address" impersonates only the authenticated employee's own mailbox; the shared
  mailbox address is fixed by configuration.

## Input handling and content safety
- All request bodies validated with `zod`; JSON body limit 256 KB (30 MB on the two send routes).
- Outgoing email: header values stripped of CR/LF and RFC 2047-encoded; recipient addresses validated;
  formatted bodies and templates cleaned with `sanitize-html` (simple formatting tags only, http/https/
  mailto/tel links only).
- Incoming email HTML is rendered in a sandboxed iframe **without `allow-scripts`**, with a CSP allowing
  only https/data images and inline styles.
- Attachment downloads verify the message belongs to an authorized conversation; previews of PDFs are
  rendered with poppler `pdftoppm` (15 s timeout, 15 MB cap) inside the Cloud Run sandbox.
- Rate limits: 600 requests/min per IP before sign-in, 300/min per employee, 20 sends/min per employee.

## Data stored
Subjects, sender names/addresses, first 300 characters of the latest message, timestamps, assignments,
statuses, internal notes, tags, shared drafts, templates, notifications, read markers, activity history,
employee names/emails/roles. Full message bodies and attachments are fetched from Gmail on demand and not
stored. Logs contain request metadata and error messages, not message content.

## Known gaps / to review
1. **Public endpoint**: Cloud Run invoker IAM check is disabled (org policy blocks `allUsers`); protection
   is entirely in-app. Consider an external HTTPS load balancer with Cloud Armor or IAP.
2. **OIDC implicit flow**: move to authorization code + PKCE with a server-side token exchange and short
   server sessions.
3. **Domain-wide delegation** grants read/send on every mailbox in the domain to the service account;
   compromise of the backend identity is high impact. Review who has `iam.serviceAccountTokenCreator`
   on `cbi-mail-gmail` and owner access to the project.
4. **No encryption beyond Google defaults** (Cloud SQL encryption at rest; no CMEK).
5. **Retention**: no automatic deletion of notes/drafts/activity yet; define a retention policy.
6. **Backups**: Cloud SQL automated daily backups are on; restore has not been tested.
7. **Dependency updates**: no automated vulnerability scanning; run `npm audit` and patch regularly.
8. **Incident response**: alerts email the admin when sync stops or errors spike; no on-call process.

## Suggested tests for a reviewer
- Call `/api/*` with no token, an expired token, a token for another Google Workspace domain, a personal
  Gmail token, and a token for a deactivated employee.
- Try to read another inbox's conversation/attachment by ID (IDOR).
- Send formatted bodies/templates containing scripts, event handlers, `javascript:` links, and header
  injection attempts in subject/recipients.
- Open emails containing active content and confirm nothing executes.
- Exceed rate limits; upload oversized attachments.
