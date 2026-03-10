# Security Model

## Threats Covered

- Public graph analysis of subscriber ownership
- Public leak of payment amounts
- Unauthorized content retrieval without proof/session
- Replay of stale sessions

## Controls

- Private record ownership in Aleo contracts
- Proof-based unlock API
- Wallet-hash-bound short-lived sessions
- Content encryption at rest and in transit
- Stream-only access and expiring URLs/tokens
- Invisible watermark fingerprint logging

## Key Distribution

- Master key remains in KMS/HSM only.
- Content keys are wrapped at rest.
- Session key is derived ephemeral material for active playback.
- Client never receives master key.

## Piracy Mitigation

- Watermark fingerprints map leaked media to session identity.
- Session expiration limits key lifetime.
- CDN URLs are signed and short-lived.

## Limitations

- Screen recording cannot be fully prevented.
- Piracy can be discouraged, traced, and acted on, not eliminated.
- Compromised user device can still leak rendered content.

## Contract Safety

- Re-initialization blocked in `subscription.initialize` via singleton flag.
- Creator operations require registration checks.
- Admin/fee state stored as dedicated singleton mappings.