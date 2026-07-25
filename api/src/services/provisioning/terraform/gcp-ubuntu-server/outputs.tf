output "server" {
  description = "Ubuntu server addressing and GCP identifiers."
  value = {
    hostname       = var.hostname
    instance_name  = google_compute_instance.server.name
    instance_id    = google_compute_instance.server.instance_id
    self_link      = google_compute_instance.server.self_link
    project        = var.project
    region         = var.region
    zone           = local.zone
    machine_type   = var.machine_type
    network_mode   = local.use_existing_network ? "existing" : "managed"
    network        = local.network_name
    subnetwork     = local.subnetwork
    private_ip     = google_compute_instance.server.network_interface[0].network_ip
    public_ip      = var.associate_public_ip ? google_compute_instance.server.network_interface[0].access_config[0].nat_ip : null
    ssh_command    = var.enable_ssh && var.associate_public_ip ? "ssh ${var.admin_username}@${google_compute_instance.server.network_interface[0].access_config[0].nat_ip}" : null
    iap_enabled    = var.enable_iap
    bootstrap_log  = "/var/log/panw-broker-bootstrap.log"
    success_marker = "/var/lib/panw-broker/bootstrap.success"
  }
}
