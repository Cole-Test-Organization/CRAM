provider "aws" {
  region = var.region
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  availability_zone = data.aws_availability_zones.available.names[var.availability_zone_index]
  subnet_cidr       = var.subnet_cidr == null ? cidrsubnet(var.vpc_cidr, 8, 30) : var.subnet_cidr
}

module "panorama" {
  source = "../modules/aws-panorama"

  project_name           = var.project_name
  hostname               = var.hostname
  vpc_cidr               = var.vpc_cidr
  vpc_id                 = var.vpc_id
  subnet_cidr            = local.subnet_cidr
  subnet_id              = var.subnet_id
  availability_zone      = local.availability_zone
  allowed_source_cidrs   = var.allowed_source_cidrs
  ssh_public_key         = var.ssh_public_key
  panos_version_major    = var.panos_version_major
  instance_type          = var.instance_type
  root_volume_gb         = var.root_volume_gb
  log_volume_gb          = var.log_volume_gb
  log_volume_device_name = var.log_volume_device_name
  dns_primary            = var.dns_primary
  dns_secondary          = var.dns_secondary
  serial                 = var.serial
}
