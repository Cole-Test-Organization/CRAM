provider "proxmox" {
  endpoint  = var.proxmox_endpoint
  api_token = var.proxmox_api_token
  insecure  = var.proxmox_insecure

  ssh {
    agent    = true
    username = var.proxmox_ssh_username
  }
}

resource "proxmox_virtual_environment_file" "bootstrap_iso" {
  content_type = "iso"
  datastore_id = var.iso_datastore_id
  node_name    = var.target_node
  overwrite    = true

  source_file {
    path      = var.bootstrap_iso_path
    file_name = "${var.vm_name}-bootstrap.iso"
  }
}

resource "proxmox_virtual_environment_vm" "firewall" {
  name        = var.vm_name
  description = "PANW VM-Series firewall managed by panw-broker"
  node_name   = var.target_node
  vm_id       = var.vm_id
  started     = var.started

  stop_on_destroy  = true
  purge_on_destroy = true

  clone {
    vm_id        = var.template_vm_id
    node_name    = var.template_node
    datastore_id = var.vm_datastore_id
    full         = true
  }

  cpu {
    cores = var.cpu_cores
    type  = var.cpu_type
  }

  memory {
    dedicated = var.memory_mb
  }

  cdrom {
    file_id   = proxmox_virtual_environment_file.bootstrap_iso.id
    interface = "ide2"
  }

  dynamic "network_device" {
    for_each = var.interfaces
    content {
      bridge      = network_device.value.bridge
      model       = network_device.value.model
      vlan_id     = network_device.value.vlan_id
      mac_address = network_device.value.mac_address
      firewall    = network_device.value.firewall
    }
  }

  operating_system {
    type = "l26"
  }

  tags = ["panw", "vm-series", "panw-broker"]
}

