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

show_logs_and_exit() {
  echo "$1" >&2
  pm2 logs "$PM2_APP" --lines 100 --nostream || true
  exit 1
}

wait_for_url() {
  local name="$1"
  local url="$2"
  local max_attempts="${3:-30}"

  echo "Waiting for $name..."
  for attempt in $(seq 1 "$max_attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name is ready."
      return 0
    fi

    if [[ "$attempt" == "$max_attempts" ]]; then
      return 1
    fi

    sleep 2
  done
}

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

echo "Stopping app..."
if pm2 describe "$PM2_APP" >/dev/null; then
  pm2 delete "$PM2_APP"
fi

if [[ "$RESET_SPEAKING_CLUBS_DB" == "1" ]]; then
  echo "Dropping speaking_clubs schema..."
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS speaking_clubs CASCADE;"
fi

if [[ "$RESET_REMINDER_DB" == "1" ]]; then
  echo "Dropping reminder schema..."
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS reminder CASCADE;"
fi

echo "Restarting app..."
pm2 start ecosystem.config.js
pm2 save

wait_for_url "local app" "http://127.0.0.1:3000/reminder/telegram/status" 45 \
  || show_logs_and_exit "App did not start on 127.0.0.1:3000"

wait_for_url "public API" "$BASE_URL/reminder/telegram/status" 30 \
  || show_logs_and_exit "Public API is not ready at $BASE_URL"

wait_for_url "SkyUp agent assistant" "$BASE_URL/skyup-agent-assistant/telegram/status" 30 \
  || show_logs_and_exit "SkyUp agent assistant is not ready at $BASE_URL"

echo "Refreshing Telegram webhooks..."
curl -fsS -X POST "$BASE_URL/reminder/telegram/webhook/setup" \
  -H 'Content-Type: application/json' \
  -d "{\"baseUrl\":\"$BASE_URL\"}" >/dev/null

curl -fsS -X POST "$BASE_URL/speaking-clubs/telegram/webhook/setup" \
  -H 'Content-Type: application/json' \
  -d "{\"baseUrl\":\"$BASE_URL\"}" >/dev/null

curl -fsS -X POST "$BASE_URL/skyup-agent-assistant/telegram/webhook/setup" \
  -H 'Content-Type: application/json' \
  -d "{\"baseUrl\":\"$BASE_URL\"}" >/dev/null

echo "Checking statuses..."
curl -fsS "$BASE_URL/reminder/telegram/status"
echo
curl -fsS "$BASE_URL/speaking-clubs/telegram/status"
echo
curl -fsS "$BASE_URL/skyup-agent-assistant/telegram/status"
echo

pm2 status "$PM2_APP"
REMOTE

echo "Deploy finished."
