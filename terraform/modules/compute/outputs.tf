output "instance_id" {
  value = alicloud_instance.livekit.id
}

output "private_ip" {
  value = alicloud_instance.livekit.private_ip
}

output "key_pair_name" {
  value = alicloud_ecs_key_pair.this.key_pair_name
}
