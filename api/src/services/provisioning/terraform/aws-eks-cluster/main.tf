provider "aws" {
  region = var.region
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name_prefix        = substr(replace(lower("${var.project_name}-${var.hostname}"), "/[^a-z0-9-]/", "-"), 0, 42)
  app_label          = substr(replace(lower(var.app_name), "/[^a-z0-9-]/", "-"), 0, 63)
  ecr_repository     = substr("${local.name_prefix}-${local.app_label}", 0, 256)
  availability_zones = slice(data.aws_availability_zones.available.names, 0, var.availability_zone_count)
  app_context_abs    = startswith(var.app_context_path, "/") ? var.app_context_path : abspath("${path.root}/../../${var.app_context_path}")
  app_source_hash = sha256(join("", [
    for file_name in fileset(local.app_context_abs, "**") :
    filesha256("${local.app_context_abs}/${file_name}")
    if !startswith(file_name, "build/")
  ]))
  image_uri = "${aws_ecr_repository.app.repository_url}:${var.app_image_tag}"
  registry  = split("/", aws_ecr_repository.app.repository_url)[0]
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name                                         = "${local.name_prefix}-vpc"
    ManagedBy                                    = "panw-broker"
    "kubernetes.io/cluster/${local.name_prefix}" = "shared"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name      = "${local.name_prefix}-igw"
    ManagedBy = "panw-broker"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name      = "${local.name_prefix}-public-rt"
    ManagedBy = "panw-broker"
  }
}

resource "aws_subnet" "public" {
  count = var.availability_zone_count

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, var.public_subnet_newbits, var.public_subnet_start_index + count.index)
  availability_zone       = local.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name                                         = "${local.name_prefix}-public-${local.availability_zones[count.index]}"
    ManagedBy                                    = "panw-broker"
    "kubernetes.io/cluster/${local.name_prefix}" = "shared"
    "kubernetes.io/role/elb"                     = "1"
  }
}

resource "aws_route_table_association" "public" {
  count = var.availability_zone_count

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_iam_role" "cluster" {
  name = "${local.name_prefix}-cluster-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "eks.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name      = "${local.name_prefix}-cluster-role"
    ManagedBy = "panw-broker"
  }
}

resource "aws_iam_role_policy_attachment" "cluster_policy" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_iam_role" "node" {
  name = "${local.name_prefix}-node-role"

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
    Name      = "${local.name_prefix}-node-role"
    ManagedBy = "panw-broker"
  }
}

resource "aws_iam_role_policy_attachment" "node_worker" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

resource "aws_iam_role_policy_attachment" "node_cni" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}

resource "aws_iam_role_policy_attachment" "node_ecr" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_eks_cluster" "cluster" {
  name     = local.name_prefix
  role_arn = aws_iam_role.cluster.arn
  version  = var.kubernetes_version

  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = true
  }

  vpc_config {
    endpoint_private_access = false
    endpoint_public_access  = true
    subnet_ids              = aws_subnet.public[*].id
  }

  tags = {
    Name      = local.name_prefix
    ManagedBy = "panw-broker"
  }

  depends_on = [
    aws_iam_role_policy_attachment.cluster_policy,
  ]
}

resource "aws_eks_node_group" "default" {
  cluster_name    = aws_eks_cluster.cluster.name
  node_group_name = "${local.name_prefix}-nodes"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = aws_subnet.public[*].id
  instance_types  = var.node_instance_types
  disk_size       = var.node_disk_size_gb

  scaling_config {
    desired_size = var.node_desired_size
    min_size     = var.node_min_size
    max_size     = var.node_max_size
  }

  update_config {
    max_unavailable = 1
  }

  tags = {
    Name      = "${local.name_prefix}-nodes"
    ManagedBy = "panw-broker"
  }

  depends_on = [
    aws_internet_gateway.main,
    aws_iam_role_policy_attachment.node_worker,
    aws_iam_role_policy_attachment.node_cni,
    aws_iam_role_policy_attachment.node_ecr,
    aws_route_table_association.public,
  ]
}

resource "aws_ecr_repository" "app" {
  name         = local.ecr_repository
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name      = local.ecr_repository
    ManagedBy = "panw-broker"
  }
}

resource "null_resource" "app_image" {
  triggers = {
    app_source_hash = local.app_source_hash
    image_uri       = local.image_uri
  }

  provisioner "local-exec" {
    working_dir = local.app_context_abs
    interpreter = ["/bin/bash", "-c"]
    command     = <<-EOT
      set -euo pipefail
      mkdir -p build
      gcc -Os -static -o build/health-api server.c
      aws ecr get-login-password --region ${var.region} | docker login --username AWS --password-stdin ${local.registry}
      docker build -t ${local.image_uri} .
      docker push ${local.image_uri}
    EOT
  }

  depends_on = [
    aws_ecr_repository.app,
  ]
}

data "aws_eks_cluster_auth" "cluster" {
  name = aws_eks_cluster.cluster.name
}

provider "kubernetes" {
  host                   = aws_eks_cluster.cluster.endpoint
  cluster_ca_certificate = base64decode(aws_eks_cluster.cluster.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.cluster.token
}

resource "kubernetes_deployment_v1" "app" {
  wait_for_rollout = true

  metadata {
    name      = local.app_label
    namespace = var.app_namespace
    labels = {
      app = local.app_label
    }
  }

  spec {
    replicas = var.app_replicas

    selector {
      match_labels = {
        app = local.app_label
      }
    }

    template {
      metadata {
        labels = {
          app = local.app_label
        }
      }

      spec {
        container {
          name              = local.app_label
          image             = local.image_uri
          image_pull_policy = "Always"

          port {
            name           = "http"
            container_port = var.app_container_port
          }

          readiness_probe {
            http_get {
              path = var.app_health_path
              port = var.app_container_port
            }
            initial_delay_seconds = 3
            period_seconds        = 5
          }

          liveness_probe {
            http_get {
              path = var.app_health_path
              port = var.app_container_port
            }
            initial_delay_seconds = 10
            period_seconds        = 10
          }
        }
      }
    }
  }

  depends_on = [
    null_resource.app_image,
    aws_eks_node_group.default,
  ]
}

resource "kubernetes_service_v1" "app" {
  wait_for_load_balancer = true

  metadata {
    name      = local.app_label
    namespace = var.app_namespace
    annotations = {
      "service.beta.kubernetes.io/aws-load-balancer-scheme" = "internet-facing"
      "service.beta.kubernetes.io/aws-load-balancer-type"   = "nlb"
    }
    labels = {
      app = local.app_label
    }
  }

  spec {
    type = "LoadBalancer"

    selector = {
      app = local.app_label
    }

    port {
      name        = "http"
      port        = var.app_port
      target_port = var.app_container_port
      protocol    = "TCP"
    }
  }

  depends_on = [
    kubernetes_deployment_v1.app,
  ]
}

locals {
  service_hostname = try(kubernetes_service_v1.app.status[0].load_balancer[0].ingress[0].hostname, null)
  app_url          = local.service_hostname == null ? null : "http://${local.service_hostname}"
  app_health_url   = local.service_hostname == null ? null : "http://${local.service_hostname}${var.app_health_path}"
}
