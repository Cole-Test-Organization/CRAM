provider "aws" {
  region = var.region
}

resource "aws_route" "egress" {
  route_table_id         = var.route_table_id
  destination_cidr_block = var.destination_cidr_block
  network_interface_id   = var.next_hop_network_interface_id
}
