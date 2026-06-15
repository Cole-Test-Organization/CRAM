variable "region" {
  description = "AWS region for the VM-Series firewall building block."
  type        = string
}

variable "project_name" {
  description = "Name prefix applied to every AWS resource."
  type        = string
}

variable "hostname" {
  description = "PAN-OS hostname and Name tag suffix for the firewall instance."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the dedicated firewall VPC."
  type        = string
}

variable "vpc_id" {
  description = "Optional existing VPC ID. When all subnet IDs are set, the firewall consumes shared network resources instead of creating a dedicated VPC."
  type        = string
  default     = null
}

variable "management_subnet_cidr" {
  description = "Optional CIDR block for the public management subnet. Defaults to cidrsubnet(vpc_cidr, 8, 0)."
  type        = string
  default     = null
}

variable "management_subnet_id" {
  description = "Optional existing management subnet ID."
  type        = string
  default     = null
}

variable "untrust_subnet_cidr" {
  description = "Optional CIDR block for the public untrust subnet. Defaults to cidrsubnet(vpc_cidr, 8, 10)."
  type        = string
  default     = null
}

variable "untrust_subnet_id" {
  description = "Optional existing untrust subnet ID."
  type        = string
  default     = null
}

variable "trust_subnet_cidr" {
  description = "Optional CIDR block for the private trust subnet. Defaults to cidrsubnet(vpc_cidr, 8, 20)."
  type        = string
  default     = null
}

variable "trust_subnet_id" {
  description = "Optional existing trust subnet ID."
  type        = string
  default     = null
}

variable "availability_zone_index" {
  description = "Index into available AZs for this firewall."
  type        = number
  default     = 0
}

variable "allowed_source_cidrs" {
  description = "LAN/admin CIDRs allowed to reach firewall management."
  type        = list(string)
}

variable "ssh_public_key" {
  description = "SSH public key contents for the EC2 key pair."
  type        = string
}

variable "panos_version_major" {
  description = "PAN-OS major.minor used to filter the VM-Series Marketplace AMI."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type for VM-Series."
  type        = string
  default     = "m5.xlarge"

  validation {
    condition     = contains(["m5.xlarge", "m5n.xlarge", "c5.xlarge", "c5n.xlarge"], var.instance_type)
    error_message = "Must be a 4-vCPU VM-Series-supported instance type: m5.xlarge, m5n.xlarge, c5.xlarge, or c5n.xlarge."
  }
}

variable "root_volume_gb" {
  description = "VM-Series root volume size."
  type        = number
  default     = 60
}

variable "dns_primary" {
  description = "Primary DNS for PAN-OS bootstrap."
  type        = string
  default     = "8.8.8.8"
}

variable "dns_secondary" {
  description = "Secondary DNS for PAN-OS bootstrap."
  type        = string
  default     = "8.8.4.4"
}

variable "auth_code" {
  description = "PAN-OS VM-Series auth code for first-boot licensing."
  type        = string
  sensitive   = true
}

variable "management_server_mode" {
  description = "Management server bootstrap mode: panorama, scm, or none."
  type        = string
  default     = "panorama"

  validation {
    condition     = contains(["panorama", "scm", "none"], var.management_server_mode)
    error_message = "management_server_mode must be panorama, scm, or none."
  }
}

variable "panorama_server" {
  description = "Panorama server address for bootstrap when management_server_mode is panorama."
  type        = string
  default     = ""
}

variable "panorama_server2" {
  description = "Optional secondary Panorama server address for bootstrap."
  type        = string
  default     = ""
}

variable "vm_auth_key" {
  description = "Panorama VM auth key for bootstrap when management_server_mode is panorama."
  type        = string
  default     = ""
  sensitive   = true
}

variable "device_cert_pin_id" {
  description = "Optional CSP device certificate registration PIN ID."
  type        = string
  default     = ""
  sensitive   = true
}

variable "device_cert_pin_value" {
  description = "Optional CSP device certificate registration PIN value."
  type        = string
  default     = ""
  sensitive   = true
}

variable "role" {
  description = "Firewall role recorded in inventory and outputs."
  type        = string
  default     = "gateway"
}

variable "attach_management_elastic_ip" {
  description = "Attach an Elastic IP to the management interface."
  type        = bool
  default     = true
}

variable "attach_untrust_elastic_ip" {
  description = "Attach an Elastic IP to the untrust interface."
  type        = bool
  default     = true
}
