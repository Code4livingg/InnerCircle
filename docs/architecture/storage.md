# Encrypted Storage Design

## Data Model

- `EncryptedObject`:
  - `content_id`
  - `ciphertext_uri`
  - `cipher_algorithm` (`AES-256-GCM`)
  - `wrapped_content_key`
  - `iv`
  - `auth_tag`

## Encryption Pipeline

1. Creator uploads source file.
2. Backend generates random content key (DEK).
3. File is encrypted with DEK.
4. DEK is wrapped using master key (KEK from KMS/HSM).
5. Ciphertext is uploaded to CDN/IPFS/object storage.
6. Metadata only stores encrypted locations and wrapped keys.

## Access Pipeline

1. Session token validated.
2. Wrapped DEK is unwrapped in secure backend context.
3. Per-session streaming key is derived.
4. Chunks are decrypted and watermarked on-the-fly.
5. Response is stream-only (no direct raw file URL exposure).

## Never Allowed

- Public plaintext URLs
- Persistent delivery of plaintext files
- Sending master key to clients