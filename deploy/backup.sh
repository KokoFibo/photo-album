#!/usr/bin/env bash
# Encrypted PostgreSQL backup: kept 14 days on this server and, if configured, 30 days in an R2 backup bucket.
set -euo pipefail
set -a; . /etc/album/admin.env; . /etc/album/album.env; set +a
mkdir -p /var/backups/album; chmod 700 /var/backups/album
OUT="/var/backups/album/album-$(date +%Y%m%d-%H%M%S).dump.gpg"
runuser -u postgres -- pg_dump -Fc album | gpg --batch --yes --pinentry-mode loopback --passphrase-file /etc/album/backup.pass --symmetric --cipher-algo AES256 -o "$OUT"
find /var/backups/album -name '*.gpg' -mtime +14 -delete
if [ -n "${BACKUP_BUCKET:-}" ]; then
  export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
         RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  rclone copy "$OUT" "r2:${BACKUP_BUCKET}"
  rclone delete "r2:${BACKUP_BUCKET}" --min-age 30d
fi
echo "backup written: $OUT"
