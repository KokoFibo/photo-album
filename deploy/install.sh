#!/usr/bin/env bash
# Album: first-time server setup for Ubuntu or Debian. Run as root from the app folder:   sudo bash deploy/install.sh
# Safe to run again: existing secrets in /etc/album are reused.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Please run with sudo."; exit 1; }
. /etc/os-release; case "${ID:-}" in ubuntu|debian) ;; *) echo "This script supports Ubuntu and Debian only."; exit 1 ;; esac
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
{ [ -f "$APP_DIR/package.json" ] && [ -d "$APP_DIR/db/migrations" ]; } || { echo "Run this from the app folder (package.json and db/ were not found)."; exit 1; }
ask()  { local v; read -rp "$1" v; printf '%s' "$v"; }
asks() { local v; read -rsp "$1" v; echo >&2; printf '%s' "$v"; }
gen()  { openssl rand -hex "$1"; }

mkdir -p /etc/album
if [ -f /etc/album/album.env ] && [ -f /etc/album/admin.env ]; then
  echo "Existing configuration found in /etc/album: reusing it."
  set -a; . /etc/album/admin.env; . /etc/album/album.env; set +a
  DOMAIN="${APP_URL#https://}"
else
  DOMAIN=$(ask "Domain of the site (for example photos.example.com): ")
  ADMIN_EMAIL=$(ask "Email address of the first administrator: ")
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "That does not look like a domain."; exit 1; }
  [[ "$ADMIN_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "That does not look like an email address."; exit 1; }
  R2_ACCOUNT_ID=$(ask "Cloudflare account ID: ")
  R2_BUCKET=$(ask "R2 bucket for photos: ")
  R2_ACCESS_KEY_ID=$(ask "R2 access key ID: ")
  R2_SECRET_ACCESS_KEY=$(asks "R2 secret access key (hidden): ")
  BACKUP_BUCKET=$(ask "R2 bucket for database backups (empty = keep backups on this server only): ")
  RESEND_API_KEY=$(asks "Resend API key (hidden, empty = set it later): ")
  MAIL_FROM=$(ask "Sender, for example Album <noreply@example.com> (empty = set it later): ")
  OWNER_PW=$(gen 16); APP_PW=$(gen 16); SVC_PW=$(gen 16); BETTER_AUTH_SECRET=$(gen 32); MEDIA_SIGNING_SECRET=$(gen 32)
fi

IP=$(curl -4 -fsS https://api.ipify.org 2>/dev/null || true); DNS=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
if [ -z "$IP" ] || [ "$IP" != "$DNS" ]; then
  echo "WARNING: $DOMAIN points to '${DNS:-nothing}', this server is '${IP:-unknown}'. HTTPS certificates fail until DNS points here."
  [ "$(ask 'Continue anyway? [y/N] ')" = "y" ] || exit 1
fi

echo "== Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl gnupg ca-certificates openssl ufw fail2ban unattended-upgrades rclone gettext-base debian-keyring debian-archive-keyring apt-transport-https postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y      # current PostgreSQL (version 15 or newer is required)
apt-get install -y postgresql-17
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; apt-get install -y nodejs; fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y; apt-get install -y caddy
fi

echo "== Database"
id album >/dev/null 2>&1 || useradd --system --home /var/lib/album --shell /usr/sbin/nologin album
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q -v owner_pw="$OWNER_PW" -v app_pw="$APP_PW" -v svc_pw="$SVC_PW" -f "$APP_DIR/db/setup.sql"
ADMIN_URL="postgresql://album_owner:${OWNER_PW}@127.0.0.1:5432/album"
DATABASE_ADMIN_URL="$ADMIN_URL" bash "$APP_DIR/db/migrate.sh"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -v email="$ADMIN_EMAIL" -f - <<'SQL'
insert into public.app_settings (key, value) values ('bootstrap_admin_email', :'email') on conflict (key) do update set value = excluded.value;
SQL

echo "== Configuration"
cat > /etc/album/album.env <<EOF
ENVIRONMENT=production
PORT=8787
APP_URL=https://${DOMAIN}
API_URL=https://${DOMAIN}
DATABASE_URL=postgresql://album_app:${APP_PW}@127.0.0.1:5432/album
DATABASE_SERVICE_URL=postgresql://album_service:${SVC_PW}@127.0.0.1:5432/album
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
MEDIA_SIGNING_SECRET=${MEDIA_SIGNING_SECRET}
R2_ACCOUNT_ID=${R2_ACCOUNT_ID}
R2_BUCKET=${R2_BUCKET}
R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}
R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}
RESEND_API_KEY=${RESEND_API_KEY}
MAIL_FROM="${MAIL_FROM}"
EOF
cat > /etc/album/admin.env <<EOF
DATABASE_ADMIN_URL=${ADMIN_URL}
BACKUP_BUCKET=${BACKUP_BUCKET}
OWNER_PW=${OWNER_PW}
APP_PW=${APP_PW}
SVC_PW=${SVC_PW}
EOF
[ -f /etc/album/backup.pass ] || { gen 24 > /etc/album/backup.pass; }
chown root:album /etc/album /etc/album/album.env; chmod 750 /etc/album; chmod 640 /etc/album/album.env
chown root:root /etc/album/admin.env /etc/album/backup.pass; chmod 600 /etc/album/admin.env /etc/album/backup.pass

echo "== Building the site and the API (a few minutes)"
chmod -R a+rX "$APP_DIR"
cd "$APP_DIR"
npm install --legacy-peer-deps --no-audit --no-fund
PUBLIC_API_URL="https://${DOMAIN}" npm run build
( cd worker && npm install --omit=dev --no-audit --no-fund && npm run build:node )

echo "== Services"
for f in album-api.service album-cleanup.service album-cleanup.timer album-backup.service album-backup.timer; do sed "s|@APP_DIR@|${APP_DIR}|g" "deploy/systemd/$f" > "/etc/systemd/system/$f"; done
chmod +x deploy/backup.sh
export DOMAIN APP_DIR; envsubst '${DOMAIN} ${APP_DIR}' < deploy/Caddyfile.template > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable --now album-api.service album-cleanup.timer album-backup.timer
systemctl reload caddy || systemctl restart caddy

echo "== Firewall and protection"
SSH_PORT=$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}'); SSH_PORT=${SSH_PORT:-22}
ufw allow "${SSH_PORT}/tcp" >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null 2>&1 || true
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

echo "== Checking"
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:8787/api/auth/ok >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:8787/api/auth/ok >/dev/null && echo "API: running" || { echo "API did not start. See: journalctl -u album-api -n 50"; exit 1; }
ss -ltn | awk '$4 ~ /:5432$/ {print "PostgreSQL listens on " $4}'
echo
echo "Done. Open https://${DOMAIN}/register?bootstrap=1 and register with ${ADMIN_EMAIL}."
echo "IMPORTANT: copy the backup password to a password manager (without it backups cannot be restored):  sudo cat /etc/album/backup.pass"
