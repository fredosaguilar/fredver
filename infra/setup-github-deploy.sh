#!/usr/bin/env bash
# One-time setup so GitHub Actions (fredosaguilar/fredver, main branch only) can deploy Fredver.
# Run in Cloud Shell as an owner of project cbi-mail-pilot: paste this whole file and press Enter.
# Safe to re-run: steps that already exist are skipped.
set -u
P=cbi-mail-pilot
NUM=$(gcloud projects describe $P --format='value(projectNumber)')
D=cbi-mail-deployer@$P.iam.gserviceaccount.com
B=gs://cbi-mail-pilot-migrations
REPO=fredosaguilar/fredver
gcloud config set project $P >/dev/null
ok(){ echo "  ✓ $1"; }

echo "1/6 Enabling APIs";  gcloud services enable iamcredentials.googleapis.com sts.googleapis.com && ok done
echo "2/6 Deploy account"; gcloud iam service-accounts describe $D >/dev/null 2>&1 || gcloud iam service-accounts create cbi-mail-deployer --display-name="Fredver GitHub deployer"; ok "$D"; sleep 10
echo "3/6 Deploy permissions"
gcloud projects add-iam-policy-binding $P --member=serviceAccount:$D --role=roles/run.developer --condition=None --format=none && ok "deploy Cloud Run"
gcloud projects add-iam-policy-binding $P --member=serviceAccount:$D --role=roles/cloudsql.admin --condition=None --format=none && ok "apply database migrations"
gcloud artifacts repositories add-iam-policy-binding cbi-mail --location=us-west1 --member=serviceAccount:$D --role=roles/artifactregistry.writer --format=none && ok "push images"
gcloud iam service-accounts add-iam-policy-binding cbi-mail-api@$P.iam.gserviceaccount.com --member=serviceAccount:$D --role=roles/iam.serviceAccountUser --format=none && ok "run as cbi-mail-api"
echo "4/6 Migrations bucket"
gcloud storage buckets describe $B >/dev/null 2>&1 || gcloud storage buckets create $B --location=us-west1 --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding $B --member=serviceAccount:$D --role=roles/storage.objectAdmin --format=none
SQLSA=$(gcloud sql instances describe cbi-mail-db --format='value(serviceAccountEmailAddress)')
gcloud storage buckets add-iam-policy-binding $B --member=serviceAccount:$SQLSA --role=roles/storage.objectViewer --format=none
for n in 002_phase1.sql 003_launch.sql 004_share.sql; do
  gcloud storage objects describe $B/applied/$n >/dev/null 2>&1 || echo "applied before automation" | gcloud storage cp - $B/applied/$n
done; ok "$B (002-004 marked as applied)"
echo "5/6 GitHub trust (only $REPO, only main)"
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github >/dev/null 2>&1 || \
gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github --display-name="GitHub $REPO" \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'"
ok "provider projects/$NUM/locations/global/workloadIdentityPools/github/providers/github"
echo "6/6 Let GitHub act as the deploy account"
gcloud iam service-accounts add-iam-policy-binding $D --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" --format=none && ok done
echo; echo "Setup complete. Deploy from GitHub: Actions -> Backend -> Run workflow."
