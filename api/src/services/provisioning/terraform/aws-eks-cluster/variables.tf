variable "region" {
  description = "AWS region for the EKS deployment."
  type        = string
}

variable "project_name" {
  description = "Name prefix applied to AWS resources."
  type        = string
}

variable "hostname" {
  description = "Broker resource hostname for the EKS cluster."
  type        = string
}

variable "kubernetes_version" {
  description = "Optional EKS Kubernetes version. Null lets AWS choose the default version."
  type        = string
  default     = null
}

variable "vpc_cidr" {
  description = "CIDR block for the dedicated EKS VPC."
  type        = string
}

variable "availability_zone_count" {
  description = "Number of AZs and public subnets to create for EKS."
  type        = number
  default     = 2

  validation {
    condition     = var.availability_zone_count >= 2
    error_message = "EKS requires at least two availability zones."
  }
}

variable "public_subnet_newbits" {
  description = "Newbits used to carve public EKS subnets from vpc_cidr."
  type        = number
  default     = 8
}

variable "public_subnet_start_index" {
  description = "Starting subnet index for public EKS subnets."
  type        = number
  default     = 0
}

variable "node_instance_types" {
  description = "Managed node group EC2 instance types."
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_desired_size" {
  description = "Desired managed node group size."
  type        = number
  default     = 1
}

variable "node_min_size" {
  description = "Minimum managed node group size."
  type        = number
  default     = 1
}

variable "node_max_size" {
  description = "Maximum managed node group size."
  type        = number
  default     = 1
}

variable "node_disk_size_gb" {
  description = "Managed node group disk size."
  type        = number
  default     = 20
}

variable "app_name" {
  description = "Kubernetes app and ECR repository suffix."
  type        = string
  default     = "broker-health-api"
}

variable "app_namespace" {
  description = "Kubernetes namespace for the test API."
  type        = string
  default     = "broker-health"
}

variable "app_context_path" {
  description = "Repo-relative or absolute path to the local app Docker context."
  type        = string
  default     = "apps/eks-health-api"
}

variable "app_image_tag" {
  description = "Container image tag pushed for the local app."
  type        = string
  default     = "latest"
}

variable "app_replicas" {
  description = "Number of API pods."
  type        = number
  default     = 1
}

variable "app_port" {
  description = "Public service port."
  type        = number
  default     = 80
}

variable "app_container_port" {
  description = "Container HTTP port."
  type        = number
  default     = 8080
}

variable "app_health_path" {
  description = "HTTP path used for Kubernetes probes and broker verification."
  type        = string
  default     = "/healthz"
}

variable "app_verify_timeout_seconds" {
  description = "Broker verification timeout exported with app outputs."
  type        = number
  default     = 900
}
