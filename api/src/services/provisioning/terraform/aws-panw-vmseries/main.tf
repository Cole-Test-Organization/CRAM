provider "aws" {
  region = var.region
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ami" "panos" {
  most_recent = true
  owners      = ["aws-marketplace"]

  filter {
    name   = "name"
    values = ["PA-VM-AWS-${var.panos_version_major}*"]
  }

  filter {
    name   = "product-code"
    values = ["6njl1pau431dv1qxipg63mvah"]
  }
}

locals {
  use_existing_network = (
    var.vpc_id != null &&
    var.management_subnet_id != null &&
    var.untrust_subnet_id != null &&
    var.trust_subnet_id != null
  )
  vpc_id               = local.use_existing_network ? var.vpc_id : aws_vpc.main[0].id
  management_subnet_id = local.use_existing_network ? var.management_subnet_id : aws_subnet.management[0].id
  untrust_subnet_id    = local.use_existing_network ? var.untrust_subnet_id : aws_subnet.untrust[0].id
  trust_subnet_id      = local.use_existing_network ? var.trust_subnet_id : aws_subnet.trust[0].id

  availability_zone      = data.aws_availability_zones.available.names[var.availability_zone_index]
  management_subnet_cidr = var.management_subnet_cidr == null ? cidrsubnet(var.vpc_cidr, 8, 0) : var.management_subnet_cidr
  untrust_subnet_cidr    = var.untrust_subnet_cidr == null ? cidrsubnet(var.vpc_cidr, 8, 10) : var.untrust_subnet_cidr
  trust_subnet_cidr      = var.trust_subnet_cidr == null ? cidrsubnet(var.vpc_cidr, 8, 20) : var.trust_subnet_cidr

  panorama_bootstrap_userdata = var.management_server_mode == "panorama" ? compact([
    "panorama-server=${var.panorama_server}",
    var.panorama_server2 == "" ? "" : "panorama-server-2=${var.panorama_server2}",
    "vm-auth-key=${var.vm_auth_key}",
  ]) : []

  device_certificate_userdata = var.device_cert_pin_id == "" || var.device_cert_pin_value == "" ? [] : [
    "vm-series-auto-registration-pin-id=${var.device_cert_pin_id}",
    "vm-series-auto-registration-pin-value=${var.device_cert_pin_value}",
  ]

  bootstrap_userdata = join("\n", concat(
    [
      "type=dhcp-client",
      "hostname=${var.hostname}",
      "dns-primary=${var.dns_primary}",
      "dns-secondary=${var.dns_secondary}",
      "dhcp-send-hostname=yes",
      "dhcp-send-client-id=yes",
      "dhcp-accept-server-hostname=no",
      "dhcp-accept-server-domain=yes",
      "authcodes=${var.auth_code}",
    ],
    local.panorama_bootstrap_userdata,
    local.device_certificate_userdata,
  ))

}

resource "aws_vpc" "main" {
  count = local.use_existing_network ? 0 : 1

  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.project_name}-${var.hostname}-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  count = local.use_existing_network ? 0 : 1

  vpc_id = aws_vpc.main[0].id

  tags = {
    Name = "${var.project_name}-${var.hostname}-igw"
  }
}

resource "aws_subnet" "management" {
  count = local.use_existing_network ? 0 : 1

  vpc_id            = aws_vpc.main[0].id
  cidr_block        = local.management_subnet_cidr
  availability_zone = local.availability_zone

  tags = {
    Name = "${var.project_name}-${var.hostname}-management-${local.availability_zone}"
  }
}

resource "aws_subnet" "untrust" {
  count = local.use_existing_network ? 0 : 1

  vpc_id            = aws_vpc.main[0].id
  cidr_block        = local.untrust_subnet_cidr
  availability_zone = local.availability_zone

  tags = {
    Name = "${var.project_name}-${var.hostname}-untrust-${local.availability_zone}"
  }
}

resource "aws_subnet" "trust" {
  count = local.use_existing_network ? 0 : 1

  vpc_id            = aws_vpc.main[0].id
  cidr_block        = local.trust_subnet_cidr
  availability_zone = local.availability_zone

  tags = {
    Name = "${var.project_name}-${var.hostname}-trust-${local.availability_zone}"
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
    Name = "${var.project_name}-${var.hostname}-public-rt"
  }
}

resource "aws_route_table_association" "management" {
  count = local.use_existing_network ? 0 : 1

  subnet_id      = aws_subnet.management[0].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_route_table_association" "untrust" {
  count = local.use_existing_network ? 0 : 1

  subnet_id      = aws_subnet.untrust[0].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_security_group" "firewall" {
  name        = "${var.project_name}-${var.hostname}-fw-sg"
  description = "VM-Series firewall management and dataplane access"
  vpc_id      = local.vpc_id

  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = var.allowed_source_cidrs
    description = "Management access from LAN/admin CIDRs"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "GlobalProtect TCP/443"
  }

  ingress {
    from_port   = 4501
    to_port     = 4501
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "GlobalProtect UDP/4501"
  }

  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
    description = "Intra-VPC traffic"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.hostname}-fw-sg"
  }
}

resource "aws_key_pair" "firewall" {
  key_name   = "${var.project_name}-${var.hostname}-key"
  public_key = var.ssh_public_key
}

resource "aws_network_interface" "management" {
  subnet_id         = local.management_subnet_id
  security_groups   = [aws_security_group.firewall.id]
  source_dest_check = true

  tags = {
    Name = "${var.project_name}-${var.hostname}-management"
  }
}

resource "aws_network_interface" "untrust" {
  subnet_id         = local.untrust_subnet_id
  security_groups   = [aws_security_group.firewall.id]
  source_dest_check = false

  tags = {
    Name = "${var.project_name}-${var.hostname}-untrust"
  }
}

resource "aws_network_interface" "trust" {
  subnet_id         = local.trust_subnet_id
  security_groups   = [aws_security_group.firewall.id]
  source_dest_check = false

  tags = {
    Name = "${var.project_name}-${var.hostname}-trust"
  }
}

resource "aws_eip" "management" {
  count  = var.attach_management_elastic_ip ? 1 : 0
  domain = "vpc"

  tags = {
    Name = "${var.project_name}-${var.hostname}-management-eip"
  }
}

resource "aws_eip_association" "management" {
  count                = var.attach_management_elastic_ip ? 1 : 0
  allocation_id        = aws_eip.management[0].id
  network_interface_id = aws_network_interface.management.id
}

resource "aws_eip" "untrust" {
  count  = var.attach_untrust_elastic_ip ? 1 : 0
  domain = "vpc"

  tags = {
    Name = "${var.project_name}-${var.hostname}-untrust-eip"
  }
}

resource "aws_eip_association" "untrust" {
  count                = var.attach_untrust_elastic_ip ? 1 : 0
  allocation_id        = aws_eip.untrust[0].id
  network_interface_id = aws_network_interface.untrust.id
}

resource "aws_instance" "firewall" {
  ami           = data.aws_ami.panos.id
  instance_type = var.instance_type
  key_name      = aws_key_pair.firewall.key_name
  user_data     = local.bootstrap_userdata

  network_interface {
    network_interface_id = aws_network_interface.management.id
    device_index         = 0
  }

  network_interface {
    network_interface_id = aws_network_interface.untrust.id
    device_index         = 1
  }

  network_interface {
    network_interface_id = aws_network_interface.trust.id
    device_index         = 2
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
  }

  tags = {
    Name = "${var.project_name}-${var.hostname}"
  }
}
