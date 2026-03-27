#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  source "${ROOT_DIR}/.env"
  set +a
fi

: "${PRIVATE_KEY:?PRIVATE_KEY is required}"
NETWORK="${NETWORK:-testnet}"
ENDPOINT="${ENDPOINT:-https://api.explorer.provable.com/v1}"
PRIORITY_FEES="${PRIORITY_FEES:-0}"

DEFAULT_PROGRAMS=("subscription" "ppv" "creator_registry" "access_pass" "tip" "payment_proof")
PROGRAMS=("$@")

if [[ ${#PROGRAMS[@]} -eq 0 ]]; then
  PROGRAMS=("${DEFAULT_PROGRAMS[@]}")
fi

for program in "${PROGRAMS[@]}"; do
  if [[ ! -d "${ROOT_DIR}/${program}" ]]; then
    echo "Unknown program directory: ${program}" >&2
    exit 1
  fi
done

echo "Compiling Leo programs..."
for program in "${PROGRAMS[@]}"; do
  echo " - ${program}"
  (
    cd "${ROOT_DIR}/${program}"
    leo build
  )
done

echo "Deploying Leo programs to ${NETWORK} (${ENDPOINT})..."
for program in "${PROGRAMS[@]}"; do
  echo " - ${program}"
  (
    cd "${ROOT_DIR}/${program}"
    leo deploy \
      --network "${NETWORK}" \
      --endpoint "${ENDPOINT}" \
      --private-key "${PRIVATE_KEY}" \
      --priority-fees "${PRIORITY_FEES}" \
      --broadcast \
      --yes
  )
done

echo "All contracts compiled and deployment transactions broadcasted."
