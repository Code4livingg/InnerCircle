#!/bin/bash
# -- deploy_contracts.sh --
# Deploy both rewritten payment contracts to Aleo testnet.
# Usage: bash deploy_contracts.sh <YOUR_PRIVATE_KEY>
set -e
export PATH="/home/ankur/.cargo/bin:$PATH"

PRIVATE_KEY="${1:-}"
if [ -z "$PRIVATE_KEY" ]; then
  echo "ERROR: Private key required. Usage: bash deploy_contracts.sh <PRIVATE_KEY>"
  exit 1
fi

NETWORK="testnet"
ENDPOINT="https://api.explorer.provable.com/v1"
PRIORITY_FEES="100000"

echo "=== Deploying ppv_pay_v2_xwnxp.aleo ==="
cd /mnt/c/Users/ankur/OneDrive/Desktop/OnlyAleo/aleo-contracts/ppv
leo deploy \
  --network "$NETWORK" \
  --endpoint "$ENDPOINT" \
  --private-key "$PRIVATE_KEY" \
  --priority-fees "$PRIORITY_FEES" \
  --broadcast \
  --yes
echo "PPV deploy complete"

echo ""
echo "=== Deploying sub_pay_v3_xwnxp.aleo ==="
cd /mnt/c/Users/ankur/OneDrive/Desktop/OnlyAleo/aleo-contracts/subscription
leo deploy \
  --network "$NETWORK" \
  --endpoint "$ENDPOINT" \
  --private-key "$PRIVATE_KEY" \
  --priority-fees "$PRIORITY_FEES" \
  --broadcast \
  --yes
echo "Subscription deploy complete"

echo ""
echo "=== Both contracts deployed successfully! ==="
