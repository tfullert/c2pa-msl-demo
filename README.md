# C2PA MSL signing service (Cloud Run)

HTTP service that signs media with C2PA using DigiCert Media Signing Library (MSL). The container calls a remote MSL signing URL. You will need:

- A Google account
- A GCP project with billing enabled
- [Google Cloud SDK (](https://cloud.google.com/sdk/docs/install)`gcloud`[)](https://cloud.google.com/sdk/docs/install)
- (Optional) Local Docker installation if you want to test before deploying (native library is linux/amd64).

And the following environment variables will need to be configured in your terminal:

| Name              | Required | Where it goes                     |
| ----------------- | -------- | --------------------------------- |
| `MSL_SIGNING_URL` | yes      | Cloud Run env var                 |
| `MSL_API_KEY`     | yes      | Secret Manager                    |
| `MSL_ACCOUNT_ID`  | yes      | Cloud Run env var                 |
| `MSL_USER_ID`     | no       | (Optional) You will not need this |

## 1. Install `gcloud` and log in

macOS (Homebrew):

```bash
brew install --cask google-cloud-sdk
gcloud init
```

Or follow Google’s installer for your OS. When prompted, log in and pick (or create) **your** project.

Confirm your glcoud environment:

```bash
gcloud auth list
gcloud projects list
```

## 2. Create or select a project

The project ID must be globally unique. Example names below are placeholders — use your own.

```bash
export PROJECT_ID=your-gcp-project-id
export REGION=us-central1
export REPO=c2pa
export SERVICE=c2pa-msl-demo
```

If you don't already have a project then create one:

```bash
gcloud projects create "$PROJECT_ID" --name="C2PA MSL Demo"
```

Link billing. List accounts, then link:

```bash
gcloud billing accounts list
gcloud billing projects link "$PROJECT_ID" --billing-account=YOUR_BILLING_ACCOUNT_ID
```

Use this project for the rest of the commands:

```bash
gcloud config set project "$PROJECT_ID"
```

In the console: [Google Cloud Console](https://console.cloud.google.com/) → project picker → your project.

## 3. Enable APIs

```bash
gcloud services enable \
  compute.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  --project="$PROJECT_ID"
```

`compute.googleapis.com` is required. Some `gcloud` commands probe Compute Engine even though this service runs on Cloud Run. If it is off, you may see an error that the project “does not exist.”

## 4. Set MSL values in your shell

```bash
export MSL_SIGNING_URL='https://your-msl-signing-url'
export MSL_API_KEY='your-api-key'
export MSL_ACCOUNT_ID='your-account-id'
```

`gcloud run deploy --set-env-vars` substitutes these from your current shell. If they are unset, Cloud Run gets empty values and signing will fail.

## 5. Create Artifact Registry

```bash
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --project="$PROJECT_ID"
```

If the repository already exists, continue.

## 6. Store the API key in Secret Manager

```bash
printf '%s' "$MSL_API_KEY" | gcloud secrets create MSL_API_KEY \
  --project="$PROJECT_ID" \
  --data-file=-
```

If the secret name already exists, add a version instead:

```bash
printf '%s' "$MSL_API_KEY" | gcloud secrets versions add MSL_API_KEY \
  --project="$PROJECT_ID" \
  --data-file=-
```

The secret must have a version with the key data. Creating an empty secret named `MSL_API_KEY` makes Cloud Run fail with `versions/latest was not found`. Confirm there is at least one enabled version:

```bash
gcloud secrets versions list MSL_API_KEY --project="$PROJECT_ID"
```

Allow the Cloud Run runtime service account to read it:

```bash
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

gcloud secrets add-iam-policy-binding MSL_API_KEY \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

That is the default Compute Engine service account. If you deploy Cloud Run with a different service account, grant `secretAccessor` to that account instead.

## 7. Build the image

From the directory that contains `Dockerfile`:

```bash
gcloud builds submit --project "$PROJECT_ID" --tag "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$SERVICE"
```

Cloud Build is linux/amd64, which matches `libc2pa_rust.so`. You do not need Docker on your laptop for this step.

The image does not include API keys, sample media, or other platform MSL binaries.

## 8. Deploy to Cloud Run

```bash
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$SERVICE" \
  --platform managed \
  --no-allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --concurrency 1 \
  --set-env-vars "MSL_SIGNING_URL=${MSL_SIGNING_URL},MSL_ACCOUNT_ID=${MSL_ACCOUNT_ID}" \
  --set-secrets "MSL_API_KEY=MSL_API_KEY:latest"
```

`--no-allow-unauthenticated` keeps the signing endpoint private. `--concurrency 1` is recommended because the native MSL call is synchronous.

If you need `MSL_USER_ID`, add it to `--set-env-vars` (comma-separated, no spaces around `=`).

Confirm env vars are set:

```bash
gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='yaml(spec.template.spec.containers[0].env)'
```

`MSL_SIGNING_URL` and `MSL_ACCOUNT_ID` must show a `value:`. `MSL_API_KEY` must use `valueFrom.secretKeyRef`.

## 9. Test

```bash
URL=$(gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format='value(status.url)')

curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$URL/health"
```

Expect `{ "ok": true, "signingConfigured": true }`.

Sign a file (any JPEG, PNG, MP4, or PDF under 32 MB):

```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -F "media=@/path/to/your.jpg" \
  "$URL/sign" \
  -o signed.jpeg \
  -D -
```

Success: HTTP 200, a non-empty `signed.jpeg`, and headers `X-C2PA-Manifest-Id` / `X-C2PA-Manifest-Title`. Open `signed.jpeg` in [C2PA Verify / a C2PA viewer](https://contentcredentials.org/verify) to confirm the manifest.

To let another Google account call the service:

```bash
gcloud run services add-iam-policy-binding "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --member="user:someone@example.com" \
  --role="roles/run.invoker"
```

That person uses their own identity token:

```bash
gcloud auth login
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -F "media=@/path/to/your.jpg" \
  "$URL/sign" -o signed.jpeg
```

## Optional: run the container locally first

The `.so` will not load on macOS. Use Docker:

```bash
docker build --platform linux/amd64 -t c2pa-msl-demo .

docker run --platform linux/amd64 --rm -p 8080:8080 \
  -e MSL_SIGNING_URL \
  -e MSL_API_KEY \
  -e MSL_ACCOUNT_ID \
  c2pa-msl-demo
```

In another terminal:

```bash
curl http://localhost:8080/health
curl -F "media=@/path/to/your.jpg" http://localhost:8080/sign -o signed.jpeg
```

## HTTP API

Listens on `0.0.0.0:$PORT` (Cloud Run sets `PORT`; default 8080).

### `GET /health` or `GET /`

```json
{ "ok": true, "signingConfigured": true }
```

`signingConfigured` is `false` if `MSL_SIGNING_URL`, `MSL_API_KEY`, or `MSL_ACCOUNT_ID` is missing.

### `POST /sign`

Upload media. Response body is the signed file.

| Response header         | Meaning                             |
| ----------------------- | ----------------------------------- |
| `Content-Type`          | From the original filename          |
| `Content-Disposition`   | `attachment; filename="signed-..."` |
| `X-C2PA-Manifest-Id`    | Manifest ID                         |
| `X-C2PA-Manifest-Title` | Manifest title (URL-encoded)        |

Multipart (preferred):

```bash
curl -F "media=@/path/to/your.jpg" "$URL/sign" -o signed.jpeg
```

Optional form fields: `filename`, `roles`, `tsaUrl`, `actions` (JSON), `metadata` (JSON), `traceId`.

Defaults match the original demo CLI (AI disclosure metadata, roles `creator,contributor,publisher`, DigiCert TSA).

Raw body:

```bash
curl -H "Content-Type: image/jpeg" -H "X-Filename: sample.jpeg" \
  --data-binary @/path/to/your.jpg \
  "$URL/sign" -o signed.jpeg
```

Errors are JSON: `{ "error": "..." }`. Missing MSL config is **503**.

## Limits and networking

- Cloud Run default request and response size is **32 MB**.
- The service needs egress to `MSL_SIGNING_URL` (HTTPS) and `http://timestamp.digicert.com`.
- Image is **linux/amd64** (Debian Trixie / glibc 2.41). `libc2pa_rust.so` requires GLIBC 2.38 or newer.

## Teardown

Use the same `PROJECT_ID`, `REGION`, `REPO`, and `SERVICE` as deploy. Confirm the project before deleting anything:

```bash
export PROJECT_ID=your-gcp-project-id
export REGION=us-central1
export REPO=c2pa
export SERVICE=c2pa-msl-demo

gcloud config get-value project
```

### Remove this demo’s resources

Deletes the Cloud Run service, container images, and the API key secret. Does not delete the GCP project.

```bash
gcloud run services delete "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION"

gcloud artifacts repositories delete "$REPO" \
  --project "$PROJECT_ID" \
  --location "$REGION"

gcloud secrets delete MSL_API_KEY \
  --project "$PROJECT_ID"
```

Each command asks for confirmation. Add `--quiet` to skip the prompt.

Leaving APIs enabled is fine. To turn them off (only if nothing else in the project uses them):

```bash
gcloud services disable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  compute.googleapis.com \
  --project="$PROJECT_ID"
```

### Delete the whole project

Use this if you created the GCP project only for this demo. It removes **all** resources in that project, not just Cloud Run.

```bash
gcloud projects delete "$PROJECT_ID"
```

Google keeps a deleted project in a pending state for about 30 days, then it is unrecoverable. The project ID cannot be reused immediately.

## Troubleshooting

| Symptom                                                         | Likely cause                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Project “does not exist” / Compute Engine API has not been used | Enable `compute.googleapis.com` (step 3). Confirm `gcloud config get-value project` is **your** project.      |
| `Secret .../MSL_API_KEY/versions/latest was not found`          | Secret name exists but has no versions. Re-run step 6 with `--data-file=-` and list versions.                 |
| Revision not ready / container fails health                     | Env vars empty. Export `MSL_*` in the same shell as `gcloud run deploy`, then deploy again.                   |
| `/health` → `signingConfigured: false`                          | Same as above, or the secret did not mount. Check `gcloud run services describe`.                             |
| `403` from curl                                                 | Missing `Authorization: Bearer $(gcloud auth print-identity-token)`, or the caller lacks `roles/run.invoker`. |
| `413`                                                           | Upload larger than 32 MB (`MAX_UPLOAD_BYTES` / Cloud Run request limit).                                      |
| Local Docker: cannot load `.so`                                 | Build/run with `--platform linux/amd64`.                                                                      |

