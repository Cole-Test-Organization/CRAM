variable "proxmox_endpoint" {
  description = "Proxmox API endpoint, e.g. https://pve.example.local:8006/"
  type        = string
}

variable "proxmox_api_token" {
  description = "Proxmox API token in USER@REALM!TOKENID=SECRET form"
  type        = string
  sensitive   = true
}

variable "proxmox_insecure" {
  description = "Skip TLS verification for self-signed Proxmox certificates"
  type        = bool
  default     = true
}

variable "proxmox_ssh_username" {
  description = "SSH username for provider operations that need SSH"
  type        = string
  default     = "root"
}

variable "target_node" {
  description = "Proxmox node where the firewall VM should run"
  type        = string
}

variable "template_node" {
  description = "Proxmox node where the source template lives"
  type        = string
}

variable "template_vm_id" {
  description = "VM ID of the VM-Series template"
  type        = number
}

variable "vm_id" {
  description = "Optional explicit VM ID for the cloned firewall"
  type        = number
  default     = null
}

variable "vm_name" {
  description = "Firewall VM name and PAN-OS hostname"
  type        = string
}

variable "cpu_cores" {
  description = "vCPU cores"
  type        = number
}

variable "cpu_type" {
  description = "QEMU CPU type"
  type        = string
  default     = "host"
}

variable "memory_mb" {
  description = "Dedicated memory in MB"
  type        = number
}

variable "started" {
  description = "Start the VM after creation"
  type        = bool
  default     = true
}

variable "vm_datastore_id" {
  description = "Target datastore for the full clone"
  type        = string
  default     = "local-lvm"
}

variable "iso_datastore_id" {
  description = "Datastore where the bootstrap ISO should be uploaded"
  type        = string
}

variable "bootstrap_iso_path" {
  description = "Local path to the generated bootstrap ISO"
  type        = string
}

variable "interfaces" {
  description = "Ordered NIC list. interfaces[0] must be management."
  type = list(object({
    name        = string
    bridge      = string
    model       = optional(string, "virtio")
    vlan_id     = optional(number)
    mac_address = optional(string)
    firewall    = optional(bool, false)
  }))
}

