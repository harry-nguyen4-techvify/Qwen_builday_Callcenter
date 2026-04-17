resource "alicloud_alidns_record" "livekit" {
  domain_name = var.domain_name
  rr          = var.livekit_subdomain
  type        = "A"
  value       = var.eip_address
  ttl         = var.ttl
}

resource "alicloud_alidns_record" "turn" {
  domain_name = var.domain_name
  rr          = var.turn_subdomain
  type        = "A"
  value       = var.eip_address
  ttl         = var.ttl
}
