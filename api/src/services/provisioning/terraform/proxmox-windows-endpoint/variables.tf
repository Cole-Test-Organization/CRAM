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
  description = "Proxmox node where the endpoint VM should run"
  type        = string
}

variable "source_node" {
  description = "Proxmox node where the source Windows VM or template lives"
  type        = string
}

variable "source_vm_id" {
  description = "VM ID of the source Windows VM or template"
  type        = number
}

variable "vm_id" {
  description = "Optional explicit VM ID for the cloned endpoint"
  type        = number
  default     = null
}

variable "vm_name" {
  description = "Proxmox VM name for the endpoint"
  type        = string
}

variable "cpu_cores" {
  description = "vCPU cores"
  type        = number
  default     = 4
}

variable "cpu_type" {
  description = "QEMU CPU type"
  type        = string
  default     = "host"
}

variable "memory_mb" {
  description = "Dedicated memory in MB"
  type        = number
  default     = 8192
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

variable "interfaces" {
  description = "Ordered network interfaces for the cloned endpoint"
  type = list(object({
    name       = string
    bridge     = string
    model      = optional(string, "e1000")
    vlanId     = optional(number)
    macAddress = optional(string)
    firewall   = optional(bool, false)
  }))
}

variable "agent_enabled" {
  description = "Enable the QEMU guest-agent channel"
  type        = bool
  default     = true
}

variable "agent_timeout" {
  description = "Maximum time to wait for the QEMU guest agent"
  type        = string
  default     = "15m"
}

variable "wait_for_ipv4" {
  description = "Wait for a non-loopback IPv4 address before apply succeeds"
  type        = bool
  default     = true
}

variable "operating_system_type" {
  description = "Proxmox operating-system type for the cloned Windows guest"
  type        = string
  default     = "win11"
}

variable "admin_username" {
  description = "Local Windows administrator username advertised in connection metadata"
  type        = string
  default     = "Administrator"
}

variable "rdp_port" {
  description = "Inbound RDP port advertised by templates whose Windows edition supports RDP hosting"
  type        = number
  default     = null
}

variable "ssh_port" {
  description = "Inbound OpenSSH port advertised by templates with Windows OpenSSH Server enabled"
  type        = number
  default     = null
}

variable "tags" {
  description = "Tags added to the cloned endpoint"
  type        = list(string)
  default     = ["panw-broker", "windows-endpoint"]
}
