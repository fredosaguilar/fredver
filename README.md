# Fredver: shared inbox for Gmail (Columbia Basin Insurance)

A Chrome extension (`extension/`) plus a backend (`backend/`) on Google Cloud project **cbi-mail-pilot** (region `us-west1`).
The backend reads and sends mail for **info@columbiabasininsurance.com**.

## What runs where

| Piece | Where | Name |
|---|---|---|
| Backend API | Cloud Run service | `cbi-mail-api` → https://cbi-mail-api-1040388630993.us-west1.run.app |
| Sync / watch renewal | Cloud Run job | `cbi-mail-sync` (Cloud Scheduler `cbi-mail-sync-every-5-min`) |
| Instant notifications | Pub/Sub | topic `cbi-mail-gmail`, push subscription `cbi-mail-gmail-push` → `/pubsub/gmail` |
| Database | Cloud SQL Postgres 16 | instance `cbi-mail-db`, database `cbimail`, user `cbimail_app` |
| DB password | Secret Manager | `cbi-mail-database-url` |
| Container images | Artifact Registry | `us-west1-docker.pkg.dev/cbi-mail-pilot/cbi-mail/api` |
| Identities | Service accounts | `cbi-mail-api` (backend), `cbi-mail-gmail` (Gmail delegation, keyless), `cbi-mail-build`, `cbi-mail-scheduler`, `cbi-mail-pubsub` |
| Sign-in client | Google Auth Platform | "CBI Mail Extension", redirect `https://bjfbogaphibnglkajlalhajhlbeflpdf.chromiumapp.org/oauth` |
| Gmail permission | Admin Console → Domain-wide delegation | client ID `116406524663315383692`, scopes `gmail.readonly`, `gmail.send` |

The extension ID (`bjfbogaphibnglkajlalhajhlbeflpdf`) is fixed by the `key` in `extension/manifest.json`. Don't remove it, or sign-in breaks.

## Update the backend

From `backend/`, signed in with `gcloud auth login` as an owner of `cbi-mail-pilot`:

```bash
gcloud config set project cbi-mail-pilot
TAG=v$(date +%Y%m%d%H%M)
IMG=us-west1-docker.pkg.dev/cbi-mail-pilot/cbi-mail/api:$TAG
gcloud builds submit --tag $IMG .
gcloud run deploy cbi-mail-api --image $IMG --region us-west1
gcloud run jobs update cbi-mail-sync --image $IMG --region us-west1
```

Database changes go in a new `backend/sql/00N_*.sql` file (use `IF NOT EXISTS`) and are applied with
`gcloud sql import sql cbi-mail-db gs://<bucket>/<file>.sql --database=cbimail --user=postgres`
(the Cloud SQL service account needs read access to the bucket).

## Update the extension

1. Edit files in `extension/`, and raise `"version"` in `extension/manifest.json`.
2. Zip the folder as `fredver/` and send it to the team.
3. Each person replaces their `fredver` folder's files and clicks reload on Fredver in `chrome://extensions`.

### Chrome Web Store (automatic updates)

Fredver is published privately to the columbiabasininsurance.com domain and force-installed from Admin Console.
To ship an update: raise the version, run `store/build-store-zip.sh`, upload `store/fredver-store.zip` in the
Chrome Web Store developer dashboard (Package → Upload new package → Submit for review). Chrome updates
everyone automatically after approval (usually within a few hours). Listing text, permission reasons and
the privacy policy are in `store/LISTING.md` and `store/PRIVACY.md`.

The `key` in `extension/manifest.json` gives the unpacked (developer) copy a fixed ID; the store copy has its own
ID, and both IDs' `https://<id>.chromiumapp.org/oauth` addresses must be in the OAuth client's redirect URIs.

## Add or remove a team member

```sql
INSERT INTO users(email,display_name,role) VALUES('name@columbiabasininsurance.com','Name','agent');
INSERT INTO inbox_members(inbox_id,user_id) SELECT i.id,u.id FROM inboxes i,users u
  WHERE i.email='info@columbiabasininsurance.com' AND u.email='name@columbiabasininsurance.com';
-- remove: UPDATE users SET active=false WHERE email='name@columbiabasininsurance.com';
```

## Known gaps (pilot)

No security review yet; the backend is public (protected by Google sign-in checks in the app);
plain-text compose (signature is HTML); manual extension distribution; instant notifications need the
`gmail-api-push@system.gserviceaccount.com` publisher grant (blocked by the domain-restricted-sharing policy), so mail
currently syncs every 5 minutes.
