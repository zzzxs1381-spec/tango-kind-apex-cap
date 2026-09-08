#!/usr/bin/env bash
set -Eeuo pipefail

ROLE=${1:-}
case "$ROLE" in
  edge|primary|secondary) ;;
  *) echo "usage: $0 edge|primary|secondary" >&2; exit 2 ;;
esac

ROOT=/opt/xfreedom/app
REPO=${XF_REPO:-https://github.com/zzzxs1381-spec/tango-kind-apex-cap.git}
BRANCH=${XF_BRANCH:-main}

if [[ ! -d "$ROOT/.git" ]]; then
  rm -rf "$ROOT"
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$ROOT"
else
  git -C "$ROOT" fetch origin "$BRANCH"
  git -C "$ROOT" reset --hard "origin/$BRANCH"
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
