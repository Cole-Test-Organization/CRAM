variable "project" {
  description = "GCP project ID that owns the network."
  type        = string
}

variable "region" {
  description = "GCP region for the subnetworks."
  type        = string
}

variable "project_name" {
  description = "Name prefix applied to every GCP resource."
  type        = string
}

variable "vpc_cidr" {
  description = "Supernet the subnetworks are carved out of."
  type        = string
  default     = "10.100.0.0/16"
}

variable "subnet_newbits" {
  description = "Bits added to vpc_cidr when carving each subnetwork."
  type        = number
  default     = 8
}

variable "management_subnet_index" {
  description = "cidrsubnet index for the management subnetwork."
  type        = number
  default     = 0
}

variable "untrust_subnet_index" {
  description = "cidrsubnet index for the untrust (internet-facing) subnetwork."
  type        = number
  default     = 10
}

variable "trust_subnet_index" {
  description = "cidrsubnet index for the trust (private) subnetwork."
  type        = number
  default     = 20
}

variable "panorama_subnet_index" {
  description = "cidrsubnet index for the management-plane subnetwork."
  type        = number
  default     = 30
}

variable "allowed_source_cidrs" {
  description = "CIDRs allowed to reach management services (SSH/HTTPS) directly."
  type        = list(string)
}

variable "enable_cloud_nat" {
  description = "Create a Cloud Router + NAT so instances without external IPs still have egress."
  type        = bool
  default     = true
}

variable "enable_iap_ingress" {
  description = "Allow Google's IAP forwarding range to reach SSH/RDP, which is what broker tunnels use."
  type        = bool
  default     = true
}
