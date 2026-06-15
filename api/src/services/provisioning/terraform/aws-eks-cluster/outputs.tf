output "eks" {
  description = "EKS cluster identifiers."
  value = {
    cluster_name        = aws_eks_cluster.cluster.name
    cluster_arn         = aws_eks_cluster.cluster.arn
    endpoint            = aws_eks_cluster.cluster.endpoint
    node_group_name     = aws_eks_node_group.default.node_group_name
    kubernetes_version  = aws_eks_cluster.cluster.version
    vpc_id              = aws_vpc.main.id
    public_subnet_ids   = aws_subnet.public[*].id
    ecr_repository_name = aws_ecr_repository.app.name
    ecr_repository_url  = aws_ecr_repository.app.repository_url
  }
}

output "app" {
  description = "Health API deployment and public service details."
  value = {
    name                   = var.app_name
    namespace              = var.app_namespace
    image_uri              = local.image_uri
    replicas               = var.app_replicas
    service_name           = kubernetes_service_v1.app.metadata[0].name
    service_hostname       = local.service_hostname
    url                    = local.app_url
    health_url             = local.app_health_url
    verify_path            = var.app_health_path
    verify_timeout_seconds = var.app_verify_timeout_seconds
  }
}
