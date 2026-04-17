variable "domain_name" {
  type        = string
  description = "Base domain (e.g., example.com)"
}

variable "livekit_subdomain" {
  type    = string
  default = "livekit"
}

variable "turn_subdomain" {
  type    = string
  default = "turn"
}

variable "eip_address" {
  type        = string
  description = "EIP public IP address"
}

variable "ttl" {
  type    = number
  default = 600
}
