# Project Tree

```text
project-root/
├── aleo-contracts/
│   ├── .env
│   ├── deploy.ps1
│   ├── deploy.sh
│   ├── subscription/
│   │   ├── program.json
│   │   ├── src/
│   │   │   └── main.leo
│   │   └── tests/
│   │       └── test_subscription.leo
│   ├── ppv/
│   │   ├── program.json
│   │   ├── src/
│   │   │   └── main.leo
│   │   └── tests/
│   │       └── test_ppv.leo
│   └── creator_registry/
│       ├── program.json
│       ├── src/
│       │   └── main.leo
│       └── tests/
│           └── test_creator_registry.leo
├── backend/
│   ├── .env
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   ├── scripts/
│   │   └── encrypt-upload.ts
│   └── src/
│       ├── app.ts
│       ├── index.ts
│       ├── config/
│       │   └── env.ts
│       ├── controllers/
│       │   └── access.controller.ts
│       ├── middleware/
│       │   └── requireSession.ts
│       ├── routes/
│       │   ├── access.routes.ts
│       │   └── index.ts
│       ├── services/
│       │   ├── ageVerificationService.ts
│       │   ├── contentCatalogService.ts
│       │   ├── encryptionService.ts
│       │   ├── proofVerificationService.ts
│       │   ├── sessionService.ts
│       │   ├── streamingService.ts
│       │   └── watermarkService.ts
│       ├── types/
│       │   └── session.ts
│       └── utils/
│           └── crypto.ts
├── frontend/
│   ├── .env.example
│   ├── next-env.d.ts
│   ├── next.config.mjs
│   ├── package.json
│   ├── tsconfig.json
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── creator/
│   │   │   └── [creatorId]/
│   │   │       └── page.tsx
│   │   └── content/
│   │       └── [contentId]/
│   │           └── page.tsx
│   ├── components/
│   │   ├── ProofLoadingOverlay.tsx
│   │   ├── StreamingPlayer.tsx
│   │   ├── UnlockPanel.tsx
│   │   └── WalletConnectButton.tsx
│   └── lib/
│       ├── api.ts
│       └── wallet.ts
├── docs/
│   ├── architecture/
│   │   ├── project-tree.md
│   │   ├── storage.md
│   │   └── system.md
│   ├── compliance/
│   │   └── age-verification.md
│   └── security/
│       └── model.md
├── .env
├── .gitignore
└── README.md
```
