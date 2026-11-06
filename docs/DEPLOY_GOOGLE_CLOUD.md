# CBI Mail v0.2 — Google Cloud deployment (pilot only)

This is a **pilot**, not an audited insurance-compliant production deployment. It does not yet implement encrypted client messaging, robust incremental Gmail synchronization, or automatic unattended sync. Do not process real confidential client data until a security review and the remaining controls are complete.

## Prerequisites
- Google Workspace super administrator and a Google Cloud project with billing.
- Google Cloud CLI, PostgreSQL client, Node 22, and Chrome.
- An isolated Google Workspace test mailbox and test employee accounts. Do not start with the live info@ mailbox.

## 1. Enable APIs
```
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com gmail.googleapis.com iam.googleapis.com
```

## 2. Cloud SQL
Create a private PostgreSQL 16 Cloud SQL instance, database `cbimail`, and a least-privilege DB user. Prefer Cloud SQL IAM/database authentication or Secret Manager for the connection string. Configure Cloud Run connectivity to Cloud SQL (Unix socket or private networking); `DATABASE_URL` must be compatible with the chosen connection. Run `backend/sql/schema.sql` using `psql` over an authorized administrative connection. For a pilot, provision users and inbox memberships explicitly:
```
INSERT INTO inboxes(email,name) VALUES('test-inbox@YOUR_DOMAIN','CBI Test Inbox');
INSERT INTO users(email,display_name,role) VALUES('employee@YOUR_DOMAIN','Test Employee','admin');
INSERT INTO inbox_members(inbox_id,user_id)
 SELECT i.id,u.id FROM inboxes i CROSS JOIN users u WHERE i.email='test-inbox@YOUR_DOMAIN' AND u.email='employee@YOUR_DOMAIN';
```

## 3. Gmail delegated access
Create a dedicated Google Cloud service account for read-only Gmail synchronization. **Disable key creation if possible** and replace the JSON-key approach in `src/sync.ts` with a keyless delegated-token broker for production. The current pilot requires a JSON key supplied via Secret Manager; keep it out of Git and local browser storage. In Workspace Admin Console > Security > Access and data control > API controls > Domain-wide delegation, authorize the service account OAuth client ID for only `https://www.googleapis.com/auth/gmail.readonly`. This grant is domain-wide; backend code must always impersonate only the configured test mailbox. Domain-wide delegation can be abused if the service account is compromised. Restrict service-account access and rotate/remove the key after the pilot.

## 4. Google OAuth for extension
Create an OAuth **Web application** client for the extension's `chrome.identity.launchWebAuthFlow`. Once the unpacked extension is loaded, obtain its extension ID, and add this exact redirect URI to the OAuth client:
`https://EXTENSION_ID.chromiumapp.org/oauth`
Add your Workspace domain to the OAuth app's allowed/test users as appropriate. Set `extension/config.js` clientId and API URL. Set the backend `GOOGLE_OAUTH_CLIENT_ID` to the same OAuth client ID. The backend verifies the ID-token signature, audience, email verification, hosted domain, and a provisioned employee account. The extension currently uses an OIDC implicit ID-token flow with in-memory tokens; replace it with authorization-code + PKCE and session renewal before general rollout.

## 5. Deploy backend
From `backend/`, build and deploy a container to Cloud Run, restricting invocation to authenticated/authorized application traffic at the application layer and configuring HTTPS. Example build commands:
```
gcloud artifacts repositories create cbi-mail --repository-format=docker --location=us-west1
PROJECT_ID=$(gcloud config get-value project)
gcloud builds submit --tag us-west1-docker.pkg.dev/$PROJECT_ID/cbi-mail/api:pilot .
gcloud run deploy cbi-mail-api --image us-west1-docker.pkg.dev/$PROJECT_ID/cbi-mail/api:pilot --region us-west1 --no-allow-unauthenticated
```
**Important:** `--no-allow-unauthenticated` requires Google Cloud IAM invocation credentials that the browser extension does not currently supply. For an extension pilot, put an authenticated API gateway / identity-aware proxy in front of Cloud Run, or explicitly enable public Cloud Run invocation **only after** reviewing perimeter controls, rate limits, CORS, logging and application auth. Do not simply flip the flag on a live service. Supply `DATABASE_URL`, `GOOGLE_OAUTH_CLIENT_ID`, `ALLOWED_DOMAIN`, `SHARED_MAILBOX`, and `ALLOWED_ORIGIN` using service configuration and Secret Manager. Store `GMAIL_SERVICE_ACCOUNT_JSON` in Secret Manager and bind only to the backend service identity. Configure Cloud SQL connectivity. Ensure `ALLOWED_ORIGIN` matches `chrome-extension://EXTENSION_ID` (and other explicitly trusted origins).

## 6. Load extension
Chrome > Extensions > Developer mode > Load unpacked > select `extension/`. Note extension ID and update OAuth redirect, `extension/config.js`, and `extension/manifest.json` Cloud Run host permission. Reload extension. Sign in as a provisioned test employee. Use `POST /api/admin/sync` with the employee's verified Google ID token to import up to 500 recent test mailbox threads; this is a manual admin action. Then refresh CBI Mail to see threads and edit assignments, statuses, and notes.

## 7. Production blockers
- Replace 500-thread bounded scanning with Gmail `watch` + Pub/Sub + `history.list`, cursor persistence, retries and backfill.
- Replace JSON service-account key with keyless delegated credentials.
- Add browser-safe authenticated gateway and proper OIDC PKCE, token renewal, CSRF protections, and request rate limits.
- Add a secure client messaging portal, per-message AES-256-GCM encryption, KMS wrapping, attachment malware scanning, retention and deletion policies.
- Add durable automation processing, reporting definitions, monitoring, backups, independent security assessment, incident-response exercises, and least-privilege review.
- Ensure compliance with applicable insurance/privacy obligations and carrier contracts before handling live nonpublic personal information.
