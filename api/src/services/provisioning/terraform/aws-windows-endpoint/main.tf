provider "aws" {
  region = var.region
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  set_admin_password   = var.admin_password != null && var.admin_password != ""
  admin_password_param = local.set_admin_password ? "/${var.project_name}/${var.hostname}/admin-password" : ""
  use_existing_network = var.network_mode == "existing" || (var.vpc_id != null && var.subnet_id != null)
  availability_zone    = data.aws_availability_zones.available.names[var.availability_zone_index]
  subnet_cidr          = var.subnet_cidr == null ? cidrsubnet(var.vpc_cidr, 8, 30) : var.subnet_cidr
  selected_ami_id      = data.aws_ami.windows_server.id
  vpc_id               = local.use_existing_network ? var.vpc_id : aws_vpc.main[0].id
  subnet_id            = local.use_existing_network ? var.subnet_id : aws_subnet.endpoint[0].id

  bootstrap_document_name = replace("${var.project_name}-${var.hostname}-koi-bootstrap", "/[^A-Za-z0-9_.-]/", "-")
  bootstrap_script = templatefile("${path.module}/user-data.ps1.tftpl", {
    hostname              = jsonencode(var.hostname)
    admin_username        = jsonencode(var.admin_username)
    region                = jsonencode(var.region)
    admin_password_param  = jsonencode(local.admin_password_param)
    install_ssm_agent     = var.install_ssm_agent ? "$true" : "$false"
    install_python        = var.install_python ? "$true" : "$false"
    python_install_url    = jsonencode(var.python_install_url == null ? "" : var.python_install_url)
    koi_script_inline_b64 = jsonencode(base64encode(var.koi_script_inline == null ? "" : var.koi_script_inline))
    koi_script_sha256     = jsonencode(var.koi_script_sha256 == null ? "" : var.koi_script_sha256)
    koi_arguments_json    = jsonencode(var.koi_arguments)
    koi_environment_json  = jsonencode(var.koi_environment)
    applications_json     = jsonencode(var.applications)
  })
  user_data = var.bootstrap_method == "user_data" ? format("<powershell>\n%s\n</powershell>\n<persist>false</persist>\n", local.bootstrap_script) : null
}

data "aws_ami" "windows_server" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["Windows_Server-2022-English-Full-Base-*"]
  }

  filter {
    name   = "platform"
    values = ["windows"]
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

resource "aws_subnet" "endpoint" {
  count = local.use_existing_network ? 0 : 1

  vpc_id                  = aws_vpc.main[0].id
  cidr_block              = local.subnet_cidr
  availability_zone       = local.availability_zone
  map_public_ip_on_launch = var.associate_public_ip

  tags = {
    Name = "${var.project_name}-${var.hostname}-endpoint-${local.availability_zone}"
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

resource "aws_route_table_association" "endpoint" {
  count = local.use_existing_network ? 0 : 1

  subnet_id      = aws_subnet.endpoint[0].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_security_group" "endpoint" {
  name        = "${var.project_name}-${var.hostname}-endpoint-sg"
  description = "Windows endpoint bootstrap and optional admin access"
  vpc_id      = local.vpc_id

  dynamic "ingress" {
    for_each = var.enable_winrm ? [5985, 5986] : []
    content {
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = var.allowed_source_cidrs
      description = "WinRM from LAN/admin CIDRs"
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.hostname}-endpoint-sg"
  }
}

resource "aws_key_pair" "endpoint" {
  key_name   = "${var.project_name}-${var.hostname}-key"
  public_key = var.admin_public_key
}

resource "aws_iam_role" "endpoint" {
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
    Name = "${var.project_name}-${var.hostname}-ssm-role"
  }
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  count      = var.enable_ssm ? 1 : 0
  role       = aws_iam_role.endpoint[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "endpoint" {
  count = var.enable_ssm ? 1 : 0
  name  = "${var.project_name}-${var.hostname}-profile"
  role  = aws_iam_role.endpoint[0].name
}

# Local Windows admin password kept in SSM Parameter Store (SecureString) instead of
# inlined into user_data / the SSM document content, so it can't be read via
# ssm:GetDocument or ec2:DescribeInstanceAttribute. The bootstrap fetches it at boot
# with the instance role. (The value still transits Terraform state.)
resource "aws_ssm_parameter" "admin_password" {
  count       = local.set_admin_password ? 1 : 0
  name        = local.admin_password_param
  description = "Local Windows admin password for ${var.project_name}-${var.hostname}, fetched by the bootstrap."
  type        = "SecureString"
  value       = var.admin_password

  tags = {
    Name      = "${var.project_name}-${var.hostname}-admin-password"
    ManagedBy = "panw-broker"
  }
}

resource "aws_iam_role_policy" "admin_password_read" {
  count = var.enable_ssm && local.set_admin_password ? 1 : 0
  name  = "${var.project_name}-${var.hostname}-admin-password-read"
  role  = aws_iam_role.endpoint[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = aws_ssm_parameter.admin_password[0].arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.region}.amazonaws.com"
          }
        }
      },
    ]
  })
}

resource "aws_instance" "endpoint" {
  ami                         = local.selected_ami_id
  instance_type               = var.instance_type
  key_name                    = aws_key_pair.endpoint.key_name
  subnet_id                   = local.subnet_id
  vpc_security_group_ids      = [aws_security_group.endpoint.id]
  associate_public_ip_address = var.associate_public_ip
  iam_instance_profile        = var.enable_ssm ? aws_iam_instance_profile.endpoint[0].name : null
  user_data                   = local.user_data
  user_data_replace_on_change = true

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
  }

  lifecycle {
    precondition {
      condition     = var.bootstrap_method != "ssm" || var.enable_ssm
      error_message = "enable_ssm must be true when bootstrap_method is ssm."
    }
    precondition {
      condition     = !local.use_existing_network || (var.vpc_id != null && var.subnet_id != null)
      error_message = "vpc_id and subnet_id are required when network_mode is existing."
    }
  }

  tags = {
    Name               = "${var.project_name}-${var.hostname}"
    Role               = "windows-endpoint"
    ManagedBy          = "panw-broker"
    Workload           = "koi"
    EndpointSimulation = "true"
  }
}

resource "aws_ssm_document" "koi_bootstrap" {
  count           = var.bootstrap_method == "ssm" ? 1 : 0
  name            = local.bootstrap_document_name
  document_type   = "Command"
  document_format = "YAML"

  content = yamlencode({
    schemaVersion = "2.2"
    description   = "Install Python if needed and run the Koi endpoint script."
    mainSteps = [
      {
        action = "aws:runPowerShellScript"
        name   = "runKoiBootstrap"
        inputs = {
          timeoutSeconds = tostring(var.bootstrap_timeout_seconds)
          runCommand     = [local.bootstrap_script]
        }
      }
    ]
  })

  tags = {
    Name      = local.bootstrap_document_name
    ManagedBy = "panw-broker"
  }
}

resource "aws_ssm_association" "koi_bootstrap" {
  count                            = var.bootstrap_method == "ssm" ? 1 : 0
  name                             = aws_ssm_document.koi_bootstrap[0].name
  wait_for_success_timeout_seconds = var.bootstrap_timeout_seconds

  targets {
    key    = "InstanceIds"
    values = [aws_instance.endpoint.id]
  }

  depends_on = [
    aws_iam_role_policy_attachment.ssm_core,
  ]
}
