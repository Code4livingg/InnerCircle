# System Architecture

## Goals

- Keep on-chain circuits minimal
- Keep payment/subscription ownership private
- Provide web2-like unlock UX
- Enforce encrypted content delivery

## High-Level Components

1. Aleo Contracts
- `subscription.aleo`: private subscription records and ownership proof transition.
- `ppv.aleo`: private content-access records and ownership proof transition.
- `creator_registry.aleo`: creator registration + price-hash registry.

2. Backend API
- Proof verification layer validates submitted proofs.
- Session manager issues short-lived JWT session tokens bound to wallet hash.
- Streaming engine serves decrypted chunks only during valid session.
- Watermark engine attaches per-session viewer fingerprint.

3. Encrypted Storage
- Content is encrypted before upload.
- Only ciphertext is stored in CDN/IPFS/object store.
- Master key remains server-side in KMS/HSM.

4. Frontend (Next.js)
- Connect Aleo wallet
- Trigger proof generation with one click
- Exchange proof for session token
- Stream content without exposing blockchain details

## Unlock Sequence

1. User opens creator/content page and clicks Unlock.
2. Wallet generates ownership proof.
3. Frontend sends proof to backend.
4. Backend verifies proof and checks policy.
5. Backend returns short-lived session token.
6. Frontend requests stream manifest/chunks using session token.
7. Backend decrypts in chunks and applies watermark fingerprint.

## Design Constraints Applied

- No loops in Leo circuits
- No complex arithmetic/hash-heavy operations in circuits
- No nested records
- Ownership checks only inside circuits
- Session model removes repeated proof generation overhead