locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }

  security_rules = merge(
    {
      ssh = {
        ip_protocol = "tcp"
        port_range  = "22/22"
        cidr_ip     = join(",", var.allowed_ssh_cidrs)
        description = "SSH access"
      }
      http = {
        ip_protocol = "tcp"
        port_range  = "80/80"
        cidr_ip     = "0.0.0.0/0"
        description = "HTTP - certificate issuance"
      }
      https_tcp = {
        ip_protocol = "tcp"
        port_range  = "443/443"
        cidr_ip     = "0.0.0.0/0"
        description = "HTTPS + TURN TLS"
      }
      https_udp = {
        ip_protocol = "udp"
        port_range  = "443/443"
        cidr_ip     = "0.0.0.0/0"
        description = "TURN TLS UDP"
      }
      turn_udp = {
        ip_protocol = "udp"
        port_range  = "3478/3478"
        cidr_ip     = "0.0.0.0/0"
        description = "TURN/STUN"
      }
      api_ws = {
        ip_protocol = "tcp"
        port_range  = "7880/7880"
        cidr_ip     = "0.0.0.0/0"
        description = "LiveKit API/WebSocket"
      }
      webrtc_tcp = {
        ip_protocol = "tcp"
        port_range  = "7881/7881"
        cidr_ip     = "0.0.0.0/0"
        description = "WebRTC TCP fallback"
      }
      webrtc_udp = {
        ip_protocol = "udp"
        port_range  = "50000/60000"
        cidr_ip     = "0.0.0.0/0"
        description = "WebRTC media"
      }
    },
    var.enable_rtmp ? {
      rtmp = {
        ip_protocol = "tcp"
        port_range  = "1935/1935"
        cidr_ip     = "0.0.0.0/0"
        description = "RTMP ingress"
      }
    } : {},
    var.enable_sip ? {
      sip_tcp = {
        ip_protocol = "tcp"
        port_range  = "5060/5061"
        cidr_ip     = "0.0.0.0/0"
        description = "SIP TCP"
      }
      sip_udp = {
        ip_protocol = "udp"
        port_range  = "5060/5061"
        cidr_ip     = "0.0.0.0/0"
        description = "SIP UDP"
      }
    } : {}
  )
}

# ------------------------------------------------------------------------------
# VPC
# ------------------------------------------------------------------------------
resource "alicloud_vpc" "this" {
  vpc_name   = "${var.project_name}-${var.environment}-vpc"
  cidr_block = var.vpc_cidr
  tags       = local.tags
}

# ------------------------------------------------------------------------------
# VSwitch (public subnet)
# ------------------------------------------------------------------------------
resource "alicloud_vswitch" "public" {
  vpc_id            = alicloud_vpc.this.id
  vswitch_name      = "${var.project_name}-${var.environment}-public"
  cidr_block        = var.vswitch_cidr
  zone_id           = var.availability_zone
  tags              = local.tags
}

# ------------------------------------------------------------------------------
# Security Group
# ------------------------------------------------------------------------------
resource "alicloud_security_group" "livekit" {
  security_group_name = "${var.project_name}-${var.environment}-livekit-sg"
  vpc_id = alicloud_vpc.this.id
  tags   = local.tags
}

resource "alicloud_security_group_rule" "this" {
  for_each = local.security_rules

  type              = "ingress"
  security_group_id = alicloud_security_group.livekit.id
  ip_protocol       = each.value.ip_protocol
  port_range        = each.value.port_range
  cidr_ip           = each.value.cidr_ip
  description       = each.value.description
  nic_type          = "intranet"
}

# ------------------------------------------------------------------------------
# Elastic IP
# ------------------------------------------------------------------------------
resource "alicloud_eip_address" "livekit" {
  address_name         = "${var.project_name}-${var.environment}-livekit-eip"
  bandwidth            = var.eip_bandwidth
  internet_charge_type = "PayByTraffic"
  payment_type         = "PayAsYouGo"
  tags                 = local.tags
}

