#!/usr/bin/env bash
set -Eeuo pipefail

exec 9>/run/xfreedom-watchdog.lock
flock -n 9 || exit 0

[[ -r /etc/xfreedom/node.env ]] || exit 0
set -a
# shellcheck disable=SC1091
source /etc/xfreedom/node.env
set +a

case "${ROLE:-}" in
  edge) COMPOSE=compose.edge.yml ;;
  primary) COMPOSE=compose.primary.yml ;;
  secondary) COMPOSE=compose.secondary.yml ;;
  *) exit 0 ;;
esac

cd "${APP_ROOT:-/opt/xfreedom/app}"

if ! ip link show wg0 >/dev/null 2>&1; then
  systemctl restart wg-quick@wg0 || true
fi

docker compose -f "$COMPOSE" up -d --remove-orphans >/dev/null

while read -r id; do
  [[ -n "$id" ]] || continue
  state=$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null || echo missing)
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo missing)
  if [[ "$state" != "running" || "$health" == "unhealthy" ]]; then
    docker restart "$id" >/dev/null || true
  fi
done < <(docker compose -f "$COMPOSE" ps -q)

if [[ "$ROLE" == "edge" ]]; then
  curl -fsS --max-time 4 http://127.0.0.1/healthz >/dev/null || docker compose -f "$COMPOSE" restart edge
else
  WG_IP=$(awk -F= '/^WG_IP=/{print $2}' .env | tail -n1)
  [[ -n "$WG_IP" ]] && curl -fsS --max-time 5 "http://${WG_IP}:3000/api/health" >/dev/null || true
fi
