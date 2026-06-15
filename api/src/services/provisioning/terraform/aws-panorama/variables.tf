variable "region" {
  description = "AWS region for the Panorama building block."
  type        = string
}

variable "project_name" {
  description = "Name prefix applied to every AWS resource."
  type        = string
}

variable "hostname" {
  description = "Hostname and Name tag for the Panorama instance."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the dedicated Panorama VPC."
  type        = string
}

variable "vpc_id" {
  description = "Optional existing VPC ID for shared-network deployments."
  type        = string
  default     = null
}

variable "subnet_cidr" {
  description = "Optional CIDR block for the public Panorama management subnet. Defaults to cidrsubnet(vpc_cidr, 8, 30), matching the GP lab."
  type        = string
  default     = null
}

variable "subnet_id" {
  description = "Optional existing Panorama management subnet ID for shared-network deployments."
  type        = string
  default     = null
}

variable "availability_zone_index" {
  description = "Index into available AZs for this single Panorama instance."
  type        = number
  default     = 0
}

variable "allowed_source_cidrs" {
  description = "LAN/admin CIDRs allowed to reach Panorama management."
  type        = list(string)
}

variable "ssh_public_key" {
  description = "SSH public key contents for the EC2 key pair."
  type        = string
}

variable "panos_version_major" {
  description = "PAN-OS major.minor used to filter the Panorama Marketplace AMI."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type for Panorama."
  type        = string
  default     = "m5.4xlarge"
}

variable "root_volume_gb" {
  description = "Panorama root/system volume size. Panorama AWS images expect the default 81 GiB system disk on first boot."
  type        = number
  default     = 81

  validation {
    condition     = var.root_volume_gb == 81
    error_message = "root_volume_gb must be 81 GiB for the initial Panorama AWS boot."
  }
}

variable "log_volume_gb" {
  description = "Panorama logging disk size. This is the 2 TiB Panorama logging disk."
  type        = number
  default     = 2048

  validation {
    condition     = var.log_volume_gb >= 2048 && var.log_volume_gb % 2048 == 0
    error_message = "log_volume_gb must be at least 2048 GiB and divisible by 2048."
  }
}

variable "log_volume_device_name" {
  description = "AWS device name for the Panorama logging disk."
  type        = string
  default     = "/dev/sdf"
}

variable "dns_primary" {
  description = "Primary DNS value recorded for downstream bootstrap automation."
  type        = string
  default     = "8.8.8.8"
}

variable "dns_secondary" {
  description = "Secondary DNS value recorded for downstream bootstrap automation."
  type        = string
  default     = "8.8.4.4"
}

variable "serial" {
  description = "Optional pre-provisioned Panorama serial surfaced in automation outputs."
  type        = string
  default     = null
  sensitive   = true
}
