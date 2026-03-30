# InnerCircle - Privacy-First Creator Platform

Privacy-first creator monetization on Aleo.

InnerCircle is a full-stack creator platform for private subscriptions, pay-per-view unlocks, anonymous access sessions, and protected media delivery. It combines Aleo payment proofs with a Next.js client, an Express API, PostgreSQL via Prisma, S3-backed media storage, and optional Amazon IVS livestream infrastructure.

This repository contains the product application, the API, and the Aleo contract workspace used to support the platform.

## Table Of Contents

- [What It Does](#what-it-does)
- [System Overview](#system-overview)
- [Repository Layout](#repository-layout)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
- [Environment Configuration](#environment-configuration)
- [Available Scripts](#available-scripts)
- [Production Deployment Notes](#production-deployment-notes)
- [Security Notes](#security-notes)
- [Documentation](#documentation)
- [Current Development Notes](#current-development-notes)

## What It Does

InnerCircle supports:

- Private recurring subscriptions backed by Aleo payment records
- Pay-per-view content unlocks
- Anonymous browsing and session issuance
- Short-lived, session-gated media access
- Session fingerprinting and watermark-aware playback
- Creator dashboards, tiers, analytics, and earnings views
- Tips and fan interaction flows
- Optional livestream and live comment infrastructure
- Age-verification and compliance support surfaces

## System Overview

The platform is split into four major layers:

1. **Frontend (`frontend/`)**  
   Next.js 15 application for wallet connection, discovery, creator pages, library, membership flows, private unlocks, creator studio, and livestream playback.

2. **Backend (`backend/`)**  
   Express API responsible for proof verification, subscription and PPV state, wallet session handling, media authorization, livestream support, analytics, and persistence.

3. **Contracts (`aleo-contracts/`)**  
   Aleo programs for subscriptions, PPV, creator registry, payment proofs, access control, access passes, and tips.

4. **Data and storage services**  
   PostgreSQL for application data, S3-compatible object storage for protected media, and optional Amazon IVS for live streaming workflows.

High-level request flow:

- A user connects an Aleo wallet in the frontend
- The client verifies payment state or generates a local proof
- The backend validates the request and creates a short-lived access session
- Media access is issued through backend-controlled routes and signed delivery
- Protected playback uses session context, watermark identity, and expiry rules

## Repository Layout

```text
.
├── aleo-contracts/         Aleo program workspace and deployment scripts
├── backend/                Express + Prisma API
├── docs/                   Architecture, security, storage, and compliance docs
├── frontend/               Next.js application
├── .github/                GitHub configuration
└── README.md               Project overview
```

Notable backend route groups include:

- `/api/discover`
- `/api/content`
- `/api/media`
- `/api/subscriptions`
- `/api/sessions`
- `/api/livestreams`
- `/api/live-comments`
- `/api/tips`
- `/api/wallet`

Notable frontend application areas include:

- `/discover`
- `/library`
- `/membership`
- `/activity`
- `/creator/[creatorId]`
- `/content/[contentId]`
- `/creator-studio/*`

## Technology Stack

### Frontend

- Next.js 15
- React 18
- TypeScript
- Provable wallet adapters and Aleo SDK libraries
- Amazon IVS web player packages for live playback

### Backend

- Node.js
- Express
- TypeScript
- Prisma
- PostgreSQL
- AWS SDK
- Zod
- Pino

### Blockchain / Privacy

- Aleo / Leo contracts
- Wallet-driven proof and payment flows
- Private subscription and PPV verification paths
- Anonymous session registration and wallet-bound access semantics

## Getting Started

### Prerequisites

- Node.js 22 or newer recommended
- npm
- PostgreSQL
- Access to an S3-compatible bucket for media delivery
- Aleo wallet for client testing
- Leo toolchain if you need to build or deploy contracts

### 1. Install Dependencies

Backend:

```bash
cd backend
npm install
```

Frontend:

```bash
cd frontend
npm install
```

### 2. Create Environment Files

Use only the example files as templates:

- `backend/.env.example`
- `frontend/.env.example`

Do not commit real `.env` files or secret values.

### 3. Prepare The Database

From `backend/`:

```bash
npm run db:generate
npm run db:push
```

If you are using Prisma migrations in local development instead of direct schema push:

```bash
npm run db:migrate
```

### 4. Start The Backend

From `backend/`:

```bash
npm run dev
```

The API listens on the port configured by `PORT` in the backend environment.

### 5. Start The Frontend

From `frontend/`:

```bash
npm run dev
```

By default, the frontend resolves browser API calls through its `/api` proxy and uses `API_PROXY_BASE` or `NEXT_PUBLIC_API_BASE` on the server side.

### 6. Build Contracts When Needed

If you are working on Aleo programs:

```bash
cd aleo-contracts
./build_contracts.sh
```

PowerShell deployment helpers are also present in `aleo-contracts/`.

## Environment Configuration

The backend validates environment variables eagerly with Zod on startup. Populate every required field from `backend/.env.example` before launching the API.

### Backend Configuration Areas

- Application runtime
  - `PORT`
  - `NODE_ENV`
  - `CORS_ORIGINS`
  - `TRUST_PROXY`

- Session and security
  - `SESSION_SECRET`
  - `SESSION_TTL_SECONDS`
  - `FINGERPRINT_SESSION_TTL_SECONDS`
  - `STREAM_TTL_SECONDS`
  - `SIGNED_URL_EXPIRATION`
  - `MASTER_KEY_BASE64`

- Database
  - `DATABASE_URL`
  - `DB_CONNECT_TIMEOUT_SECONDS`

- Media and infrastructure
  - `STORAGE_PROVIDER`
  - `STORAGE_LOCAL_DIR`
  - `AWS_REGION`
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - `S3_BUCKET_NAME`
  - optional S3-compatible overrides such as `S3_ENDPOINT`

- Livestream
  - `IVS_REGION`
  - `IVS_TOKEN_TTL_SECONDS`
  - optional IVS channel and stream-key settings

- Aleo integration
  - `ALEO_NETWORK`
  - `ALEO_ENDPOINT`
  - contract program ID variables
  - optional signer fields such as `ALEO_PRIVATE_KEY`

### Frontend Configuration Areas

- API routing
  - `API_PROXY_BASE`
  - `NEXT_PUBLIC_API_BASE`

- Aleo / network behavior
  - `NEXT_PUBLIC_ALEO_NETWORK`
  - `NEXT_PUBLIC_ALEO_EXPLORER_API`

- Fee and contract references
  - execution fee settings
  - program ID settings used by the UI

Recommended practice:

- Store production secrets in your deployment platform secret manager
- Keep frontend public env values limited to non-secret configuration
- Rotate any leaked secret immediately instead of editing history manually

## Available Scripts

### Backend

From `backend/`:

| Command | Purpose |
|---|---|
| `npm run dev` | Run the API in watch mode via `tsx` |
| `npm run build` | Compile TypeScript into `dist/` |
| `npm run start` | Run the compiled API |
| `npm run typecheck` | Run TypeScript checks without emitting output |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run Prisma development migrations |
| `npm run db:push` | Push schema directly to the database |
| `npm run db:studio` | Open Prisma Studio |
| `npm run media:migrate:s3` | Migrate local content to S3 |
| `npm run db:migrate:rds` | Helper for database migration to RDS |

### Frontend

From `frontend/`:

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Produce a production build |
| `npm run start` | Run the production build |
| `npm run lint` | Run frontend linting |

## Production Deployment Notes

This repository does not require Docker and does not currently document a container-based deployment path.

Typical production topology:

- **Frontend**  
  Deploy the Next.js app to Vercel or another Node-capable hosting platform.

- **Backend**  
  Deploy the Express service to your preferred Node runtime with access to PostgreSQL, S3-compatible storage, and optional IVS resources.

- **Database**  
  Use managed PostgreSQL where possible.

- **Object storage**  
  Use a private bucket. Do not expose raw media objects publicly.

- **Contracts**  
  Deploy Aleo programs separately, then update backend and frontend environment configuration with the correct program identifiers.

Production checklist:

- Enable HTTPS on all public surfaces
- Set strict, environment-specific CORS origins
- Use strong session secrets and encryption keys
- Store secrets in a dedicated secret manager
- Keep media buckets private
- Run `npm run build` for both backend and frontend before release
- Validate `/api/health` after backend deployment
- Confirm contract IDs in both frontend and backend configuration after contract changes

## Security Notes

This README intentionally excludes:

- private keys
- cloud credentials
- session secrets
- encryption material
- production hostnames not already public through the app
- deployment transaction IDs
- infrastructure instance identifiers

Additional security guidance:

- Never commit `.env`, `.env.local`, or secret export files
- Treat wallet signing keys and backend encryption keys as high sensitivity
- Limit admin credentials and IVS credentials to the minimum required scope
- Prefer same-origin media delivery and short-lived access tokens for protected playback

## Documentation

Detailed internal documentation lives in `docs/`:

- [Architecture Overview](./docs/ARCHITECTURE.md)
- [System Architecture](./docs/architecture/system.md)
- [Storage Design](./docs/architecture/storage.md)
- [Project Tree](./docs/architecture/project-tree.md)
- [Security Model](./docs/security/model.md)
- [Age Verification Notes](./docs/compliance/age-verification.md)

## Current Development Notes

- The repository contains both application code and contract sources
- Frontend and backend are versioned together in one monorepo-style workspace
- There is no dedicated automated test suite defined at the root today; validation is currently centered around type checks, production builds, and targeted manual verification

If you are contributing, keep commits scoped by concern and avoid bundling infrastructure, contract, frontend, and backend changes together unless they must ship atomically.
