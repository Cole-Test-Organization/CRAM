output "firewall" {
  description = "VM-Series firewall addressing and AWS identifiers."
  value = {
    hostname                   = var.hostname
    role                       = var.role
    instance_id                = aws_instance.firewall.id
    vpc_id                     = local.vpc_id
    management_eni_id          = aws_network_interface.management.id
    management_public          = var.attach_management_elastic_ip ? aws_eip.management[0].public_ip : null
    management_ip              = aws_network_interface.management.private_ip
    untrust_eni_id             = aws_network_interface.untrust.id
    untrust_public             = var.attach_untrust_elastic_ip ? aws_eip.untrust[0].public_ip : null
    untrust_ip                 = aws_network_interface.untrust.private_ip
    trust_eni_id               = aws_network_interface.trust.id
    trust_network_interface_id = aws_network_interface.trust.id
    trust_ip                   = aws_network_interface.trust.private_ip
    https_url                  = var.attach_management_elastic_ip ? "https://${aws_eip.management[0].public_ip}" : null
    ssh_command                = var.attach_management_elastic_ip ? "ssh -i <path-to-private-key> admin@${aws_eip.management[0].public_ip}" : null
  }
}
