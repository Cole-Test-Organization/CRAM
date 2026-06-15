data "aws_ami" "panorama" {
  most_recent = true
  owners      = ["aws-marketplace"]

  filter {
    name   = "name"
    values = ["Panorama-AWS-${var.panos_version_major}*"]
  }

  filter {
    name   = "product-code"
    values = ["eclz7j04vu9lf8ont8ta3n17o"]
  }
}

locals {
  use_existing_network = var.vpc_id != null && var.subnet_id != null
  vpc_id               = local.use_existing_network ? var.vpc_id : aws_vpc.main[0].id
  subnet_id            = local.use_existing_network ? var.subnet_id : aws_subnet.panorama[0].id
}

resource "aws_vpc" "main" {
  count = local.use_existing_network ? 0 : 1

  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.project_name}-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  count = local.use_existing_network ? 0 : 1

  vpc_id = aws_vpc.main[0].id

  tags = {
    Name = "${var.project_name}-igw"
  }
}

resource "aws_subnet" "panorama" {
  count = local.use_existing_network ? 0 : 1

  vpc_id            = aws_vpc.main[0].id
  cidr_block        = var.subnet_cidr
  availability_zone = var.availability_zone

  tags = {
    Name = "${var.project_name}-panorama-${var.availability_zone}"
  }
}

resource "aws_route_table" "public" {
  count = local.use_existing_network ? 0 : 1

  vpc_id = aws_vpc.main[0].id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main[0].id
  }

  tags = {
    Name = "${var.project_name}-public-rt"
  }
}

resource "aws_route_table_association" "panorama" {
  count = local.use_existing_network ? 0 : 1

  subnet_id      = aws_subnet.panorama[0].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_security_group" "panorama" {
  name        = "${var.project_name}-panorama-sg"
  description = "Panorama management access from allowed LAN/admin CIDRs"
  vpc_id      = local.vpc_id

  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = var.allowed_source_cidrs
    description = "Management access from LAN/admin CIDRs"
  }

  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
    description = "Intra-VPC access for future firewalls or automation workers"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-panorama-sg"
  }
}

resource "aws_key_pair" "panorama" {
  key_name   = "${var.project_name}-panorama-key"
  public_key = var.ssh_public_key
}

resource "aws_network_interface" "panorama" {
  subnet_id         = local.subnet_id
  security_groups   = [aws_security_group.panorama.id]
  source_dest_check = true

  tags = {
    Name = "${var.project_name}-${var.hostname}-mgmt"
  }
}

resource "aws_eip" "panorama" {
  domain = "vpc"

  tags = {
    Name = "${var.project_name}-${var.hostname}-mgmt-eip"
  }
}

resource "aws_eip_association" "panorama" {
  allocation_id        = aws_eip.panorama.id
  network_interface_id = aws_network_interface.panorama.id
}

resource "aws_instance" "panorama" {
  ami           = data.aws_ami.panorama.id
  instance_type = var.instance_type
  key_name      = aws_key_pair.panorama.key_name

  network_interface {
    network_interface_id = aws_network_interface.panorama.id
    device_index         = 0
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
  }

  ebs_block_device {
    device_name           = var.log_volume_device_name
    volume_type           = "gp3"
    volume_size           = var.log_volume_gb
    delete_on_termination = true
  }

  tags = {
    Name = "${var.project_name}-${var.hostname}"
  }
}
