variable "project" {
  description = "GCP project ID for the Ubuntu server."
  type        = string
}

variable "region" {
  description = "GCP region for the server's subnetwork."
  type        = string
}

variable "zone" {
  description = "GCP zone for the instance. Defaults to <region>-a when empty."
  type        = string
  default     = null
}

variable "project_name" {
  description = "Name prefix applied to every GCP resource."
  type        = string
}

variable "hostname" {
  description = "Instance name and on-box hostname."
  type        = string
}

variable "vpc_cidr" {
  description = "Supernet used when this stack creates its own network."
  type        = string
  default     = "10.130.0.0/16"
}

variable "network_mode" {
  description = "Network placement mode. managed creates a dedicated VPC/subnet; existing attaches to network/subnetwork."
  type        = string
  default     = "managed"

  validation {
    condition     = contains(["managed", "existing"], var.network_mode)
    error_message = "network_mode must be managed or existing."
  }
}

variable "network" {
  description = "Optional existing VPC network name or self link."
  type        = string
  default     = null
}

variable "subnetwork" {
  description = "Optional existing subnetwork name or self link."
  type        = string
  default     = null
}

variable "subnet_cidr" {
  description = "Optional CIDR for the managed subnetwork."
  type        = string
  default     = null
}

variable "allowed_source_cidrs" {
  description = "CIDRs allowed to reach optional SSH access."
  type        = list(string)
}

variable "admin_username" {
  description = "Linux user the admin SSH key is installed for."
  type        = string
  default     = "ubuntu"
}

variable "admin_public_key" {
  description = "Public key material installed for admin_username."
  type        = string
}

variable "machine_type" {
  description = "Compute Engine machine type."
  type        = string
  default     = "e2-standard-2"
}

variable "image" {
  description = "Boot image family or self link."
  type        = string
  default     = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
}

variable "root_volume_gb" {
  description = "Boot disk size in GB."
  type        = number
  default     = 32
}

variable "associate_public_ip" {
  description = "Attach an ephemeral external IP. When false the instance needs Cloud NAT for egress."
  type        = bool
  default     = true
}

variable "enable_ssh" {
  description = "Allow SSH from allowed_source_cidrs."
  type        = bool
  default     = true
}

variable "enable_iap" {
  description = "Allow Google's IAP forwarding range, which broker SSH tunnels use."
  type        = bool
  default     = true
}

variable "enable_cloud_nat" {
  description = "Create a Cloud Router + NAT for the managed network so private instances have egress."
  type        = bool
  default     = true
}

variable "service_account_email" {
  description = "Optional service account attached to the instance."
  type        = string
  default     = null
}

variable "service_account_scopes" {
  description = "OAuth scopes for the attached service account."
  type        = list(string)
  default     = ["https://www.googleapis.com/auth/cloud-platform"]
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
