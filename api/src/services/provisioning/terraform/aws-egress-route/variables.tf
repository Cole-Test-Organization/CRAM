variable "region" {
  description = "AWS region for the egress route."
  type        = string
}

variable "project_name" {
  description = "Name prefix applied to route tags where supported."
  type        = string
}

variable "hostname" {
  description = "Route resource name recorded in outputs."
  type        = string
}

variable "route_table_id" {
  description = "Route table that receives the egress route."
  type        = string
}

variable "destination_cidr_block" {
  description = "Destination CIDR for the egress route."
  type        = string
  default     = "0.0.0.0/0"
}

variable "next_hop_network_interface_id" {
  description = "AWS network interface ID used as the next hop."
  type        = string
}
