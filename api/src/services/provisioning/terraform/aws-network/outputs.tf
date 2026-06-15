output "network" {
  description = "Shared network identifiers for provider resources."
  value = {
    vpc_id                = aws_vpc.main.id
    vpc_cidr              = aws_vpc.main.cidr_block
    public_route_table_id = aws_route_table.public.id
    trust_route_table_ids = aws_route_table.trust[*].id
    panorama_subnet_id    = aws_subnet.panorama.id
    management_subnet_ids = aws_subnet.management[*].id
    untrust_subnet_ids    = aws_subnet.untrust[*].id
    trust_subnet_ids      = aws_subnet.trust[*].id
    availability_zones    = local.availability_zones
  }
}
