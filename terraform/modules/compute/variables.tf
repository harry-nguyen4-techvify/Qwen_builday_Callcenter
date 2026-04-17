variable "image_id" {
  type        = string
  description = "ECS image ID"
}

variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "instance_type" {
  type    = string
  default = "ecs.c6.xlarge"
}

variable "system_disk_size" {
  type    = number
  default = 40
}

variable "vswitch_id" {
  type = string
}

variable "sg_id" {
  type = string
}

variable "eip_id" {
  type = string
}

variable "ssh_public_key" {
  type = string
}

variable "domain" {
  type        = string
  description = "e.g. livekit.example.com"
}

variable "turn_domain" {
  type        = string
  description = "e.g. turn.example.com"
}

variable "eip_address" {
  type        = string
  description = "Public IP for config templates"
}

variable "livekit_api_key" {
  type      = string
  sensitive = true
}

variable "livekit_api_secret" {
  type      = string
  sensitive = true
}

variable "ssh_private_key_path" {
  type        = string
  description = "Path to SSH private key for provisioning"
}
