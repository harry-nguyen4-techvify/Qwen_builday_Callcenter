output "ssh_command" {
  description = "SSH command to connect to LiveKit server"
  value       = "ssh -i ${var.ssh_public_key_path} root@${module.network.eip_address}"
}

output "livekit_url" {
  description = "LiveKit WebSocket URL for clients"
  value       = "wss://${local.livekit_domain}"
}

output "livekit_api_endpoint" {
  description = "LiveKit HTTP API endpoint"
  value       = "https://${local.livekit_domain}"
}

output "turn_domain" {
  description = "TURN server domain"
  value       = local.turn_domain
}

output "eip_address" {
  description = "Elastic IP address"
  value       = module.network.eip_address
}

output "instance_id" {
  description = "ECS instance ID"
  value       = module.compute.instance_id
}

output "dns_mode" {
  description = "DNS mode: custom domain or sslip.io"
  value       = local.use_custom_domain ? "Custom domain (${var.domain_name})" : "sslip.io (free, no domain required)"
}

output "redis_endpoint" {
  description = "Redis connection (self-hosted on same VM)"
  value       = "localhost:6379 (Docker Compose)"
}
