provider "aws" {
  region = var.region
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  use_existing_network = var.network_mode == "existing" || (var.vpc_id != null && var.subnet_id != null)
  availability_zone    = data.aws_availability_zones.available.names[var.availability_zone_index]
  subnet_cidr          = var.subnet_cidr == null ? cidrsubnet(var.vpc_cidr, 8, 40) : var.subnet_cidr
  vpc_id               = local.use_existing_network ? var.vpc_id : aws_vpc.main[0].id
  subnet_id            = local.use_existing_network ? var.subnet_id : aws_subnet.server[0].id
  koi_interpreter      = (var.koi_interpreter == null || var.koi_interpreter == "") ? "bash" : var.koi_interpreter
  bootstrap_script = templatefile("${path.module}/user-data.sh.tftpl", {
    hostname              = var.hostname
    packages_json         = jsonencode(var.bootstrap_packages)
    commands_json         = jsonencode(var.bootstrap_commands)
    koi_script_inline_b64 = base64encode(var.koi_script_inline == null ? "" : var.koi_script_inline)
    koi_script_sha256     = var.koi_script_sha256 == null ? "" : var.koi_script_sha256
    koi_interpreter       = local.koi_interpreter
    koi_arguments_b64     = base64encode(jsonencode(var.koi_arguments))
    koi_environment_b64   = base64encode(jsonencode(var.koi_environment))
  })
}

resource "aws_vpc" "main" {
  count = local.use_existing_network ? 0 : 1

  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name      = "${var.project_name}-${var.hostname}-vpc"
    ManagedBy = "panw-broker"
  }
}

resource "aws_internet_gateway" "main" {
  count = local.use_existing_network ? 0 : 1

  vpc_id = aws_vpc.main[0].id

  tags = {
    Name      = "${var.project_name}-${var.hostname}-igw"
    ManagedBy = "panw-broker"
  }
}

resource "aws_subnet" "server" {
  count = local.use_existing_network ? 0 : 1

  vpc_id                  = aws_vpc.main[0].id
  cidr_block              = local.subnet_cidr
  availability_zone       = local.availability_zone
  map_public_ip_on_launch = var.associate_public_ip

  tags = {
    Name      = "${var.project_name}-${var.hostname}-subnet-${local.availability_zone}"
    ManagedBy = "panw-broker"
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
    Name      = "${var.project_name}-${var.hostname}-public-rt"
    ManagedBy = "panw-broker"
  }
}

resource "aws_route_table_association" "server" {
  count = local.use_existing_network ? 0 : 1

  subnet_id      = aws_subnet.server[0].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_security_group" "server" {
  name        = "${var.project_name}-${var.hostname}-sg"
  description = "Ubuntu server outbound access and optional SSH"
  vpc_id      = local.vpc_id

  dynamic "ingress" {
    for_each = var.enable_ssh ? [1] : []
    content {
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.allowed_source_cidrs
      description = "SSH from admin CIDRs"
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name      = "${var.project_name}-${var.hostname}-sg"
    ManagedBy = "panw-broker"
  }
}

resource "aws_key_pair" "server" {
  key_name   = "${var.project_name}-${var.hostname}-key"
  public_key = var.admin_public_key
}

resource "aws_iam_role" "server" {
  count = var.enable_ssm ? 1 : 0
  name  = "${var.project_name}-${var.hostname}-ssm-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name      = "${var.project_name}-${var.hostname}-ssm-role"
    ManagedBy = "panw-broker"
  }
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  count      = var.enable_ssm ? 1 : 0
  role       = aws_iam_role.server[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "server" {
  count = var.enable_ssm ? 1 : 0
  name  = "${var.project_name}-${var.hostname}-profile"
  role  = aws_iam_role.server[0].name
}

resource "aws_instance" "server" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  key_name                    = aws_key_pair.server.key_name
  subnet_id                   = local.subnet_id
  vpc_security_group_ids      = [aws_security_group.server.id]
  associate_public_ip_address = var.associate_public_ip
  iam_instance_profile        = var.enable_ssm ? aws_iam_instance_profile.server[0].name : null
  user_data                   = local.bootstrap_script
  user_data_replace_on_change = true

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
  }

  lifecycle {
    precondition {
      condition     = !local.use_existing_network || (var.vpc_id != null && var.subnet_id != null)
      error_message = "vpc_id and subnet_id are required when network_mode is existing."
    }
    precondition {
      condition     = var.associate_public_ip || local.use_existing_network
      error_message = "managed Ubuntu deployments need associate_public_ip=true for direct internet access."
    }
  }

  tags = {
    Name      = "${var.project_name}-${var.hostname}"
    Role      = "ubuntu-server"
    ManagedBy = "panw-broker"
  }
}
