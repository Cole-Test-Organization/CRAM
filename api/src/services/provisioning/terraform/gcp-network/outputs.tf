output "network" {
  description = "GCP network identifiers other stacks and the broker reference."
  value = {
    project           = var.project
    region            = var.region
    network_name      = google_compute_network.main.name
    network_id        = google_compute_network.main.id
    network_self_link = google_compute_network.main.self_link
    management_subnet = {
      name      = google_compute_subnetwork.management.name
      self_link = google_compute_subnetwork.management.self_link
      cidr      = google_compute_subnetwork.management.ip_cidr_range
    }
    untrust_subnet = {
      name      = google_compute_subnetwork.untrust.name
      self_link = google_compute_subnetwork.untrust.self_link
      cidr      = google_compute_subnetwork.untrust.ip_cidr_range
    }
    trust_subnet = {
      name      = google_compute_subnetwork.trust.name
      self_link = google_compute_subnetwork.trust.self_link
      cidr      = google_compute_subnetwork.trust.ip_cidr_range
    }
    panorama_subnet = {
      name      = google_compute_subnetwork.panorama.name
      self_link = google_compute_subnetwork.panorama.self_link
      cidr      = google_compute_subnetwork.panorama.ip_cidr_range
    }
    management_tag = "${var.project_name}-management"
    cloud_nat      = var.enable_cloud_nat
  }
}
