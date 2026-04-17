#!/bin/bash
set -e

EIP=$(terraform output -raw eip_address 2>/dev/null || echo "$1")
VERSION=${2:-"latest"}

echo "Upgrading LiveKit on $EIP to version $VERSION..."
ssh "root@$EIP" << EOF
  cd /opt/livekit
  sed -i "s|livekit/livekit-server:.*|livekit/livekit-server:$VERSION|" docker-compose.yaml
  docker compose pull
  docker compose up -d
  sleep 5
  docker compose ps
  docker compose logs --tail=20 livekit
EOF
echo "Upgrade complete."
