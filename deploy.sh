#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-root@178.105.80.104}"
APP_DIR="${APP_DIR:-/var/www/scheduler}"
PM2_APP="${PM2_APP:-scheduler}"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
BASE_URL="${BASE_URL:-https://api.scheduler.trade}"
RESET_SPEAKING_CLUBS_DB="${RESET_SPEAKING_CLUBS_DB:-0}"
RESET_REMINDER_DB="${RESET_REMINDER_DB:-0}"

usage() {
  cat <<EOF
Usage:
  ./deploy.sh [options]

Options:
  --branch <name>              Deploy branch. Default: current local branch.
  --reset-speaking-clubs-db    Drop speaking_clubs schema before restart.
  --reset-reminder-db          Drop reminder schema before restart.

Environment overrides:
  HOST=$HOST
  APP_DIR=$APP_DIR
  PM2_APP=$PM2_APP
  BASE_URL=$BASE_URL
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      BRANCH="${2:?Missing branch name}"
      shift 2
      ;;
    --reset-speaking-clubs-db)
      RESET_SPEAKING_CLUBS_DB=1
      shift
      ;;
    --reset-reminder-db)
      RESET_REMINDER_DB=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

echo "Deploying branch '$BRANCH' to $HOST:$APP_DIR"

ssh "$HOST" \
  "APP_DIR='$APP_DIR' PM2_APP='$PM2_APP' BRANCH='$BRANCH' BASE_URL='$BASE_URL' RESET_SPEAKING_CLUBS_DB='$RESET_SPEAKING_CLUBS_DB' RESET_REMINDER_DB='$RESET_REMINDER_DB' bash -s" <<'REMOTE'
set -euo pipefail

cd "$APP_DIR"

echo "Fetching latest code..."
git fetch origin "$BRANCH"
git switch -C "$BRANCH" "origin/$BRANCH"

echo "Installing dependencies..."
npm ci

echo "Building project..."
npm run build

DB_HOST="$(node -e "const c=require('./ecosystem.config.js').apps[0].env; console.log(c.DB_HOST || 'localhost')")"
DB_PORT="$(node -e "const c=require('./ecosystem.config.js').apps[0].env; console.log(c.DB_PORT || 5432)")"
DB_USER="$(node -e "const c=require('./ecosystem.config.js').apps[0].env; console.log(c.DB_USERNAME || c.DB_USER || 'postgres')")"
DB_PASSWORD="$(node -e "const c=require('./ecosystem.config.js').apps[0].env; console.log(c.DB_PASSWORD || '')")"
DB_NAME="$(node -e "const c=require('./ecosystem.config.js').apps[0].env; console.log(c.DB_DATABASE || c.DB_NAME || 'postgres')")"

if [[ "$RESET_SPEAKING_CLUBS_DB" == "1" ]]; then
  echo "Dropping speaking_clubs schema..."
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS speaking_clubs CASCADE;"
fi

if [[ "$RESET_REMINDER_DB" == "1" ]]; then
  echo "Dropping reminder schema..."
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS reminder CASCADE;"
fi

echo "Restarting app..."
if pm2 describe "$PM2_APP" >/dev/null; then
  pm2 delete "$PM2_APP"
fi
pm2 start ecosystem.config.js
pm2 save

echo "Waiting for app..."
for attempt in {1..30}; do
  if curl -fsS "http://127.0.0.1:3000/" >/dev/null; then
    break
  fi
  if [[ "$attempt" == "30" ]]; then
    echo "App did not start on 127.0.0.1:3000" >&2
    pm2 logs "$PM2_APP" --lines 80 --nostream || true
    exit 1
  fi
  sleep 2
done

echo "Refreshing Telegram webhooks..."
curl -fsS -X POST "$BASE_URL/reminder/telegram/webhook/setup" \
  -H 'Content-Type: application/json' \
  -d "{\"baseUrl\":\"$BASE_URL\"}" >/dev/null || true

curl -fsS -X POST "$BASE_URL/speaking-clubs/telegram/webhook/setup" \
  -H 'Content-Type: application/json' \
  -d "{\"baseUrl\":\"$BASE_URL\"}" >/dev/null || true

echo "Checking statuses..."
curl -fsS "$BASE_URL/reminder/telegram/status"
echo
curl -fsS "$BASE_URL/speaking-clubs/telegram/status"
echo

pm2 status "$PM2_APP"
REMOTE

echo "Deploy finished."
