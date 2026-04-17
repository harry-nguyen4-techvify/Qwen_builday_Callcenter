# LiveKit on Alibaba Cloud (Bangkok) - Terraform Deployment

Deploy a self-hosted LiveKit server on Alibaba Cloud ECS (Bangkok `ap-southeast-7`) using Terraform. Single shared VM running Docker Compose stack: LiveKit server, Caddy (auto TLS + TURN), and Redis.

Supports two DNS modes:
- **sslip.io (default)**: No domain needed. Auto-generates domains like `livekit.47-95-1-2.sslip.io` from the EIP. Free, instant, perfect for dev/test.
- **Custom domain**: Use your own domain managed by Alibaba Cloud DNS. Recommended for production.

## Architecture

```
Internet
    |
    +-- DNS: livekit.yourdomain.com / turn.yourdomain.com
    |         |
    |         v
    +-- EIP (static public IP)
              |
        ECS Instance (ecs.c7.xlarge, 4vCPU/8GB)
              |-- Docker Compose:
              |     |-- livekit/livekit-server  (port 7880, 50000-60000/UDP)
              |     |-- livekit/caddyl4         (port 443, 80, 3478/UDP - auto TLS)
              |     +-- redis:7-alpine          (localhost:6379)
              |-- Security Group (firewall)
              +-- VPC (10.0.0.0/16)
```

## Prerequisites

| Requirement | Description |
|-------------|-------------|
| Terraform | >= 1.5.0 ([Download](https://developer.hashicorp.com/terraform/downloads)) |
| Alibaba Cloud Account | With billing enabled |
| Domain | Optional. Uses sslip.io if not provided |
| SSH Key Pair | For server access |

## Step 1: Install Terraform

**Windows (Chocolatey):**
```bash
choco install terraform
```

**Windows (Scoop):**
```bash
scoop install terraform
```

**Manual:** Download from https://developer.hashicorp.com/terraform/downloads

Verify:
```bash
terraform --version
```

## Step 2: Create Alibaba Cloud Access Key

1. Login to [Alibaba Cloud Console](https://www.alibabacloud.com/)
2. Go to **RAM Console** > **Users** > **Create User**
3. Enable **Programmatic Access** (OpenAPI AccessKey)
4. Attach these policies to the user:
   - `AliyunECSFullAccess`
   - `AliyunVPCFullAccess`
   - `AliyunEIPFullAccess`
   - `AliyunDNSFullAccess`
5. Save the **AccessKey ID** and **AccessKey Secret** (shown only once)

## Step 3: Set Environment Variables

**Linux / macOS / Git Bash:**
```bash
export ALICLOUD_ACCESS_KEY="your-access-key-id"
export ALICLOUD_SECRET_KEY="your-access-key-secret"
```

**Windows PowerShell:**
```powershell
$env:ALICLOUD_ACCESS_KEY = "your-access-key-id"
$env:ALICLOUD_SECRET_KEY = "your-access-key-secret"
```

**Windows CMD:**
```cmd
set ALICLOUD_ACCESS_KEY=your-access-key-id
set ALICLOUD_SECRET_KEY=your-access-key-secret
```

> Never commit access keys to git. Use environment variables only.

## Step 4: Generate SSH Key Pair

```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/livekit-key -N ""
```

This creates:
- `~/.ssh/livekit-key` (private key - keep safe)
- `~/.ssh/livekit-key.pub` (public key - used by Terraform)

## Step 5: Domain Setup (OPTIONAL)

### Option A: No domain (sslip.io - default)

Skip this step entirely. Terraform will auto-generate domains using sslip.io:
- `livekit.<your-eip>.sslip.io`
- `turn.<your-eip>.sslip.io`

sslip.io is a free DNS service. It only handles DNS resolution (one-time, cached). All media/video/audio traffic goes directly to your server IP. Zero latency impact.

### Option B: Custom domain

1. Go to [Alibaba Cloud DNS Console](https://dns.console.aliyun.com/)
2. Add your domain (e.g., `yourdomain.com`)
3. If domain is registered elsewhere (Namecheap, GoDaddy, etc.), update nameservers to:
   ```
   ns1.alidns.com
   ns2.alidns.com
   ```
4. Wait for DNS propagation (up to 48 hours for nameserver changes)
5. Set `domain_name` in your `terraform.tfvars`

## Step 6: Generate LiveKit API Key & Secret

```bash
# Generate API key (prefix with "API" for readability)
echo "API$(openssl rand -hex 16)"

# Generate API secret
openssl rand -hex 32
```

Save both values - you'll need them in the next step.

## Step 7: Configure terraform.tfvars

```bash
cd terraform/environments/dev
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your values:

**sslip.io mode (no domain):**
```hcl
region              = "ap-southeast-7"
environment         = "dev"
# domain_name is empty by default -> uses sslip.io
livekit_subdomain   = "livekit"
turn_subdomain      = "turn"
livekit_api_key     = "APIxxxxxxxxxxxxx"        # From Step 6
livekit_api_secret  = "xxxxxxxxxxxxxxxx"        # From Step 6
instance_type       = "ecs.c7.xlarge"
image_id            = "ubuntu_22_04_x64_20G_alibase_20240101.vhd"
ssh_public_key_path = "~/.ssh/livekit-key.pub"
eip_bandwidth       = 5
```

**Custom domain mode:**
```hcl
region              = "ap-southeast-7"
environment         = "dev"
domain_name         = "yourdomain.com"          # Your domain
livekit_subdomain   = "livekit"
turn_subdomain      = "turn"
livekit_api_key     = "APIxxxxxxxxxxxxx"
livekit_api_secret  = "xxxxxxxxxxxxxxxx"
instance_type       = "ecs.c7.xlarge"
image_id            = "ubuntu_22_04_x64_20G_alibase_20240101.vhd"
ssh_public_key_path = "~/.ssh/livekit-key.pub"
eip_bandwidth       = 5
```

### Find the correct image ID for Bangkok region

```bash
# After terraform init, or use Alibaba Cloud CLI:
aliyun ecs DescribeImages \
  --RegionId ap-southeast-7 \
  --OSType linux \
  --ImageOwnerAlias system \
  --ImageName "ubuntu_22_04*"
```

Or check the [ECS Image List](https://ecs.console.aliyun.com/#/image/region/ap-southeast-7/systemImageList) in the console.

## Step 8: Deploy

```bash
cd terraform/environments/dev

# Initialize Terraform (downloads provider)
terraform init

# Preview changes
terraform plan

# Deploy (type "yes" to confirm)
terraform apply
```

Expected output after `terraform apply`:
```
Apply complete! Resources: 13 added, 0 changed, 0 destroyed.

Outputs:

dns_mode            = "sslip.io (free, no domain required)"
eip_address         = "47.xx.xx.xx"
instance_id         = "i-t4nxxxxxxxxxx"
livekit_api_endpoint = "https://livekit.47-95-1-2.sslip.io"
livekit_url         = "wss://livekit.47-95-1-2.sslip.io"
redis_endpoint      = "localhost:6379 (Docker Compose)"
ssh_command         = "ssh -i ~/.ssh/livekit-key.pub root@47.xx.xx.xx"
turn_domain         = "turn.47-95-1-2.sslip.io"
```

## Step 9: Wait & Verify

Cloud-init takes **3-5 minutes** to install Docker and start the LiveKit stack.

```bash
# View outputs
terraform output

# SSH into server
ssh -i ~/.ssh/livekit-key root@$(terraform output -raw eip_address)

# Check Docker containers are running
docker ps

# Expected output:
# NAMES     STATUS
# caddy     Up 2 minutes
# livekit   Up 2 minutes
# redis     Up 2 minutes

# Check logs
cd /opt/livekit
docker compose logs

# Check TLS certificate (look for "certificate obtained successfully")
docker compose logs caddy | grep -i cert

# Check LiveKit is responding
curl -s https://livekit.yourdomain.com
```

### DNS verification script

```bash
bash scripts/verify-dns.sh livekit.yourdomain.com $(terraform output -raw eip_address)
bash scripts/verify-dns.sh turn.yourdomain.com $(terraform output -raw eip_address)
```

## Connect from Client

> If using sslip.io, your URLs will look like `wss://livekit.47-95-1-2.sslip.io`

Use these values in your LiveKit client application:

| Parameter | Value |
|-----------|-------|
| WebSocket URL | `wss://livekit.yourdomain.com` |
| API Endpoint | `https://livekit.yourdomain.com` |
| API Key | (from your terraform.tfvars) |
| API Secret | (from your terraform.tfvars) |

### Quick test with LiveKit CLI

```bash
# Install livekit-cli
# https://github.com/livekit/livekit-cli

# Create a token
livekit-cli create-token \
  --api-key YOUR_API_KEY \
  --api-secret YOUR_API_SECRET \
  --join --room test-room --identity user1

# Test connection
livekit-cli join-room \
  --url wss://livekit.yourdomain.com \
  --api-key YOUR_API_KEY \
  --api-secret YOUR_API_SECRET \
  --room test-room \
  --identity user1
```

## Operations

### Upgrade LiveKit version

```bash
bash scripts/upgrade.sh                    # upgrade to latest
bash scripts/upgrade.sh <EIP> v1.7.0      # upgrade to specific version
```

### Backup config

```bash
bash scripts/backup-config.sh
```

### Restart services

```bash
ssh -i ~/.ssh/livekit-key root@<EIP>
cd /opt/livekit
docker compose restart
```

### View logs

```bash
ssh -i ~/.ssh/livekit-key root@<EIP>
cd /opt/livekit
docker compose logs -f            # all services
docker compose logs -f livekit    # livekit only
```

### Destroy infrastructure

```bash
cd terraform/environments/dev
terraform destroy    # type "yes" to confirm
```

## Ports Reference

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH access |
| 80 | TCP | TLS certificate issuance (Let's Encrypt) |
| 443 | TCP/UDP | HTTPS + TURN/TLS |
| 3478 | UDP | TURN/STUN |
| 7880 | TCP | LiveKit API / WebSocket |
| 7881 | TCP | WebRTC TCP fallback |
| 50000-60000 | UDP | WebRTC media (ICE) |

## Cost Estimate

| Resource | Monthly Cost |
|----------|-------------|
| ECS c7.xlarge (4 vCPU / 8GB RAM) | ~$144 |
| ESSD System Disk 40GB | ~$4 |
| EIP 5Mbps (PayByTraffic) | ~$10-50 |
| Domain (sslip.io) | Free |
| Alibaba Cloud DNS (custom domain) | Free |
| Redis (Docker on same VM) | $0 |
| **Total** | **~$160-200** |

> Bandwidth cost depends on usage. Increase `eip_bandwidth` for heavy media workloads.

## Project Structure

```
terraform/
  environments/
    dev/
      main.tf                  # Root module (wires all child modules)
      variables.tf             # Input variables
      outputs.tf               # Deployment outputs
      versions.tf              # Provider configuration
      backend.tf               # Remote state (commented out)
      terraform.tfvars.example # Example config
  modules/
    network/                   # VPC, vSwitch, Security Group, EIP
    compute/                   # ECS instance, key pair, cloud-init
    dns/                       # Alidns A records
    lb/                        # NLB (optional, for production)
  templates/
    livekit.yaml.tpl           # LiveKit server config
    docker-compose.yaml.tpl    # Docker Compose stack
    caddy.yaml.tpl             # Caddy L4 reverse proxy
    redis.conf.tpl             # Redis config
    cloud-init.yaml.tpl        # VM bootstrap script
  scripts/
    smoke-test.sh              # Post-deploy verification
    verify-dns.sh              # DNS resolution check
    upgrade.sh                 # LiveKit version upgrade
    backup-config.sh           # Config backup
  .gitignore
```

## Troubleshooting

### TLS certificate not provisioning
- Verify DNS resolves: `host livekit.yourdomain.com`
- Check port 80 is open in security group
- Check Caddy logs: `docker compose logs caddy`
- Wait a few minutes and retry

### Docker containers not starting
```bash
ssh root@<EIP>
systemctl status livekit-docker
cat /var/log/cloud-init-output.log    # check cloud-init logs
cd /opt/livekit && docker compose up  # run manually to see errors
```

### Cannot connect via WebSocket
- Ensure port 443 (TCP) is open
- Verify TLS cert is valid: `curl -v https://livekit.yourdomain.com`
- Check LiveKit logs: `docker compose logs livekit`

### WebRTC media not flowing
- Ensure UDP ports 50000-60000 are open in security group
- Ensure TURN is working: check port 3478/UDP and 443/UDP
- Verify EIP is correctly associated: `terraform output eip_address`
