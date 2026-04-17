variable "image_id" {
  description = "ECS image ID (find in Alibaba Cloud console)"
  type        = string
}

variable "region" {
  description = "Alibaba Cloud region"
  type        = string
  default     = "ap-southeast-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "livekit"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "vswitch_cidr" {
  description = "CIDR block for the vSwitch"
  type        = string
  default     = "10.0.1.0/24"
}

variable "availability_zone" {
  description = "Availability zone"
  type        = string
  default     = "ap-southeast-1b"
}

variable "instance_type" {
  description = "ECS instance type"
  type        = string
  default     = "ecs.hfc9i.xlarge"
}

variable "system_disk_size" {
  description = "System disk size in GB"
  type        = number
  default     = 40
}

variable "domain_name" {
  description = "Base domain e.g. example.com. Leave empty to use sslip.io (free, no domain needed)"
  type        = string
  default     = ""
}

variable "livekit_subdomain" {
  description = "Subdomain for LiveKit server"
  type        = string
  default     = "livekit"
}

variable "turn_subdomain" {
  description = "Subdomain for TURN server"
  type        = string
  default     = "turn"
}

variable "livekit_api_key" {
  description = "LiveKit API key"
  type        = string
  sensitive   = true
}

variable "livekit_api_secret" {
  description = "LiveKit API secret"
  type        = string
  sensitive   = true
}

variable "ssh_public_key_path" {
  description = "Path to SSH public key"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "ssh_private_key_path" {
  description = "Path to SSH private key for provisioning"
  type        = string
  default     = "~/.ssh/id_rsa"
}

variable "allowed_ssh_cidrs" {
  description = "CIDR blocks allowed for SSH access"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enable_nlb" {
  description = "Enable Network Load Balancer"
  type        = bool
  default     = false
}

variable "eip_bandwidth" {
  description = "EIP bandwidth in Mbps"
  type        = number
  default     = 5
}
