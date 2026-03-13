#!/bin/bash
# -- deploy_contracts.sh --
# Deploy both rewritten payment contracts to Aleo testnet.
# Usage: bash deploy_contracts.sh <YOUR_PRIVATE_KEY>
set -e
export PATH="/home/ankur/.cargo/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PRIVATE_KEY="${1:-}"
if [ -z "$PRIVATE_KEY" ]; then
  echo "ERROR: Private key required. Usage: bash deploy_contracts.sh <PRIVATE_KEY>"
  exit 1
fi

NETWORK="testnet"
ENDPOINT="https://api.explorer.provable.com/v1"
PRIORITY_FEES="100000"

echo "=== Deploying ppv_pay_v2_xwnxp.aleo ==="
cd "$SCRIPT_DIR/ppv"
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
cd "$SCRIPT_DIR/subscription"
leo deploy \
  --network "$NETWORK" \
  --endpoint "$ENDPOINT" \
  --private-key "$PRIVATE_KEY" \
  --priority-fees "$PRIORITY_FEES" \
  --broadcast \
  --yes
echo "Subscription deploy complete"

echo ""
echo "=== Deploying access_pass_v1_xwnxp.aleo ==="
cd "$SCRIPT_DIR/access_pass"
leo deploy \
  --network "$NETWORK" \
  --endpoint "$ENDPOINT" \
  --private-key "$PRIVATE_KEY" \
  --priority-fees "$PRIORITY_FEES" \
  --broadcast \
  --yes
echo "Access pass deploy complete"

echo ""
echo "=== Both contracts deployed successfully! ==="
