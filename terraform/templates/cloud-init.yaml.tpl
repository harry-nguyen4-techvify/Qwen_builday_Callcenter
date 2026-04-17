#!/bin/bash
set -euxo pipefail
exec > /var/log/livekit-setup.log 2>&1

# Install Docker (Alibaba Linux 3 is RHEL-based, get.docker.com doesn't support it)
dnf install -y dnf-utils
dnf config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable docker
systemctl start docker

# Create config directory
mkdir -p /opt/livekit

# Write config files
cat > /opt/livekit/docker-compose.yaml << 'COMPOSE_EOF'
${docker_compose_content}
COMPOSE_EOF

cat > /opt/livekit/livekit.yaml << 'LIVEKIT_EOF'
${livekit_config_content}
LIVEKIT_EOF

cat > /opt/livekit/caddy.yaml << 'CADDY_EOF'
${caddy_config_content}
CADDY_EOF

cat > /opt/livekit/redis.conf << 'REDIS_EOF'
${redis_config_content}
REDIS_EOF

# Create systemd service
cat > /etc/systemd/system/livekit-docker.service << 'SERVICE_EOF'
[Unit]
Description=LiveKit Docker Compose
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/livekit
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
SERVICE_EOF

# Start services
systemctl daemon-reload
systemctl enable livekit-docker
cd /opt/livekit && docker compose up -d

echo "LiveKit setup completed successfully"
