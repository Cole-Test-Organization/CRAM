output "route" {
  description = "Egress route identifiers."
  value = {
    id                            = aws_route.egress.id
    hostname                      = var.hostname
    project_name                  = var.project_name
    route_table_id                = var.route_table_id
    destination_cidr_block        = var.destination_cidr_block
    next_hop_network_interface_id = var.next_hop_network_interface_id
  }
}
