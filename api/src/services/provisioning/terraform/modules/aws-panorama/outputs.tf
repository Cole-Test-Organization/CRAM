output "panorama" {
  description = "Panorama management addressing and AWS identifiers."
  value = {
    hostname             = var.hostname
    instance_id          = aws_instance.panorama.id
    network_interface_id = aws_network_interface.panorama.id
    security_group_id    = aws_security_group.panorama.id
    vpc_id               = local.vpc_id
    subnet_id            = local.subnet_id
    mgmt_public          = aws_eip.panorama.public_ip
    mgmt_private         = aws_network_interface.panorama.private_ip
    https_url            = "https://${aws_eip.panorama.public_ip}"
    ssh_command          = "ssh -i <path-to-private-key> admin@${aws_eip.panorama.public_ip}"
  }
}
