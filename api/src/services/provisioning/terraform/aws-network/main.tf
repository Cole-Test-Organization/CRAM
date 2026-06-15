provider "aws" {
  region = var.region
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  availability_zones = slice(data.aws_availability_zones.available.names, 0, var.availability_zone_count)
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.project_name}-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-igw"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${var.project_name}-public-rt"
  }
}

resource "aws_route_table" "trust" {
  count = var.availability_zone_count

  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-trust-${local.availability_zones[count.index]}-rt"
  }
}

resource "aws_subnet" "management" {
  count = var.availability_zone_count

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, var.subnet_newbits, var.management_subnet_start_index + count.index)
  availability_zone = local.availability_zones[count.index]

  tags = {
    Name = "${var.project_name}-mgmt-${local.availability_zones[count.index]}"
  }
}

resource "aws_subnet" "untrust" {
  count = var.availability_zone_count

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, var.subnet_newbits, var.untrust_subnet_start_index + count.index)
  availability_zone = local.availability_zones[count.index]

  tags = {
    Name = "${var.project_name}-untrust-${local.availability_zones[count.index]}"
  }
}

resource "aws_subnet" "trust" {
  count = var.availability_zone_count

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, var.subnet_newbits, var.trust_subnet_start_index + count.index)
  availability_zone = local.availability_zones[count.index]

  tags = {
    Name = "${var.project_name}-trust-${local.availability_zones[count.index]}"
  }
}

resource "aws_subnet" "panorama" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, var.subnet_newbits, var.panorama_subnet_index)
  availability_zone = local.availability_zones[0]

  tags = {
    Name = "${var.project_name}-panorama-${local.availability_zones[0]}"
  }
}

resource "aws_route_table_association" "management" {
  count = var.availability_zone_count

  subnet_id      = aws_subnet.management[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "untrust" {
  count = var.availability_zone_count

  subnet_id      = aws_subnet.untrust[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "trust" {
  count = var.availability_zone_count

  subnet_id      = aws_subnet.trust[count.index].id
  route_table_id = aws_route_table.trust[count.index].id
}

resource "aws_route_table_association" "panorama" {
  subnet_id      = aws_subnet.panorama.id
  route_table_id = aws_route_table.public.id
}
