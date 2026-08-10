provider "proxmox" {
  endpoint  = var.proxmox_endpoint
  api_token = var.proxmox_api_token
  insecure  = var.proxmox_insecure

  ssh {
    agent    = true
    username = var.proxmox_ssh_username
  }
}

resource "proxmox_virtual_environment_vm" "endpoint" {
  name        = var.vm_name
  description = "Windows endpoint managed by panw-broker"
  node_name   = var.target_node
  vm_id       = var.vm_id
  started     = var.started

  stop_on_destroy  = true
  purge_on_destroy = true

  clone {
    vm_id        = var.source_vm_id
    node_name    = var.source_node
    datastore_id = var.vm_datastore_id
    full         = true
    retries      = 3
  }

  cpu {
    cores = var.cpu_cores
    type  = var.cpu_type
  }

  memory {
    dedicated = var.memory_mb
  }

  agent {
    enabled = var.agent_enabled
    timeout = var.agent_timeout

    wait_for_ip {
      enabled = var.wait_for_ipv4
      ipv4    = var.wait_for_ipv4
    }
  }

  dynamic "network_device" {
    for_each = var.interfaces
    content {
      bridge      = network_device.value.bridge
      model       = network_device.value.model
      vlan_id     = network_device.value.vlanId
      mac_address = network_device.value.macAddress
      firewall    = network_device.value.firewall
    }
  }

  operating_system {
    type = var.operating_system_type
  }

  tags = var.tags
}
