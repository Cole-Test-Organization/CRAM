locals {
  endpoint_ipv4_addresses = distinct(flatten(proxmox_virtual_environment_vm.endpoint.ipv4_addresses))
  endpoint_usable_ipv4_addresses = [
    for address in local.endpoint_ipv4_addresses : address
    if address != "127.0.0.1" && !startswith(address, "169.254.")
  ]
}

output "endpoint" {
  description = "Broker-facing Windows endpoint identity and available connection metadata"
  value = {
    instance_id    = proxmox_virtual_environment_vm.endpoint.vm_id
    vm_id          = proxmox_virtual_environment_vm.endpoint.vm_id
    vm_name        = proxmox_virtual_environment_vm.endpoint.name
    node_name      = var.target_node
    private_ip     = try(local.endpoint_usable_ipv4_addresses[0], null)
    ipv4_addresses = local.endpoint_usable_ipv4_addresses
    rdp_port       = var.rdp_port
    rdp_username   = var.rdp_port == null ? null : var.admin_username
    ssh_port       = var.ssh_port
    ssh_username   = var.ssh_port == null ? null : var.admin_username
  }
}
