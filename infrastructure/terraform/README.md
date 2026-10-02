# AgncyPay minimal AWS staging infrastructure

This Terraform creates the approved MVP staging environment in `us-east-1`:

- S3 remote Terraform state with native S3 locking
- VPC with two public application/ALB subnets and two isolated database subnets
- one public-IP ECS Fargate API task reachable only from the ALB security group
- private, encrypted, single-AZ RDS PostgreSQL with seven-day backups
- ECR, ECS, ALB, ACM, Secrets Manager, CloudWatch, and SES domain identity

It deliberately does not create Redis, SQS, NAT gateways, WAF, Multi-AZ RDS, or multiple API tasks. Those are production/later-phase controls. Never use this topology for real-money production.

The deployment is intentionally staged because GoDaddy DNS and the first ECR image are external prerequisites:

1. Apply `bootstrap` locally to create the remote-state bucket.
2. Initialize `staging` with `backend.hcl`.
3. Apply staging with `deploy_service=false` and `certificate_ready=false`.
4. Add the output ACM and SES DNS records in GoDaddy.
5. Build and push the API image to the output ECR URL.
6. Set `container_image` to its immutable digest/SHA tag and `create_task_definition=true`; apply without the service.
7. Set `certificate_ready=true`, apply, and confirm ACM is issued.
8. Run the one-off migration task using the created task definition.
9. Set `deploy_service=true` and apply the ECS service.
10. Add the `api-staging` CNAME output to GoDaddy and run the cloud smoke test.

Exact operator commands are maintained in `docs/aws-mvp-staging-deployment.md` at the workspace root.
