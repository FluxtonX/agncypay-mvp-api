resource "aws_db_subnet_group" "main" {
  name       = "agncypay-${var.environment}"
  subnet_ids = [aws_subnet.database_a.id, aws_subnet.database_b.id]
}

resource "aws_db_instance" "postgres" {
  identifier = "agncypay-${var.environment}"

  engine         = "postgres"
  engine_version = "16"
  instance_class = var.database_instance_class

  db_name                     = var.database_name
  username                    = var.database_username
  manage_master_user_password = true
  port                        = 5432

  allocated_storage     = 20
  max_allocated_storage = 50
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period    = 7
  copy_tags_to_snapshot      = true
  deletion_protection        = false
  skip_final_snapshot        = true
  apply_immediately          = true
  auto_minor_version_upgrade = true

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
}

resource "random_password" "jwt_access" {
  length  = 64
  special = false
}

resource "random_password" "jwt_refresh" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "auth" {
  name                    = "agncypay/${var.environment}/auth"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "auth" {
  secret_id = aws_secretsmanager_secret.auth.id
  secret_string = jsonencode({
    JWT_SECRET         = random_password.jwt_access.result
    JWT_REFRESH_SECRET = random_password.jwt_refresh.result
  })
}
