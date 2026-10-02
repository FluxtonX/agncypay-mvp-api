variable "aws_region" {
  type        = string
  description = "AWS region for the staging environment."
  default     = "us-east-1"
}

variable "environment" {
  type        = string
  description = "Environment name used in resource names and tags."
  default     = "staging"
}

variable "domain_name" {
  type        = string
  description = "Verified SES domain managed manually in GoDaddy."
  default     = "agncy.xyz"
}

variable "api_domain_name" {
  type        = string
  description = "Public HTTPS API hostname."
  default     = "api-staging.agncy.xyz"
}

variable "frontend_url" {
  type        = string
  description = "Allowed staging web origin and base URL used in auth emails."
  default     = "https://staging.agncy.xyz"
}

variable "auth_email_from" {
  type        = string
  description = "Verified SES From address."
  default     = "AgncyPay <no-reply@agncy.xyz>"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC IPv4 range."
  default     = "10.20.0.0/16"
}

variable "database_name" {
  type        = string
  description = "Initial PostgreSQL database."
  default     = "agncypay"
}

variable "database_username" {
  type        = string
  description = "RDS managed master username for MVP staging."
  default     = "agncypay_admin"
}

variable "database_instance_class" {
  type        = string
  description = "Small staging RDS instance class."
  default     = "db.t4g.micro"
}

variable "container_image" {
  type        = string
  description = "Immutable ECR image URI, preferably with a Git SHA tag or digest."
  default     = ""

  validation {
    condition     = !var.create_task_definition || length(trimspace(var.container_image)) > 0
    error_message = "container_image is required when create_task_definition=true."
  }
}

variable "create_task_definition" {
  type        = bool
  description = "Register the API/migration task definition after the first image is pushed."
  default     = false
}

variable "certificate_ready" {
  type        = bool
  description = "Set true only after GoDaddy ACM validation records resolve."
  default     = false
}

variable "deploy_service" {
  type        = bool
  description = "Create the ECS API service after task definition, migration, and certificate gates pass."
  default     = false

  validation {
    condition     = !var.deploy_service || (var.create_task_definition && var.certificate_ready)
    error_message = "deploy_service=true requires create_task_definition=true and certificate_ready=true."
  }
}

variable "desired_count" {
  type        = number
  description = "MVP staging API task count. Keep at one until shared throttling and multi-task gates exist."
  default     = 1

  validation {
    condition     = var.desired_count == 1
    error_message = "This MVP staging stack intentionally supports one API task only."
  }
}
