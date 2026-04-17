#!/bin/bash
set -e

EIP=$(terraform output -raw eip_address)
DOMAIN=$(terraform output -raw livekit_url | sed 's|wss://||')

echo "=== LiveKit Deployment Smoke Test ==="

echo "[1/5] Checking DNS..."
RESOLVED=$(host "$DOMAIN" | grep -oP '(\d+\.){3}\d+' | head -1)
[ "$RESOLVED" = "$EIP" ] && echo "  PASS: DNS resolves correctly" || { echo "  FAIL: DNS mismatch"; exit 1; }

echo "[2/5] Checking SSH..."
ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no "root@$EIP" "echo ok" > /dev/null 2>&1 \
  && echo "  PASS: SSH accessible" || echo "  WARN: SSH not accessible (may need key)"

echo "[3/5] Checking HTTPS..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN" 2>/dev/null || echo "000")
[ "$HTTP_CODE" != "000" ] && echo "  PASS: HTTPS responding ($HTTP_CODE)" || echo "  WARN: HTTPS not ready yet"

echo "[4/5] Checking LiveKit API..."
API_RESP=$(curl -s "https://$DOMAIN/rtc/validate" 2>/dev/null || echo "error")
echo "  Response: $API_RESP"

echo "[5/5] Checking containers (via SSH)..."
ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no "root@$EIP" \
  "docker ps --format 'table {{.Names}}\t{{.Status}}'" 2>/dev/null || echo "  WARN: Cannot check containers"

echo "=== Smoke test complete ==="
