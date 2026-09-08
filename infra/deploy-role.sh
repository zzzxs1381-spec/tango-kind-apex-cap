#!/usr/bin/env bash
set -Eeuo pipefail

ROLE=${1:-}
case "$ROLE" in
  edge|primary|secondary) ;;
  *) echo "usage: $0 edge|primary|secondary" >&2; exit 2 ;;
esac

ROOT=/opt/xfreedom/app
REPO=${XF_REPO:-https://github.com/zzzxs1381-spec/tango-kind-apex-cap.git}
REF=${XF_REF:-${XF_BRANCH:-main}}
ENV_SOURCE=${XF_ENV_FILE:-}

if [[ ! -d "$ROOT/.git" ]]; then
  rm -rf "$ROOT"
  git clone --filter=blob:none "$REPO" "$ROOT"
fi

git -C "$ROOT" fetch --force --depth 1 origin "$REF"
git -C "$ROOT" reset --hard FETCH_HEAD

if [[ -n "$ENV_SOURCE" ]]; then
  [[ -r "$ENV_SOURCE" ]] || { echo "Missing XF_ENV_FILE=$ENV_SOURCE" >&2; exit 1; }
  install -m 600 "$ENV_SOURCE" "$ROOT/.env"
fi

cd "$ROOT"
[[ -f .env ]] || { echo "Missing $ROOT/.env" >&2; exit 1; }

case "$ROLE" in
  edge)
    docker compose -f compose.edge.yml up -d --pull always --remove-orphans
    ;;
  primary)
    docker compose -f compose.primary.yml up -d --build --remove-orphans
    ;;
  secondary)
    docker compose -f compose.secondary.yml up -d --build --remove-orphans
    ;;
esac

install -m 755 infra/watchdog.sh /usr/local/sbin/xfreedom-watchdog
install -m 644 infra/systemd/xfreedom-watchdog.service /etc/systemd/system/
install -m 644 infra/systemd/xfreedom-watchdog.timer /etc/systemd/system/
cat >/etc/xfreedom/node.env <<EOF
ROLE=$ROLE
APP_ROOT=$ROOT
EOF
systemctl daemon-reload
systemctl enable --now xfreedom-watchdog.timer
docker compose -f "compose.${ROLE}.yml" ps 2>/dev/null || true
