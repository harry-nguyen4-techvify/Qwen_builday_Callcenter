variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "vswitch_cidr" {
  type    = string
  default = "10.0.1.0/24"
}

variable "availability_zone" {
  type = string
}

variable "allowed_ssh_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}

variable "eip_bandwidth" {
  type    = number
  default = 5
}

variable "enable_rtmp" {
  type    = bool
  default = false
}

variable "enable_sip" {
  type    = bool
  default = false
}
