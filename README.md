# OnlyAleo - Privacy-First Creator Platform

OnlyAleo is a decentralized creator subscription platform on Aleo with privacy-first access control:

- Private subscription ownership records
- Private pay-per-view access records
- Zero-knowledge ownership proofs
- Session-based unlock flow (prove once, stream many)
- Encrypted off-chain content storage
- Watermark-ready streaming pipeline
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
- Watermarking discourages leaks and supports forensic tracing.
- Screen recording cannot be fully prevented; only discouraged and attributable.

## Age Verification Models

- Traditional KYC + private subscriptions
- ZK age credential + anonymous access

See `docs/compliance/age-verification.md` for details.
