output "endpoint" {
  description = "Windows endpoint addressing and AWS identifiers."
  value = {
    hostname       = var.hostname
    instance_id    = aws_instance.endpoint.id
    ami_id         = local.selected_ami_id
    ami_source     = "amazon-windows-server-2022-full-base"
    network_mode   = local.use_existing_network ? "existing" : "managed"
    vpc_id         = local.vpc_id
    subnet_id      = local.subnet_id
    private_ip     = aws_instance.endpoint.private_ip
    public_ip      = var.associate_public_ip ? aws_instance.endpoint.public_ip : null
    rdp_command    = var.enable_rdp && var.associate_public_ip ? "mstsc /v:${aws_instance.endpoint.public_ip}" : null
    rdp_username   = var.admin_username
    ssm_enabled    = var.enable_ssm
    ssm_role_name  = var.enable_ssm ? aws_iam_role.endpoint[0].name : null
    bootstrap_mode = var.bootstrap_method
    ssm_document   = var.bootstrap_method == "ssm" ? aws_ssm_document.koi_bootstrap[0].name : null
    bootstrap_log  = "C:\\ProgramData\\panw-broker\\bootstrap.log"
    koi_log        = "C:\\ProgramData\\panw-broker\\koi.log"
    success_marker = "C:\\ProgramData\\panw-broker\\koi.success"
  }
}
