# InnerCircle - Privacy-First Creator Platform

InnerCircle is a privacy-first creator platform built on Aleo. It uses zero-knowledge ownership proofs to unlock subscriptions and pay-per-view access without exposing subscriber lists or payment history on-chain. Media stays encrypted off-chain and is streamed through short-lived, wallet-bound sessions.

## Use Cases

- Private creator subscriptions where ownership is hidden on-chain
- Pay-per-view access without revealing buyers
- Privacy-preserving age verification (KYC or ZK credential)
- Encrypted media delivery with session-based watermarking

## Aleo ZK Usage

- Private records in Aleo programs for subscription and PPV ownership
- Wallet-generated proofs of ownership instead of public on-chain reads
- "Prove once, stream many" session flow to avoid repeated proofs
- Circuits designed to be minimal for lower proving cost

## Key Features

- Private ownership records for subscriptions and PPV
- ZK proof-based unlock API
- Short-lived, wallet-hash-bound access sessions
- Encrypted storage with signed URLs from a private object store
- Watermark-ready streaming pipeline
- Creator registry and price hash registry on-chain
- Optional age verification models

## Architecture Overview

1. Aleo contracts: subscription, PPV, and creator registry programs.
2. Backend API: proof verification, session issuance, and content access control.
3. Storage/streaming: encrypted media in a private object store with expiring signed URLs.
4. Frontend: Next.js app with Aleo wallet adapters and proof flow UI.

See [docs/ARCHITECTURE.md](C:/Users/ankur/OneDrive/Desktop/OnlyAleo/docs/ARCHITECTURE.md) for detailed flows and diagrams.

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

## Getting Started

### Prerequisites

- Node.js 22+
- Leo (Aleo) toolchain
- Postgres
- AWS S3 credentials for media storage (recommended)
- Aleo wallet for testnet interaction

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
npm run db:generate
npm run dev
```

Create `backend/.env` based on `backend/.env.example` and set the required values for:

- Database: `DATABASE_URL`
- Sessions and crypto: `SESSION_SECRET`, `MASTER_KEY_BASE64`
- Storage: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`
- Aleo: `ALEO_NETWORK`, `ALEO_ENDPOINT`, program IDs for contracts

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Create `frontend/.env` based on `frontend/.env.example` and set:

- `NEXT_PUBLIC_API_BASE`
- `NEXT_PUBLIC_ALEO_NETWORK`
- `NEXT_PUBLIC_ALEO_EXPLORER_API`
- Contract program IDs used by the UI

## Contract Deployment

Deploy scripts compile and deploy programs sequentially:

```bash
cd aleo-contracts
bash deploy.sh
```

Required environment variables:

- `PRIVATE_KEY`
- `NETWORK` (default `testnet`)
- `ENDPOINT`

On Windows PowerShell:

```powershell
.\aleo-contracts\deploy.ps1 -Network testnet -Programs subscription
```

After deployment, update program IDs in your backend and frontend environment configuration. Avoid hardcoding program IDs in source.

## Security and Privacy

- Ownership records are private Aleo records; no public subscriber lists.
- The backend never exposes master keys to clients.
- Session tokens are short-lived and wallet-hash bound.
- Media is stored in a private bucket and served via expiring signed URLs.
- Watermarking discourages and traces leaks.

See the security model and storage design for details:

- `docs/security/model.md`
- `docs/architecture/storage.md`

## Documentation

- System architecture: `docs/architecture/system.md`
- Storage design: `docs/architecture/storage.md`
- Age verification: `docs/compliance/age-verification.md`
- Project tree: `docs/architecture/project-tree.md`

## Notes on Secrets

This repository does not include sensitive credentials. All secrets should live in environment files or secret managers and must never be committed.
