output "livekit_fqdn" {
  value = "${var.livekit_subdomain}.${var.domain_name}"
}

output "turn_fqdn" {
  value = "${var.turn_subdomain}.${var.domain_name}"
}

output "livekit_record_id" {
  value = alicloud_alidns_record.livekit.id
}

output "turn_record_id" {
  value = alicloud_alidns_record.turn.id
}
