# Age Verification Design

This platform separates identity verification from subscription privacy.

## Model A: Traditional KYC + Private Subscription

1. User verifies age with a third-party provider (e.g., Veriff, Persona, Sumsub).
2. Provider returns signed assertion: `age_verified=true`, minimal metadata.
3. Backend stores only:
- provider attestation id hash
- wallet hash
- age_verified status
4. User still accesses content via private Aleo ownership proofs.

Privacy impact:
- KYC provider may know legal identity.
- On-chain subscription ownership remains private.
- Backend keeps only pseudonymous status mapping.

## Model B: ZK Age Credential + Anonymous Access

1. User completes one-time age issuance with issuer.
2. Issuer provides credential allowing proof of `age >= 18`.
3. User submits ZK age proof to backend (no DOB revealed).
4. Backend stores boolean eligibility + wallet hash only.

Privacy impact:
- DOB/identity not revealed to backend during recurring access.
- Subscription and payment ownership remain private on-chain.

## Compliance Preserving Privacy

- Age status is decoupled from subscription records.
- No personal data written on-chain.
- Backend keeps minimal retention policy for verification events.
- Creator KYC can be optional but recommended for payout/legal policy.

## Optional Creator KYC

- Creators can complete KYC independently from subscriber privacy model.
- Creator legal identity is held by compliance service, not public chain state.
- Payout routing can require KYC completion without linking fan identities.