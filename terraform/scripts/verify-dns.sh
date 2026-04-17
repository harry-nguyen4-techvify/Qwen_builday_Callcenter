#!/bin/bash
set -e
DOMAIN=$1
EIP=$2
echo "Checking DNS resolution for $DOMAIN..."
RESOLVED=$(host "$DOMAIN" | grep -oP '(\d+\.){3}\d+' | head -1)
if [ "$RESOLVED" = "$EIP" ]; then
  echo "OK: $DOMAIN resolves to $EIP"
else
  echo "FAIL: $DOMAIN resolves to $RESOLVED (expected $EIP)"
  exit 1
fi
