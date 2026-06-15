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
  description = "Optional existing VPC ID. When set with subnet_id, the module consumes shared network resources instead of creating a dedicated VPC."
  type        = string
  default     = null
}

variable "subnet_cidr" {
  description = "CIDR block for the public Panorama management subnet."
  type        = string
}

variable "subnet_id" {
  description = "Optional existing Panorama management subnet ID."
  type        = string
  default     = null
}

variable "availability_zone" {
  description = "Availability zone for the single Panorama instance."
  type        = string
}

variable "allowed_source_cidrs" {
  description = "LAN/admin CIDRs allowed to reach Panorama management. No public GP ingress is added by this module."
  type        = list(string)

  validation {
    condition     = length(var.allowed_source_cidrs) > 0
    error_message = "At least one allowed_source_cidrs entry is required."
  }
}

variable "ssh_public_key" {
  description = "SSH public key contents for the EC2 key pair."
  type        = string
}

variable "panos_version_major" {
  description = "PAN-OS major.minor used to filter the Panorama Marketplace AMI, for example 11.2."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type for Panorama. Management Only mode requires at least 16 vCPUs and 64 GiB RAM."
  type        = string
  default     = "m5.4xlarge"

  validation {
    condition     = contains(["m5.4xlarge"], var.instance_type)
    error_message = "Panorama instance_type must be m5.4xlarge for this AWS lab profile."
  }
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
  description = "Panorama logging disk size. AWS Panorama logging disks must be 2048 GiB or another multiple of 2048 GiB."
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
