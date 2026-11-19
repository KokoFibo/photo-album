#!/usr/bin/env bash
# On the VPS: fetch the latest code from git, then rebuild and restart.   sudo bash deploy/pull-update.sh
{
  set -euo pipefail
  [ "$(id -u)" -eq 0 ] || { echo "Please run with sudo."; exit 1; }
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  git pull --ff-only
  exec bash deploy/update.sh
}
