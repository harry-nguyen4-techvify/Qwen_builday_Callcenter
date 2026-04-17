output "vpc_id" {
  value = alicloud_vpc.this.id
}

output "vswitch_id" {
  value = alicloud_vswitch.public.id
}

output "sg_id" {
  value = alicloud_security_group.livekit.id
}

output "eip_id" {
  value = alicloud_eip_address.livekit.id
}

output "eip_address" {
  value = alicloud_eip_address.livekit.ip_address
}
