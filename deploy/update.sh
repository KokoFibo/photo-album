#!/usr/bin/env bash
# Safe staged production deployment.
# Run: sudo bash deploy/update.sh

set -Eeuo pipefail
umask 022

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo."
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE22="/opt/node22/bin/node"
NPM22="/opt/node22/bin/npm"
API_SERVICE="album-api.service"
API_URL="http://127.0.0.1:8787/api/auth/ok"

export PATH="/opt/node22/bin:$PATH"
export NODE_OPTIONS="--max-old-space-size=256"

STAGE_DIR=""
API_SWAP_STARTED=0
FRONTEND_SWAP_STARTED=0
DEPLOY_COMPLETE=0

cleanup() {
  if [ "$DEPLOY_COMPLETE" -eq 1 ] && [ -n "$STAGE_DIR" ]; then
    rm -rf -- "$STAGE_DIR"
  fi
}

rollback() {
  echo
  echo "===== ROLLBACK ====="

  systemctl stop "$API_SERVICE" || true

  if [ "$FRONTEND_SWAP_STARTED" -eq 1 ]; then
    if [ -d "$STAGE_DIR/frontend-old" ]; then
      rm -rf -- "$APP_DIR/dist"
      mv "$STAGE_DIR/frontend-old" "$APP_DIR/dist"
    fi
  fi

  if [ "$API_SWAP_STARTED" -eq 1 ]; then
    if [ -d "$STAGE_DIR/api-old-dist" ]; then
      rm -rf -- "$APP_DIR/worker/dist"
      mv "$STAGE_DIR/api-old-dist" "$APP_DIR/worker/dist"
    fi

    if [ -d "$STAGE_DIR/api-old-node_modules" ]; then
      rm -rf -- "$APP_DIR/worker/node_modules"
      mv "$STAGE_DIR/api-old-node_modules" "$APP_DIR/worker/node_modules"
    fi
  fi

  systemctl start "$API_SERVICE" || true

  echo "Rollback attempt completed."
}

on_error() {
  status=$?
  trap - ERR

  if [ "$API_SWAP_STARTED" -eq 1 ] || \
     [ "$FRONTEND_SWAP_STARTED" -eq 1 ]; then
    rollback
  fi

  echo "Deployment failed (exit code: $status)."
  exit "$status"
}

trap cleanup EXIT
trap on_error ERR

echo "===== PRE-DEPLOYMENT CHECKS ====="

for cmd in git curl npm runuser systemctl pg_dump pg_restore gpg; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing required command: $cmd"
    exit 1
  }
done

if [ ! -x "$NODE22" ] || [ ! -x "$NPM22" ]; then
  echo "Node.js 22 installation not found."
  exit 1
fi

NODE_VERSION="$("$NODE22" -p 'process.versions.node.split(".")[0]')"

if [ "$NODE_VERSION" != "22" ]; then
  echo "Expected Node.js 22."
  exit 1
fi

for file in \
  /etc/album/album.env \
  /etc/album/backup.pass \
  "$APP_DIR/db/.env" \
  "$APP_DIR/package-lock.json" \
  "$APP_DIR/worker/package-lock.json"; do

  if [ ! -s "$file" ]; then
    echo "Required file is missing or empty: $file"
    exit 1
  fi
done

if ! systemctl cat "$API_SERVICE" >/dev/null 2>&1; then
  echo "API service is not installed."
  exit 1
fi

if ! systemctl show -p ExecStart --value "$API_SERVICE" |
  grep -Fq "$NODE22"; then
  echo "API service is not configured for Node.js 22."
  exit 1
fi

for dir in \
  "$APP_DIR/dist" \
  "$APP_DIR/worker/dist" \
  "$APP_DIR/worker/node_modules"; do

  if [ ! -d "$dir" ]; then
    echo "Existing application directory is missing: $dir"
    exit 1
  fi
done

set -a
. /etc/album/album.env
set +a

: "${APP_URL:?APP_URL is missing from production environment}"

cd "$APP_DIR"

echo "Node.js: $("$NODE22" --version)"
echo "Application: $APP_DIR"
echo "Production URL: $APP_URL"

echo
echo "===== CREATE STAGING DIRECTORY ====="

STAGE_DIR="$(mktemp -d /var/www/.album-deploy.XXXXXX)"
chown kokofibo:kokofibo "$STAGE_DIR"
chmod 700 "$STAGE_DIR"

echo "Staging directory created."

echo
echo "===== INSTALL ROOT DEPENDENCIES ====="

runuser -u kokofibo -- env \
  PATH="$PATH" \
  NODE_OPTIONS="$NODE_OPTIONS" \
  npm ci --legacy-peer-deps --no-audit --no-fund

echo
echo "===== BUILD FRONTEND IN STAGING ====="

runuser -u kokofibo -- env \
  PATH="$PATH" \
  NODE_OPTIONS="$NODE_OPTIONS" \
  PUBLIC_API_URL="$APP_URL" \
  npm run build -- --outDir "$STAGE_DIR/frontend"

if [ ! -s "$STAGE_DIR/frontend/index.html" ]; then
  echo "Frontend build failed."
  exit 1
fi

echo
echo "===== PREPARE API STAGING ====="

runuser -u kokofibo -- mkdir "$STAGE_DIR/api"

runuser -u kokofibo -- cp \
  "$APP_DIR/worker/package.json" \
  "$APP_DIR/worker/package-lock.json" \
  "$STAGE_DIR/api/"

runuser -u kokofibo -- cp -a \
  "$APP_DIR/worker/src" \
  "$STAGE_DIR/api/src"

echo
echo "===== INSTALL API DEPENDENCIES IN STAGING ====="

(
  cd "$STAGE_DIR/api"

  runuser -u kokofibo -- env \
    PATH="$PATH" \
    NODE_OPTIONS="$NODE_OPTIONS" \
    npm ci --omit=dev --no-audit --no-fund

  echo
  echo "===== BUILD API IN STAGING ====="

  runuser -u kokofibo -- env \
    PATH="$PATH" \
    NODE_OPTIONS="$NODE_OPTIONS" \
    npm run build:node
)

if [ ! -s "$STAGE_DIR/api/dist/server.mjs" ]; then
  echo "API build artifact is missing."
  exit 1
fi

chown -R album:album "$STAGE_DIR/api"
chmod -R a+rX "$STAGE_DIR/api"

echo
echo "===== CREATE AND VERIFY DATABASE BACKUP ====="

bash "$APP_DIR/deploy/backup.sh"

echo
echo "===== APPLY DATABASE MIGRATIONS ====="

SKIP_SEED=1 bash "$APP_DIR/db/migrate.sh"

echo
echo "===== SWAP API FILES ====="

systemctl stop "$API_SERVICE"
API_SWAP_STARTED=1

mv "$APP_DIR/worker/dist" "$STAGE_DIR/api-old-dist"
mv "$APP_DIR/worker/node_modules" "$STAGE_DIR/api-old-node_modules"

mv "$STAGE_DIR/api/dist" "$APP_DIR/worker/dist"
mv "$STAGE_DIR/api/node_modules" "$APP_DIR/worker/node_modules"

echo
echo "===== START NEW API ====="

if ! systemctl start "$API_SERVICE"; then
  echo "API failed to start."
  false
fi

API_OK=0

for i in $(seq 1 30); do
  if curl -fsS "$API_URL" >/dev/null; then
    API_OK=1
    break
  fi
  sleep 1
done

if [ "$API_OK" -ne 1 ]; then
  echo "API health check failed."
  journalctl -u "$API_SERVICE" -n 40 --no-pager || true
  false
fi

echo
echo "===== SWAP FRONTEND ====="

FRONTEND_SWAP_STARTED=1

mv "$APP_DIR/dist" "$STAGE_DIR/frontend-old"
mv "$STAGE_DIR/frontend" "$APP_DIR/dist"

if [ ! -s "$APP_DIR/dist/index.html" ]; then
  echo "Frontend verification failed."
  false
fi

DEPLOY_COMPLETE=1

echo
echo "======================================"
echo "Deployment completed successfully."
echo "API: Node.js 22"
echo "Frontend: staged build"
echo "Database backup: verified"
echo "======================================"
