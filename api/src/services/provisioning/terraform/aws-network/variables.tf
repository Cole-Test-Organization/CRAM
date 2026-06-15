variable "region" {
  description = "AWS region for the shared network building block."
  type        = string
}

variable "project_name" {
  description = "Name prefix applied to every AWS network resource."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the shared lab VPC."
  type        = string
}

variable "availability_zone_count" {
  description = "Number of availability zones to carve management/untrust/trust subnets across."
  type        = number
  default     = 3

  validation {
    condition     = var.availability_zone_count >= 1
    error_message = "availability_zone_count must be at least 1."
  }
}

variable "subnet_newbits" {
  description = "Additional CIDR bits used for each subnet carved from vpc_cidr."
  type        = number
  default     = 8
}

variable "management_subnet_start_index" {
  description = "Starting cidrsubnet index for management subnets."
  type        = number
  default     = 0
}

variable "untrust_subnet_start_index" {
  description = "Starting cidrsubnet index for untrust subnets."
  type        = number
  default     = 10
}

variable "trust_subnet_start_index" {
  description = "Starting cidrsubnet index for trust subnets."
  type        = number
  default     = 20
}

variable "panorama_subnet_index" {
  description = "cidrsubnet index for the Panorama management subnet."
  type        = number
  default     = 30
}
