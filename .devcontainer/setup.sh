#!/usr/bin/env bash
# One-time setup for GitHub Codespaces / dev containers: database, dependencies, schema, seed data.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f apps/api/.env ] || cp .env.example apps/api/.env

docker compose up -d
echo "Waiting for Postgres..."
until docker compose exec -T postgres pg_isready -U inv -d inventory >/dev/null 2>&1; do sleep 1; done

npm install
npm run db:generate -w @inventory/api
npm run db:migrate
npm run db:seed
echo "Setup done. Sign in with admin@example.com / CHANGE-ME-strong-password"
