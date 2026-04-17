#!/bin/bash
set -e

EIP=$(terraform output -raw eip_address 2>/dev/null || echo "$1")
BACKUP_DIR="./backups/$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
echo "Backing up LiveKit config from $EIP to $BACKUP_DIR..."

scp "root@$EIP:/opt/livekit/docker-compose.yaml" "$BACKUP_DIR/"
scp "root@$EIP:/opt/livekit/livekit.yaml" "$BACKUP_DIR/"
scp "root@$EIP:/opt/livekit/caddy.yaml" "$BACKUP_DIR/"
scp "root@$EIP:/opt/livekit/redis.conf" "$BACKUP_DIR/"

echo "Backup saved to $BACKUP_DIR"
ls -la "$BACKUP_DIR"
