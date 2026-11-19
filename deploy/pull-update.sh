
#!/usr/bin/env bash
# Safely pull updates and deploy on the production VPS.
# Run: sudo bash deploy/pull-update.sh

set -Eeuo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo."
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! id kokofibo >/dev/null 2>&1; then
  echo "Deploy user kokofibo does not exist."
  exit 1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  echo "Git repository not found."
  exit 1
fi

git_as_app() {
  runuser -u kokofibo -- env GIT_TERMINAL_PROMPT=0 \
    git -C "$APP_DIR" "$@"
}

echo "===== CHECK GIT BRANCH ====="

BRANCH="$(git_as_app branch --show-current)"

if [ "$BRANCH" != "master" ]; then
  echo "Expected master branch, found: $BRANCH"
  exit 1
fi

echo "Branch: $BRANCH"

echo
echo "===== CHECK LOCAL CHANGES ====="

STATUS="$(git_as_app status --porcelain --untracked-files=all)"

if [ -n "$STATUS" ]; then
  while IFS= read -r line; do
    case "$line" in
      "?? .well-known/"*)
        echo "Preserving local Let's Encrypt file: $line"
        ;;
      *)
        echo "Unexpected local Git change:"
        echo "$line"
        echo "Deployment aborted. Please inspect the repository."
        exit 1
        ;;
    esac
  done <<< "$STATUS"
fi

echo "Git working tree is clean (except permitted .well-known files)."

echo
echo "===== PULL LATEST CODE ====="

git_as_app pull --ff-only

echo
echo "===== START DEPLOYMENT ====="

exec bash "$APP_DIR/deploy/update.sh"
