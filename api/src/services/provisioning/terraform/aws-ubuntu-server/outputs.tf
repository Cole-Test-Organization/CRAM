output "server" {
  description = "Ubuntu server addressing and AWS identifiers."
  value = {
    hostname       = var.hostname
    instance_id    = aws_instance.server.id
    ami_id         = data.aws_ami.ubuntu.id
    ami_name       = data.aws_ami.ubuntu.name
    network_mode   = local.use_existing_network ? "existing" : "managed"
    vpc_id         = local.vpc_id
    subnet_id      = local.subnet_id
    private_ip     = aws_instance.server.private_ip
    public_ip      = var.associate_public_ip ? aws_instance.server.public_ip : null
    ssh_command    = var.enable_ssh && var.associate_public_ip ? "ssh ubuntu@${aws_instance.server.public_ip}" : null
    ssm_enabled    = var.enable_ssm
    ssm_role_name  = var.enable_ssm ? aws_iam_role.server[0].name : null
    bootstrap_log  = "/var/log/panw-broker-bootstrap.log"
    success_marker = "/var/lib/panw-broker/bootstrap.success"
  }
}
