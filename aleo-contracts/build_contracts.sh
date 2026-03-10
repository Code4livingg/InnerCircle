#!/bin/bash
export PATH="/home/ankur/.cargo/bin:$PATH"
echo "=== Cleaning and rebuilding PPV ==="
cd /mnt/c/Users/ankur/OneDrive/Desktop/OnlyAleo/aleo-contracts/ppv
rm -rf build
leo build 2>&1
echo "PPV EXIT: $?"

echo ""
echo "=== Cleaning and rebuilding subscription ==="
cd /mnt/c/Users/ankur/OneDrive/Desktop/OnlyAleo/aleo-contracts/subscription
rm -rf build
leo build 2>&1
echo "Subscription EXIT: $?"
