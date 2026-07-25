provider "google" {
  project = var.project
  region  = var.region
}

# GCP subnets are regional, not zonal, so this is one subnet per role rather than the
# per-AZ fan-out the AWS network stack builds. Routing inside a VPC is implicit; egress
# for instances without an external IP comes from Cloud NAT instead of a NAT gateway.
locals {
  management_cidr = cidrsubnet(var.vpc_cidr, var.subnet_newbits, var.management_subnet_index)
  untrust_cidr    = cidrsubnet(var.vpc_cidr, var.subnet_newbits, var.untrust_subnet_index)
  trust_cidr      = cidrsubnet(var.vpc_cidr, var.subnet_newbits, var.trust_subnet_index)
  panorama_cidr   = cidrsubnet(var.vpc_cidr, var.subnet_newbits, var.panorama_subnet_index)
}

resource "google_compute_network" "main" {
  name                            = "${var.project_name}-vpc"
  auto_create_subnetworks         = false
  delete_default_routes_on_create = false
  description                     = "Managed by panw-broker"
}

resource "google_compute_subnetwork" "management" {
  name                     = "${var.project_name}-mgmt"
  ip_cidr_range            = local.management_cidr
  region                   = var.region
  network                  = google_compute_network.main.id
  private_ip_google_access = true
}

resource "google_compute_subnetwork" "untrust" {
  name                     = "${var.project_name}-untrust"
  ip_cidr_range            = local.untrust_cidr
  region                   = var.region
  network                  = google_compute_network.main.id
  private_ip_google_access = true
}

resource "google_compute_subnetwork" "trust" {
  name                     = "${var.project_name}-trust"
  ip_cidr_range            = local.trust_cidr
  region                   = var.region
  network                  = google_compute_network.main.id
  private_ip_google_access = true
}

resource "google_compute_subnetwork" "panorama" {
  name                     = "${var.project_name}-panorama"
  ip_cidr_range            = local.panorama_cidr
  region                   = var.region
  network                  = google_compute_network.main.id
  private_ip_google_access = true
}

resource "google_compute_firewall" "internal" {
  name          = "${var.project_name}-allow-internal"
  network       = google_compute_network.main.name
  direction     = "INGRESS"
  source_ranges = [var.vpc_cidr]

  allow {
    protocol = "all"
  }
}

resource "google_compute_firewall" "management" {
  name          = "${var.project_name}-allow-management"
  network       = google_compute_network.main.name
  direction     = "INGRESS"
  source_ranges = var.allowed_source_cidrs
  target_tags   = ["${var.project_name}-management"]

  allow {
    protocol = "tcp"
    ports    = ["22", "443", "3389"]
  }

  allow {
    protocol = "icmp"
  }
}

# 35.235.240.0/20 is Google's fixed IAP TCP-forwarding range — the path the broker's
# IAP tunnels take to instances that have no external IP.
resource "google_compute_firewall" "iap" {
  count = var.enable_iap_ingress ? 1 : 0

  name          = "${var.project_name}-allow-iap"
  network       = google_compute_network.main.name
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]

  allow {
    protocol = "tcp"
    ports    = ["22", "3389"]
  }
}

resource "google_compute_router" "main" {
  count = var.enable_cloud_nat ? 1 : 0

  name    = "${var.project_name}-router"
  region  = var.region
  network = google_compute_network.main.id
}

resource "google_compute_router_nat" "main" {
  count = var.enable_cloud_nat ? 1 : 0

  name                               = "${var.project_name}-nat"
  router                             = google_compute_router.main[0].name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = false
    filter = "ERRORS_ONLY"
  }
}
