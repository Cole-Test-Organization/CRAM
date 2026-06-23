variable "region" {
  description = "AWS region for the Windows endpoint."
  type        = string
}

variable "project_name" {
  description = "Name prefix applied to every AWS resource."
  type        = string
}

variable "hostname" {
  description = "Endpoint hostname and Name tag."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the dedicated endpoint VPC."
  type        = string
}

variable "network_mode" {
  description = "Network placement mode. managed creates a dedicated VPC/subnet; existing attaches to vpc_id/subnet_id."
  type        = string
  default     = "managed"

  validation {
    condition     = contains(["managed", "existing"], var.network_mode)
    error_message = "network_mode must be managed or existing."
  }
}

variable "vpc_id" {
  description = "Optional existing VPC ID for shared-network endpoint deployments."
  type        = string
  default     = null
}

variable "subnet_cidr" {
  description = "Optional CIDR block for the public endpoint subnet. Defaults to cidrsubnet(vpc_cidr, 8, 30)."
  type        = string
  default     = null
}

variable "subnet_id" {
  description = "Optional existing subnet ID for shared-network endpoint deployments."
  type        = string
  default     = null
}

variable "availability_zone_index" {
  description = "Index into available AZs for this endpoint."
  type        = number
  default     = 0
}

variable "allowed_source_cidrs" {
  description = "LAN/admin CIDRs allowed to reach optional RDP/WinRM access."
  type        = list(string)
}

variable "admin_public_key" {
  description = "Public key material for the EC2 key pair associated with the Windows endpoint."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type for the Windows endpoint."
  type        = string
  default     = "m5.large"
}

variable "root_volume_gb" {
  description = "Windows root volume size."
  type        = number
  default     = 128
}

variable "associate_public_ip" {
  description = "Assign a public IP to the endpoint NIC for internet bootstrap access."
  type        = bool
  default     = true
}

variable "enable_winrm" {
  description = "Allow WinRM HTTP/HTTPS from allowed_source_cidrs."
  type        = bool
  default     = false
}

variable "enable_ssm" {
  description = "Attach an IAM role with AmazonSSMManagedInstanceCore."
  type        = bool
  default     = true
}

variable "bootstrap_method" {
  description = "How Koi bootstrap runs after launch. ssm is preferred for the AWS Windows Server endpoint."
  type        = string
  default     = "ssm"

  validation {
    condition     = contains(["ssm", "user_data"], var.bootstrap_method)
    error_message = "bootstrap_method must be ssm or user_data."
  }
}

variable "bootstrap_timeout_seconds" {
  description = "Seconds to wait for the SSM Koi bootstrap association to report success."
  type        = number
  default     = 1800
}

variable "admin_password" {
  description = "Optional password to set for the local Windows admin login."
  type        = string
  default     = ""
  sensitive   = true
}

variable "admin_username" {
  description = "Local Windows admin login to create or update for RDP access."
  type        = string
  default     = "Administrator"

  validation {
    condition     = length(var.admin_username) > 0 && length(var.admin_username) <= 20
    error_message = "admin_username must be 1-20 characters for Windows local account compatibility."
  }
}

variable "install_ssm_agent" {
  description = "Install or start the Amazon SSM Agent during first boot."
  type        = bool
  default     = true
}

variable "install_python" {
  description = "Install Python during first boot if python.exe is not already available."
  type        = bool
  default     = true
}

variable "python_install_url" {
  description = "Python for Windows installer URL used when install_python is true."
  type        = string
  default     = "https://www.python.org/ftp/python/3.14.5/python-3.14.5-amd64.exe"
}

variable "koi_script_inline" {
  description = "Inline Koi Python script body. The broker normally derives this from resource.koi.scriptPath."
  type        = string
  default     = ""
  sensitive   = true
}

variable "koi_script_sha256" {
  description = "Optional expected SHA-256 hash for the Koi Python script."
  type        = string
  default     = ""
}

variable "koi_arguments" {
  description = "Arguments passed to the Koi Python script."
  type        = list(string)
  default     = []
}

variable "koi_environment" {
  description = "Environment variables exposed only to the Koi script process. Avoid secrets because bootstrap content is stored in Terraform state."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "applications" {
  description = "Expanded Windows application install plan from selected app profiles."
  type        = any
  default     = []
  sensitive   = true
}
