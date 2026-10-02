output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "rds_endpoint" {
  value = aws_db_instance.postgres.endpoint
}

output "alb_dns_name" {
  value = aws_lb.api.dns_name
}

output "api_dns_record" {
  value = {
    type  = "CNAME"
    host  = "api-staging"
    value = aws_lb.api.dns_name
  }
}

output "acm_validation_records" {
  value = [for option in aws_acm_certificate.api.domain_validation_options : {
    type  = option.resource_record_type
    name  = option.resource_record_name
    value = option.resource_record_value
  }]
}

output "acm_certificate_arn" {
  value = aws_acm_certificate.api.arn
}

output "ses_verification_record" {
  value = {
    type  = "TXT"
    name  = "_amazonses.${var.domain_name}"
    value = aws_ses_domain_identity.main.verification_token
  }
}

output "ses_dkim_records" {
  value = [for token in aws_ses_domain_dkim.main.dkim_tokens : {
    type  = "CNAME"
    name  = "${token}._domainkey.${var.domain_name}"
    value = "${token}.dkim.amazonses.com"
  }]
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = var.deploy_service && var.certificate_ready ? aws_ecs_service.api[0].name : null
}

output "task_definition_arn" {
  value = var.create_task_definition ? aws_ecs_task_definition.api[0].arn : null
}

output "database_subnet_ids" {
  value = [aws_subnet.database_a.id, aws_subnet.database_b.id]
}

output "public_subnet_ids" {
  value = [aws_subnet.public_a.id, aws_subnet.public_b.id]
}

output "api_security_group_id" {
  value = aws_security_group.api.id
}
