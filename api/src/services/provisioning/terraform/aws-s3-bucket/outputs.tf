output "bucket" {
  description = "S3 bootstrap bucket identifiers."
  value = {
    name                 = aws_s3_bucket.bootstrap.id
    arn                  = aws_s3_bucket.bootstrap.arn
    region               = var.region
    allowed_source_cidrs = var.allowed_source_cidrs
  }
}
