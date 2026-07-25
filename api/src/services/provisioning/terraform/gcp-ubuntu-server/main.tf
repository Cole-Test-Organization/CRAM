provider "google" {
  project = var.project
  region  = var.region
}

locals {
  use_existing_network = var.network_mode == "existing" || (var.network != null && var.subnetwork != null)
  zone                 = coalesce(var.zone, "${var.region}-a")
  subnet_cidr          = var.subnet_cidr == null ? cidrsubnet(var.vpc_cidr, 8, 40) : var.subnet_cidr
  network              = local.use_existing_network ? var.network : google_compute_network.main[0].id
  subnetwork           = local.use_existing_network ? var.subnetwork : google_compute_subnetwork.server[0].id
  network_name         = local.use_existing_network ? var.network : google_compute_network.main[0].name
  instance_tag         = "${var.project_name}-${var.hostname}"
  koi_interpreter      = (var.koi_interpreter == null || var.koi_interpreter == "") ? "bash" : var.koi_interpreter
  bootstrap_script = templatefile("${path.module}/startup-script.sh.tftpl", {
    hostname              = var.hostname
    admin_username        = var.admin_username
    packages_json         = jsonencode(var.bootstrap_packages)
    commands_json         = jsonencode(var.bootstrap_commands)
    koi_script_inline_b64 = base64encode(var.koi_script_inline == null ? "" : var.koi_script_inline)
    koi_script_sha256     = var.koi_script_sha256 == null ? "" : var.koi_script_sha256
    koi_interpreter       = local.koi_interpreter
    koi_arguments_b64     = base64encode(jsonencode(var.koi_arguments))
    koi_environment_b64   = base64encode(jsonencode(var.koi_environment))
  })
}

resource "google_compute_network" "main" {
  count = local.use_existing_network ? 0 : 1

  name                    = "${var.project_name}-${var.hostname}-vpc"
  auto_create_subnetworks = false
  description             = "Managed by panw-broker"
}

resource "google_compute_subnetwork" "server" {
  count = local.use_existing_network ? 0 : 1

  name                     = "${var.project_name}-${var.hostname}-subnet"
  ip_cidr_range            = local.subnet_cidr
  region                   = var.region
  network                  = google_compute_network.main[0].id
  private_ip_google_access = true
}

# Without an external IP the instance has no egress at all unless Cloud NAT exists, so
# the managed path creates one by default — apt/npm bootstrap depends on it.
resource "google_compute_router" "main" {
  count = !local.use_existing_network && var.enable_cloud_nat ? 1 : 0

  name    = "${var.project_name}-${var.hostname}-router"
  region  = var.region
  network = google_compute_network.main[0].id
}

resource "google_compute_router_nat" "main" {
  count = !local.use_existing_network && var.enable_cloud_nat ? 1 : 0

  name                               = "${var.project_name}-${var.hostname}-nat"
  router                             = google_compute_router.main[0].name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

# GCP firewall rules live on the VPC and select instances by tag, which is why the
# instance carries local.instance_tag rather than being handed a security group.
resource "google_compute_firewall" "ssh" {
  count = !local.use_existing_network && var.enable_ssh ? 1 : 0

  name          = "${var.project_name}-${var.hostname}-allow-ssh"
  network       = google_compute_network.main[0].name
  direction     = "INGRESS"
  source_ranges = var.allowed_source_cidrs
  target_tags   = [local.instance_tag]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_firewall" "iap" {
  count = !local.use_existing_network && var.enable_iap ? 1 : 0

  name          = "${var.project_name}-${var.hostname}-allow-iap"
  network       = google_compute_network.main[0].name
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = [local.instance_tag]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_instance" "server" {
  name         = "${var.project_name}-${var.hostname}"
  machine_type = var.machine_type
  zone         = local.zone
  tags         = [local.instance_tag]

  boot_disk {
    initialize_params {
      image = var.image
      size  = var.root_volume_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    network    = local.network
    subnetwork = local.subnetwork

    dynamic "access_config" {
      for_each = var.associate_public_ip ? [1] : []
      content {}
    }
  }

  metadata = {
    "ssh-keys"       = "${var.admin_username}:${var.admin_public_key}"
    "startup-script" = local.bootstrap_script
    # OS Login would override the ssh-keys metadata the broker installs.
    "enable-oslogin" = "FALSE"
  }

  dynamic "service_account" {
    for_each = var.service_account_email == null ? [] : [1]
    content {
      email  = var.service_account_email
      scopes = var.service_account_scopes
    }
  }

  labels = {
    managed-by = "panw-broker"
    role       = "ubuntu-server"
  }

  lifecycle {
    precondition {
      condition     = !local.use_existing_network || (var.network != null && var.subnetwork != null)
      error_message = "network and subnetwork are required when network_mode is existing."
    }
    precondition {
      condition     = var.associate_public_ip || var.enable_cloud_nat || local.use_existing_network
      error_message = "a private managed instance needs enable_cloud_nat=true for package bootstrap egress."
    }
  }
}
