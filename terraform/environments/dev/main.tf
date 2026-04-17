# ============================================
# LiveKit on Alibaba Cloud - Singapore (ap-southeast-1)
# Single shared VM with Docker Compose stack
# Supports: custom domain (Alidns) or sslip.io (free, no domain needed)
# ============================================

data "alicloud_zones" "available" {
  available_instance_type     = var.instance_type
  available_resource_creation = "VSwitch"
}

locals {
  use_custom_domain = var.domain_name != ""
  eip_sslip         = "${replace(module.network.eip_address, ".", "-")}.sslip.io"
  livekit_domain    = local.use_custom_domain ? "${var.livekit_subdomain}.${var.domain_name}" : "${var.livekit_subdomain}.${local.eip_sslip}"
  turn_domain       = local.use_custom_domain ? "${var.turn_subdomain}.${var.domain_name}" : "${var.turn_subdomain}.${local.eip_sslip}"
}

module "network" {
  source            = "../../modules/network"
  project_name      = var.project_name
  environment       = var.environment
  vpc_cidr          = var.vpc_cidr
  vswitch_cidr      = var.vswitch_cidr
  availability_zone = data.alicloud_zones.available.zones[0].id
  allowed_ssh_cidrs = var.allowed_ssh_cidrs
  eip_bandwidth     = var.eip_bandwidth
}

module "dns" {
  source            = "../../modules/dns"
  count             = local.use_custom_domain ? 1 : 0
  domain_name       = var.domain_name
  livekit_subdomain = var.livekit_subdomain
  turn_subdomain    = var.turn_subdomain
  eip_address       = module.network.eip_address
}

module "compute" {
  source             = "../../modules/compute"
  project_name       = var.project_name
  environment        = var.environment
  image_id           = var.image_id
  instance_type      = var.instance_type
  system_disk_size   = var.system_disk_size
  vswitch_id         = module.network.vswitch_id
  sg_id              = module.network.sg_id
  eip_id             = module.network.eip_id
  eip_address        = module.network.eip_address
  ssh_public_key     = file(var.ssh_public_key_path)
  domain             = local.livekit_domain
  turn_domain        = local.turn_domain
  livekit_api_key      = var.livekit_api_key
  livekit_api_secret   = var.livekit_api_secret
  ssh_private_key_path = var.ssh_private_key_path

  depends_on = [module.dns]
}
