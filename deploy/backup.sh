#!/usr/bin/env bash
# Encrypted PostgreSQL backup.
# Run as root: sudo bash deploy/backup.sh

set -Eeuo pipefail
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo."
  exit 1
fi

BACKUP_DIR="/var/backups/album"
PASSWORD_FILE="/etc/album/backup.pass"
DATABASE="album"

for cmd in pg_dump pg_restore gpg runuser; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing required command: $cmd"
    exit 1
  }
done

if [ ! -s "$PASSWORD_FILE" ]; then
  echo "Backup password file is missing or empty."
  exit 1
fi

install -d -o root -g root -m 700 "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/album-${TIMESTAMP}.dump.gpg"
TEMP="${OUT}.tmp"

cleanup() {
  rm -f "$TEMP"
}
trap cleanup EXIT

echo "Creating encrypted PostgreSQL backup..."

runuser -u postgres -- pg_dump -Fc "$DATABASE" |
  gpg --batch --yes --pinentry-mode loopback \
    --passphrase-file "$PASSWORD_FILE" \
    --symmetric --cipher-algo AES256 \
    --output "$TEMP"

chmod 600 "$TEMP"

echo "Verifying encrypted backup..."

gpg --batch --quiet --pinentry-mode loopback \
  --passphrase-file "$PASSWORD_FILE" \
  --decrypt "$TEMP" |
  pg_restore --list >/dev/null

mv "$TEMP" "$OUT"
trap - EXIT

find "$BACKUP_DIR" -maxdepth 1 -type f \
  -name 'album-*.dump.gpg' -mtime +14 -delete

echo "Backup successfully created and verified."
stat -c '%A %U:%G %s bytes %n' "$OUT"
