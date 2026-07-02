variable "region" {
  description = "AWS region for the Ubuntu server."
  type        = string
}

variable "project_name" {
  description = "Name prefix applied to every AWS resource."
  type        = string
}

variable "hostname" {
  description = "Ubuntu hostname and Name tag."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the dedicated server VPC."
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
  description = "Optional existing VPC ID for shared-network deployments."
  type        = string
  default     = null
}

variable "subnet_id" {
  description = "Optional existing subnet ID for shared-network deployments."
  type        = string
  default     = null
}

variable "subnet_cidr" {
  description = "Optional CIDR block for the managed server subnet."
  type        = string
  default     = null
}

variable "availability_zone_index" {
  description = "Index into available AZs for this server."
  type        = number
  default     = 0
}

variable "allowed_source_cidrs" {
  description = "CIDRs allowed to reach optional SSH access."
  type        = list(string)
}

variable "admin_public_key" {
  description = "Public key material for the EC2 key pair associated with the Ubuntu server."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type for the Ubuntu server."
  type        = string
  default     = "t3.small"
}

variable "root_volume_gb" {
  description = "Ubuntu root volume size."
  type        = number
  default     = 32
}

variable "associate_public_ip" {
  description = "Assign a public IP to the instance."
  type        = bool
  default     = true
}

variable "enable_ssh" {
  description = "Allow SSH from allowed_source_cidrs."
  type        = bool
  default     = true
}

variable "enable_ssm" {
  description = "Attach an IAM role with AmazonSSMManagedInstanceCore."
  type        = bool
  default     = true
}

variable "bootstrap_packages" {
  description = "APT packages installed before bootstrap commands run."
  type        = list(string)
  default     = []
}

variable "bootstrap_commands" {
  description = "Shell commands run after package installation."
  type        = list(string)
  default     = []
}

variable "koi_script_inline" {
  description = "Inline Koi enrollment script body. The broker derives this from resource.koi.scriptPath."
  type        = string
  default     = ""
  sensitive   = true
}

variable "koi_script_sha256" {
  description = "Optional expected SHA-256 hash for the Koi enrollment script."
  type        = string
  default     = ""
}

variable "koi_interpreter" {
  description = "Interpreter used to run the Koi script (for example bash or python3)."
  type        = string
  default     = "bash"
}

variable "koi_arguments" {
  description = "Arguments passed to the Koi enrollment script during first-boot bootstrap."
  type        = list(string)
  default     = []
}

variable "koi_environment" {
  description = "Environment variables exposed only to the Koi script process. Avoid secrets because bootstrap content is stored in Terraform state."
  type        = map(string)
  default     = {}
  sensitive   = true
}
