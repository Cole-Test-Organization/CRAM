variable "region" {
  description = "AWS region for the S3 bootstrap bucket."
  type        = string
}

variable "project_name" {
  description = "Name prefix applied to bucket resources."
  type        = string
}

variable "bucket_name" {
  description = "Optional globally unique bucket name. When empty, Terraform creates one with bucket_prefix."
  type        = string
  default     = ""
}

variable "allowed_source_cidrs" {
  description = "CIDR blocks allowed to access objects in this bucket."
  type        = list(string)

  validation {
    condition     = length(var.allowed_source_cidrs) > 0
    error_message = "allowed_source_cidrs must contain at least one CIDR."
  }
}

variable "force_destroy" {
  description = "Allow Terraform destroy to remove non-empty test buckets."
  type        = bool
  default     = true
}
