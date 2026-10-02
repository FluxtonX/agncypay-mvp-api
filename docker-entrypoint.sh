#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  : "${DB_HOST:?DB_HOST is required when DATABASE_URL is unset}"
  : "${DB_NAME:?DB_NAME is required when DATABASE_URL is unset}"
  : "${DB_USER:?DB_USER is required when DATABASE_URL is unset}"
  : "${DB_PASSWORD:?DB_PASSWORD is required when DATABASE_URL is unset}"
  DB_PORT="${DB_PORT:-5432}"
  export DB_PORT
  DATABASE_URL="$(node -e 'const encode = encodeURIComponent; process.stdout.write(`postgresql://${encode(process.env.DB_USER)}:${encode(process.env.DB_PASSWORD)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${encode(process.env.DB_NAME)}?schema=public&sslmode=require`)')"
  export DATABASE_URL
fi

exec "$@"
