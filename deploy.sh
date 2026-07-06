#!/bin/bash
# ============================================================================
# Word of the Day — full deployment script
# ============================================================================
# This aggregates every gcloud/firebase CLI command used to build this app.
# A few steps CANNOT be scripted (they require a web dashboard) — those are
# called out clearly with MANUAL STEP markers. Run this script section by
# section rather than all at once the first time, so you can verify each
# stage before moving to the next.
#
# Prerequisites before running this file:
#   - gcloud CLI installed and authenticated (gcloud init)
#   - firebase-tools installed (npm install -g firebase-tools) + firebase login
#   - A GCP project already created with billing linked (see MANUAL STEP 0)
#   - Node.js + npm installed locally for the seed/audio scripts
# ============================================================================

set -e  # stop the script if any command fails

# ---------------------------------------------------------------------------
# CONFIGURATION — edit these values for your project before running
# ---------------------------------------------------------------------------
PROJECT_ID="conquer-english-app"                    # your GCP project ID
REGION="us-central1"                                # region for Functions/Firestore/Scheduler
BILLING_ACCOUNT_ID="XXXXXX-XXXXXX-XXXXXX"           # from: gcloud billing accounts list
AUDIO_BUCKET_NAME="conquer-english-app-audio"       # must be globally unique
MAILGUN_DOMAIN="mg.yourdomain.com"                  # your verified Mailgun sending domain
SCHEDULE_TIMEZONE="America/New_York"


# ============================================================================
# MANUAL STEP 0 — cannot be scripted
# ============================================================================
# 1. Create the GCP project in console.cloud.google.com (or via
#    `gcloud projects create $PROJECT_ID`)
# 2. Link a billing account: Billing -> Link a billing account (requires
#    adding a card the first time — one-time, console only)
# ============================================================================

gcloud config set project "$PROJECT_ID"


# ============================================================================
# STEP 1 — Budget alert (safety net)
# ============================================================================
gcloud billing budgets create \
  --billing-account="$BILLING_ACCOUNT_ID" \
  --display-name="conquer-english-app-budget" \
  --budget-amount=5USD \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0


# ============================================================================
# STEP 2 — Enable required APIs
# ============================================================================
gcloud services enable \
  cloudfunctions.googleapis.com \
  firestore.googleapis.com \
  pubsub.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  texttospeech.googleapis.com \
  eventarc.googleapis.com 


# ============================================================================
# STEP 3 — Create the Firestore database (Native mode)
# ============================================================================
# NOTE: location cannot be changed after creation
gcloud firestore databases create --location="$REGION"


# ============================================================================
# MANUAL STEP 1 — Mailgun account + domain (mailgun.com dashboard)
# ============================================================================
# 1. Sign up at https://signup.mailgun.com
# 2. Sending -> Domains -> Add New Domain -> enter $MAILGUN_DOMAIN
# 3. Add the DNS records Mailgun shows you (TXT/MX for SPF/DKIM) inside
#    Cloudflare's DNS panel (see MANUAL STEP 3 below) — set them to
#    "DNS only" (grey cloud), never Proxied
# 4. Settings -> API Keys -> Create API Key -> copy it immediately
# ============================================================================


# ============================================================================
# STEP 4 — Store the Mailgun API key in Secret Manager
# ============================================================================
echo -n "MAILGUN_API_KEY" | gcloud secrets create mailgun-api-key --data-file=-

# Verify it saved correctly:
gcloud secrets versions access latest --secret=mailgun-api-key

# Set IAM policy so the Cloud Functions service account can access it:
PROJECT_NUMBER=$(gcloud projects describe conquer-english-app --format='value(projectNumber)')
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud secrets add-iam-policy-binding mailgun-api-key \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/secretmanager.secretAccessor"


# ============================================================================
# STEP 5 — Deploy the subscribe function (public signup endpoint)
# ============================================================================
# Requires local folder ./subscribe with index.js + package.json
gcloud functions deploy subscribe \
  --gen2 \
  --runtime=nodejs24 \
  --region="$REGION" \
  --source=./subscribe \
  --entry-point=subscribe \
  --trigger-http \
  --allow-unauthenticated


# ============================================================================
# STEP 6 — Deploy the unsubscribe function
# ============================================================================
# Requires local folder ./unsubscribe with index.js + package.json
gcloud functions deploy unsubscribe \
  --gen2 \
  --runtime=nodejs24 \
  --region="$REGION" \
  --source=./unsubscribe \
  --entry-point=unsubscribe \
  --trigger-http \
  --allow-unauthenticated


# ============================================================================
# STEP 7 — Pub/Sub topic + the daily send function
# ============================================================================
gcloud pubsub topics create daily-word-trigger

# Requires local folder ./send-daily-word with index.js + package.json
gcloud functions deploy sendDailyWord \
  --gen2 \
  --runtime=nodejs24 \
  --region="$REGION" \
  --source=./send-daily-word \
  --entry-point=sendDailyWord \
  --trigger-topic=daily-word-trigger \
  --set-secrets=MAILGUN_API_KEY=mailgun-api-key:latest \
  --set-env-vars=MAILGUN_DOMAIN="$MAILGUN_DOMAIN"


# ============================================================================
# STEP 8 — Cloud Scheduler job (fires the Pub/Sub topic daily)
# ============================================================================
gcloud scheduler jobs create pubsub daily-word-job \
  --schedule="0 8 * * *" \
  --time-zone="$SCHEDULE_TIMEZONE" \
  --topic=daily-word-trigger \
  --message-body="run" \
  --location="$REGION"

# To manually fire it for testing without waiting for the schedule:
#   gcloud scheduler jobs run daily-word-job --location="$REGION"


# ============================================================================
# STEP 9 — Cloud Storage bucket for pronunciation audio
# ============================================================================
gcloud storage buckets create "gs://$AUDIO_BUCKET_NAME" \
  --location="$REGION" \
  --uniform-bucket-level-access

gcloud storage buckets add-iam-policy-binding "gs://$AUDIO_BUCKET_NAME" \
  --member=allUsers \
  --role=roles/storage.objectViewer


# ============================================================================
# STEP 10 — Seed Firestore with words + generate pronunciation audio
# ============================================================================
# These are Node scripts, not gcloud commands — run locally:
#   cd word-seed
#   npm install
#   gcloud auth application-default login   # only needed once, for local scripts
#   node upload-words.js
#   node generate-audio.js


# ============================================================================
# STEP 11 — Firebase Hosting (signup page)
# ============================================================================
# One-time setup (run manually, not part of this script's automated flow):
#   npm install -g firebase-tools
#   firebase login
#   cd word-app-site
#   firebase init hosting     # select $PROJECT_ID, public dir "public", no SPA
#
# Every time you update the signup page HTML:
#   firebase deploy --only hosting


# ============================================================================
# MANUAL STEP 2 — Cloudflare (DNS takeover from your registrar)
# ============================================================================
# 1. Sign up free at https://cloudflare.com -> Add a site -> your domain
# 2. Cloudflare gives you 2 nameservers
# 3. Enter those as Primary/Secondary in your registrar's nameserver form
# 4. Wait for propagation (Cloudflare emails you when active)
# ============================================================================


# ============================================================================
# MANUAL STEP 3 — Custom domain on Firebase Hosting
# ============================================================================
# 1. Firebase Console -> Hosting -> Add custom domain -> enter your domain
# 2. Firebase shows a TXT record + 2 A records (and a CNAME if adding "www")
# 3. Add all of them in Cloudflare's DNS tab, each set to "DNS only" (grey
#    cloud) — NOT Proxied, or Firebase's SSL certificate provisioning can
#    get stuck indefinitely
# 4. Click Verify in Firebase, then wait for SSL provisioning (minutes-24hrs)
# ============================================================================


echo "Done. Remember: MANUAL STEPS 0-3 above must be completed via their"
echo "respective web dashboards — they cannot be run from this script."