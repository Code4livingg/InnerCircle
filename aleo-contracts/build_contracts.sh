#!/bin/bash
export PATH="/home/ankur/.cargo/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=== Cleaning and rebuilding PPV ==="
cd "$SCRIPT_DIR/ppv"
rm -rf build
leo build 2>&1
echo "PPV EXIT: $?"

echo ""
echo "=== Cleaning and rebuilding subscription ==="
cd "$SCRIPT_DIR/subscription"
rm -rf build
leo build 2>&1
echo "Subscription EXIT: $?"

echo ""
echo "=== Cleaning and rebuilding access_pass ==="
cd "$SCRIPT_DIR/access_pass"
rm -rf build
leo build 2>&1
echo "Access pass EXIT: $?"

echo ""
echo "=== Cleaning and rebuilding tip ==="
cd "$SCRIPT_DIR/tip"
rm -rf build
leo build 2>&1
echo "Tip EXIT: $?"

echo ""
echo "=== Cleaning and rebuilding payment_proof ==="
cd "$SCRIPT_DIR/payment_proof"
rm -rf build
leo build 2>&1
echo "Payment proof EXIT: $?"
