output "vm_id" {
  description = "Proxmox VM ID"
  value       = proxmox_virtual_environment_vm.firewall.vm_id
}

output "vm_name" {
  description = "Proxmox VM name"
  value       = proxmox_virtual_environment_vm.firewall.name
}

output "bootstrap_iso_file_id" {
  description = "Uploaded bootstrap ISO file ID"
  value       = proxmox_virtual_environment_file.bootstrap_iso.id
}

