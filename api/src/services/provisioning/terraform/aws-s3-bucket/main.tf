provider "aws" {
  region = var.region
}

locals {
  use_explicit_bucket_name = trimspace(var.bucket_name) != ""
  bucket_prefix            = replace("${var.project_name}-bootstrap-", "/[^a-z0-9.-]/", "-")
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "bootstrap" {
  bucket        = local.use_explicit_bucket_name ? var.bucket_name : null
  bucket_prefix = local.use_explicit_bucket_name ? null : local.bucket_prefix
  force_destroy = var.force_destroy

  tags = {
    Name      = local.use_explicit_bucket_name ? var.bucket_name : local.bucket_prefix
    ManagedBy = "panw-broker"
    Purpose   = "bootstrap-artifacts"
  }
}

resource "aws_s3_bucket_public_access_block" "bootstrap" {
  bucket = aws_s3_bucket.bootstrap.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "bootstrap" {
  bucket = aws_s3_bucket.bootstrap.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "bootstrap" {
  bucket = aws_s3_bucket.bootstrap.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "bootstrap" {
  bucket = aws_s3_bucket.bootstrap.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_policy" "bootstrap_ip_restricted" {
  bucket = aws_s3_bucket.bootstrap.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyObjectAccessOutsideAllowedSourceCidrs"
        Effect    = "Deny"
        Principal = "*"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.bootstrap.arn}/*"
        Condition = {
          NotIpAddress = {
            "aws:SourceIp" = var.allowed_source_cidrs
          }
        }
      },
      {
        Sid       = "DenyBucketListingOutsideAllowedSourceCidrs"
        Effect    = "Deny"
        Principal = "*"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.bootstrap.arn
        Condition = {
          NotIpAddress = {
            "aws:SourceIp" = var.allowed_source_cidrs
          }
        }
      },
      {
        Sid    = "AllowAccountAccessFromAllowedSourceCidrs"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.bootstrap.arn,
          "${aws_s3_bucket.bootstrap.arn}/*"
        ]
        Condition = {
          IpAddress = {
            "aws:SourceIp" = var.allowed_source_cidrs
          }
        }
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.bootstrap]
}
