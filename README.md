# OnlyAleo - Privacy-First Creator Platform

OnlyAleo is a decentralized creator subscription platform on Aleo with privacy-first access control:

- Private subscription ownership records
- Private pay-per-view access records
- Zero-knowledge ownership proofs
- Session-based unlock flow (prove once, stream many)
- Private S3 media storage with short-lived signed URLs
- Watermark-ready secure media delivery
- Privacy-preserving age verification models

## Project Structure

```text
project-root/
├── aleo-contracts/
│   ├── subscription/
│   ├── ppv/
│   ├── creator_registry/
│   └── deploy.sh
├── backend/
├── frontend/
├── docs/
└── README.md
```

## Quick Start

### 1. Contracts

```bash
cd aleo-contracts/subscription && leo build
cd ../ppv && leo build
cd ../creator_registry && leo build
```

### 2. Backend

```bash
cd backend
npm install
npm run dev
```

Backend media delivery now requires private S3 configuration in `backend/.env`:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET_NAME`
- `SIGNED_URL_EXPIRATION` (defaults to `60`)

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

## Deployment

`aleo-contracts/deploy.sh` compiles all Leo programs and deploys them sequentially.

Required environment variables:

- `PRIVATE_KEY`
- `NETWORK` (default: `testnet`)
- `ENDPOINT` (default: `https://api.explorer.provable.com/v1`)

Run:

```bash
cd aleo-contracts
bash deploy.sh
```

To redeploy only the modified subscription program on testnet:

```bash
cd aleo-contracts
bash deploy.sh subscription
```

On Windows PowerShell:

```powershell
.\aleo-contracts\deploy.ps1 -Network testnet -Programs subscription
```

## Testnet Deployment (March 9, 2026)

To avoid global Aleo namespace collisions and high namespace fees on common IDs, the deployed
program IDs use wallet-specific suffixes:

- Subscription module: `sub_pay_v3_xwnxp.aleo`
- PPV module: `ppv_pay_v2_xwnxp.aleo`
- Creator registry module: `creator_reg_v2_xwnxp.aleo`

Confirmed deployment transactions:

- `sub_pay_v3_xwnxp.aleo`: `at18m7p0jdjhpa3ca82t2p3fq8q6ehtr7pp67h3e4ks8gvqkdfm9ggs9d57n4`
- `ppv_pay_v2_xwnxp.aleo`: `at1mrahevktyppdkafmfa4s7jyyhqwm7cdnltf050xyx8xqc08dwvqq0n24a0`
- `creator_reg_v2_xwnxp.aleo`: `at12e73m787325esjrwx9lyrwstfeapyq05ygsp0at2h9d8xn8tqv9qlks6cd`

If `sub_pay_v3_xwnxp.aleo` changes, the live testnet deployment must be rebroadcast after `leo build`.
Local source/build edits do not update the already deployed on-chain program.

Historical subscription deployment notes:

- March 9, 2026: fresh `sub_pay_v3_xwnxp.aleo` deployment confirmed via `at18m7p0jdjhpa3ca82t2p3fq8q6ehtr7pp67h3e4ks8gvqkdfm9ggs9d57n4`
- March 9, 2026: older `sub_pay_v2_xwnxp.aleo` was upgraded in-place via `at1kzz29ameed6vgz6h6e74e5yg23zxxzwdflv9vma8sytfwagrsypseguv7t`
- The expiry-aware runtime uses `pay_and_subscribe_v2` and `prove_subscription_v2`.

## Security Notes

- Subscription ownership and PPV ownership are private records.
- Backend never exposes content master keys.
- Session tokens are short-lived and wallet-hash bound.
- Media objects are stored in a private S3 bucket and never exposed as permanent public URLs.
- Backend generates short-lived signed URLs only after session and entitlement checks pass.
- Watermarking discourages leaks and supports forensic tracing.
- Screen recording cannot be fully prevented; only discouraged and attributable.

## Private S3 Media Delivery

Uploaded media now bypasses local disk persistence and is stored directly in Amazon S3 using backend-generated object keys:

- Content upload: `POST /api/content/upload`
- Secure access: `GET /api/media/:id`

The backend stores only S3 object keys in Postgres, for example:

```text
media/8f4d5e2c/1712345678901-3b9c...-episode-01.mp4
```

It does not store permanent S3 URLs in the database.

### Access flow

1. Creator uploads content with multipart form data.
2. Backend uploads media and optional thumbnail to a private S3 bucket.
3. Backend stores only the returned object keys in the `Content` record.
4. Fan unlocks the content and receives a short-lived access session token.
5. Frontend calls `GET /api/media/:id` with that session token.
6. Backend verifies access scope, generates a signed S3 URL, and returns it.
7. Frontend uses the signed URL for playback and refreshes it before expiry.

Example response from `GET /api/media/:id`:

```json
{
  "url": "https://signed-url...",
  "expiresAt": "2026-03-11T12:00:00.000Z",
  "expiresIn": 60,
  "mimeType": "video/mp4"
}
```

### Why this is safer

- The S3 bucket remains fully private.
- Only the backend can mint signed URLs.
- Signed URLs expire quickly, so sharing them has limited value.
- The frontend never hardcodes or stores permanent bucket URLs.

### AWS bucket requirements

- Disable all public access on the bucket.
- Do not configure public-read object policies.
- Restrict credentials to the minimum S3 actions required for `PutObject`, `GetObject`, and `DeleteObject`.
- Prefer bucket-level private ownership controls over public ACLs.

### Migrating existing local media

If you already uploaded media before the S3 refactor, those older records still point at the legacy local chunk storage. Migrate them with:

```bash
cd backend
npm run media:migrate:s3
```

The migration script:

- reads legacy encrypted chunks from `backend/storage/content`
- decrypts and reconstructs the original media
- uploads the reconstructed file to private S3
- updates the `Content.baseObjectKey` and `storageProvider` in Postgres

It does not delete the old local files, so they remain as a safety backup.

## Age Verification Models

- Traditional KYC + private subscriptions
- ZK age credential + anonymous access

See `docs/compliance/age-verification.md` for details.
