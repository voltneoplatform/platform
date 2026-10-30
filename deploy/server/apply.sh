#!/usr/bin/env bash
# Runs on the server (as root) for every deploy. deploy/aws/deploy.sh copies the
# release files to /tmp/voltneo-release and pipes a GitHub registry token on stdin.
set -euo pipefail
REL=/tmp/voltneo-release
APP=/opt/voltneo
GHCR_TOKEN=$(cat)
umask 077
install -d -m 750 "$APP"
cd "$APP"

# Generated once, here, and never sent anywhere. Kept by the daily server snapshots.
# Losing KYC_ENCRYPTION_KEY makes stored ID numbers unreadable.
if [ ! -s secrets.env ]; then
  {
    echo "JWT_ACCESS_SECRET='$(openssl rand -base64 48 | tr -d '\n')'"
    echo "OTP_HASH_SECRET='$(openssl rand -base64 48 | tr -d '\n')'"
    echo "KYC_ENCRYPTION_KEY='$(openssl rand -base64 32 | tr -d '\n')'"
  } > secrets.env
  echo "Created new server secrets"
fi
if [ -s "$REL/s3.env" ]; then mv "$REL/s3.env" s3.env; fi
test -s s3.env || { echo "s3.env is missing"; exit 1; }

[ -f .env ] && cp .env .env.previous
caddy_before=$(sha256sum Caddyfile 2>/dev/null || true)
install -m 644 "$REL/compose.yml" compose.yml
install -m 644 "$REL/Caddyfile" Caddyfile
install -m 600 "$REL/.env" .env
install -m 600 "$REL/runtime.env" runtime.env
rm -rf "$REL"

echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:?}" --password-stdin >/dev/null
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
docker compose pull --quiet

echo "Running database migrations"
docker compose run --rm --no-deps -T api node_modules/.bin/prisma migrate deploy
if grep -q "^BOOTSTRAP_SUPER_ADMIN_EMAIL='[^']" runtime.env; then
  docker compose run --rm --no-deps -T api node_modules/.bin/tsx prisma/seed.ts
fi

# Caddy reads its file only at start (its admin endpoint is off), so restart it when the file changed.
if [ "$caddy_before" != "$(sha256sum Caddyfile)" ] && [ -n "$(docker compose ps -q caddy)" ]; then
  echo "Caddyfile changed; Caddy restarts after the update"
  restart_caddy=1
fi
docker compose up -d --remove-orphans --wait --wait-timeout 180 || {
  echo "::error::The new version did not become healthy; rolling back"
  docker compose logs --tail 80 api admin || true
  if [ -f .env.previous ]; then
    cp .env.previous .env
    docker compose up -d --remove-orphans
  fi
  exit 1
}
if [ -n "${restart_caddy:-}" ]; then
  docker compose restart caddy
fi
docker compose ps
docker image prune -af --filter 'until=168h' >/dev/null
echo "Deployed"
