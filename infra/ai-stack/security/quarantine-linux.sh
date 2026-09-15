#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <plugin-dir> <command> [args...]" >&2
  exit 64
fi

TARGET="$(cd "$1" && pwd -P)"
shift
IMAGE="${XF_SANDBOX_IMAGE:-node:22-alpine}"
MEMORY="${XF_SANDBOX_MEMORY:-512m}"
CPUS="${XF_SANDBOX_CPUS:-1}"
PIDS="${XF_SANDBOX_PIDS:-128}"

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 69; }

exec docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit "$PIDS" \
  --memory "$MEMORY" \
  --cpus "$CPUS" \
  --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --mount "type=bind,source=$TARGET,target=/workspace,readonly" \
  --workdir /workspace \
  --env HOME=/tmp/home \
  --env CI=1 \
  "$IMAGE" "$@"
