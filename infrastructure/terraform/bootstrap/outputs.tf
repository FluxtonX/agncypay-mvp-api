output "state_bucket_name" {
  description = "Use this value in staging/backend.hcl."
  value       = aws_s3_bucket.terraform_state.id
}

output "backend_hcl" {
  description = "Non-secret backend configuration values."
  value = {
    bucket       = aws_s3_bucket.terraform_state.id
    key          = "staging/terraform.tfstate"
    region       = var.aws_region
    encrypt      = true
    use_lockfile = true
  }
}
