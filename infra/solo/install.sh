#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export GIT_OPTIONAL_LOCKS=0

SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
ROOT=/opt/xfreedom-solo
BASE=/etc/xfreedom-solo
DATA=/var/lib/xfreedom-solo
PREFLIGHT=0
if [[ ${1:-} == --preflight ]]; then PREFLIGHT=1; shift; fi
PUBLIC_IP=${1:-}
[[ $EUID -eq 0 ]] || { echo 'Запустите через sudo bash install.sh IP_НОВОГО_VPS' >&2; exit 1; }
[[ -r /etc/os-release ]] || exit 1
# shellcheck disable=SC1091
. /etc/os-release
[[ $ID == ubuntu ]] || { echo 'Нужна Ubuntu 22.04, 24.04 или 26.04 LTS.' >&2; exit 1; }
case "$VERSION_ID" in 22.04|24.04|26.04) ;; *) echo "Ubuntu $VERSION_ID не поддержана этим установщиком." >&2; exit 1;; esac
[[ -d /run/systemd/system ]] || { echo 'Нужен VPS с работающим systemd.' >&2; exit 1; }
case "$(uname -m)" in x86_64|aarch64) ;; *) echo 'Нужен amd64 или arm64.' >&2; exit 1;; esac
command -v python3 >/dev/null || { echo 'Установите python3: apt-get update && apt-get install -y python3' >&2; exit 1; }
if [[ -z $PUBLIC_IP && -r $BASE/state.json ]]; then
  PUBLIC_IP=$(python3 -c 'import json;print(json.load(open("/etc/xfreedom-solo/state.json"))["public_ip"])')
fi
if [[ -z $PUBLIC_IP ]]; then read -rp 'Публичный IPv4 НОВОГО зарубежного сервера: ' PUBLIC_IP </dev/tty; fi
PYTHONPATH="$SOURCE/infra/solo" python3 -c 'from render import valid_ip;import sys;valid_ip(sys.argv[1])' "$PUBLIC_IP"

echo "Проверка: $PRETTY_NAME, $(uname -m), адрес $PUBLIC_IP"
MEMORY_KB=$(awk '/MemTotal|SwapTotal/{n+=$2}END{print n}' /proc/meminfo)
[[ $MEMORY_KB -ge 1900000 ]] || { echo 'Нужно минимум 2 ГБ RAM + swap; рекомендуется 4 ГБ RAM.' >&2; exit 1; }
FREE_KB=$(df -Pk /opt | awk 'NR==2 {print $4}')
[[ $FREE_KB -ge 8000000 ]] || { echo 'Нужно минимум 8 ГБ свободного места для сборки.' >&2; exit 1; }

check_port() {
  local protocol=$1 port=$2 unit=$3 lines pid
  lines=$(ss -H -ln"$protocol"p "sport = :$port")
  [[ -z $lines ]] && return 0
  pid=$(systemctl show "$unit" -p MainPID --value 2>/dev/null || true)
  if [[ $pid =~ ^[1-9][0-9]*$ ]] && ! printf '%s\n' "$lines" | grep -vF "pid=$pid," >/dev/null; then return 0; fi
  echo "Порт $port/$protocol занят. Существующую службу не останавливаю:" >&2
  printf '%s\n' "$lines" >&2
  return 1
}
check_port t 443 xfreedom-xray
check_port u 443 xfreedom-hysteria
if ss -H -lnt 'sport = :8080' | grep -q .; then
  if [[ ! -f $ROOT/.managed || ! -s $BASE/state.json ]] || ! command -v docker >/dev/null || \
    [[ -z $(docker ps -q --filter label=com.docker.compose.project=xfreedom-solo --filter label=com.docker.compose.service=app) ]]; then
    echo 'Порт 8080 занят другим приложением; автоматической замены нет.' >&2; exit 1
  fi
fi
if [[ $PREFLIGHT == 1 ]]; then
  echo 'Предварительная проверка пройдена. Изменений на сервере нет.'
  exit 0
fi

REF=$(git -C "$SOURCE" rev-parse HEAD)
[[ $REF =~ ^[a-f0-9]{40}$ ]] || exit 1
[[ -z $(git -C "$SOURCE" status --porcelain --untracked-files=no) ]] || { echo 'Исходники изменены: нужна чистая копия закреплённого коммита.' >&2; exit 1; }
if [[ -e $ROOT && ! -e $ROOT/.managed ]]; then
  echo "$ROOT уже существует и не принадлежит этому установщику." >&2; exit 1
fi
if [[ -f $BASE/installed.json ]]; then
  OLD_REF=$(python3 -c 'import json;print(json.load(open("/etc/xfreedom-solo/installed.json"))["release"])')
  [[ $OLD_REF == "$REF" ]] || { echo "Уже установлен $OLD_REF. Обновление другой версии требует отдельной миграции; данные сохранены." >&2; exit 1; }
fi
install -d -m 755 "$ROOT" "$ROOT/releases" "$DATA" "$DATA/status"
touch "$ROOT/.managed"
install -d -m 700 "$DATA/backups"
exec 9>"$DATA/operation.lock"
flock -n 9 || { echo 'Другая установка или диагностика уже выполняется.' >&2; exit 1; }
LOG="$DATA/install-$(date -u +%Y%m%dT%H%M%SZ).log"
touch "$LOG"; chmod 600 "$LOG"
exec > >(tee -a "$LOG") 2>&1
trap 'code=$?; echo "Ошибка на строке $LINENO (код $code). Журнал: $LOG. Исправьте причину и повторите ту же команду: ключи и данные сохраняются."; exit "$code"' ERR

export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=120 update
apt-get -o DPkg::Lock::Timeout=120 install -y ca-certificates curl openssl python3 git iproute2 util-linux
if command -v docker >/dev/null; then
  docker info >/dev/null
  docker compose version >/dev/null || {
    echo 'Docker найден, но Compose plugin отсутствует. Установите plugin из того же источника, что Docker.' >&2; exit 1;
  }
else
  # Do not uninstall an unrelated container runtime to make Docker installation work.
  for package in containerd runc podman-docker; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
      echo "$package уже установлен. Нужна совместимая установка Docker; текущий runtime сохранён." >&2; exit 1
    fi
  done
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL --proto '=https' --retry 3 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/xfreedom-docker.asc
  chmod 644 /etc/apt/keyrings/xfreedom-docker.asc
  cat >/etc/apt/sources.list.d/xfreedom-docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/xfreedom-docker.asc
EOF
  apt-get -o DPkg::Lock::Timeout=120 update
  apt-get -o DPkg::Lock::Timeout=120 install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
DOCKER_MAJOR=$(docker version --format '{{.Server.Version}}' | cut -d. -f1)
[[ $DOCKER_MAJOR =~ ^[0-9]+$ && $DOCKER_MAJOR -ge 28 ]] || { echo 'Нужен Docker Engine 28+ для изоляции опубликованных loopback-портов.' >&2; exit 1; }

RELEASE="$ROOT/releases/$REF"
install -d -m 755 "$RELEASE"
if [[ ! -f $RELEASE/.source-ready ]]; then
  git -C "$SOURCE" archive "$REF" | tar -x -C "$RELEASE"
  chmod -R a+rX "$RELEASE"
  touch "$RELEASE/.source-ready"
fi
python3 "$RELEASE/infra/solo/download.py" "$RELEASE/bin"

REALITY_SNI=${REALITY_SNI:-}
if [[ -r $BASE/state.json ]]; then
  REALITY_SNI=$(python3 -c 'import json;print(json.load(open("/etc/xfreedom-solo/state.json"))["sni"])')
fi
probe_target() {
  local target=$1 report
  PYTHONPATH="$RELEASE/infra/solo" python3 -c 'from render import valid_sni;import sys;valid_sni(sys.argv[1])' "$target" || return 1
  report=$(timeout 12 openssl s_client -connect "$target:443" -servername "$target" -tls1_3 -alpn h2 -verify_return_error </dev/null 2>&1) || return 1
  [[ $report == *'ALPN protocol: h2'* && $report == *'Verify return code: 0 (ok)'* ]]
}
if [[ -n $REALITY_SNI ]]; then
  probe_target "$REALITY_SNI" || { echo 'REALITY target не прошёл TLS 1.3/h2 проверку.' >&2; exit 1; }
else
  for target in www.microsoft.com www.cloudflare.com www.apple.com; do
    if probe_target "$target"; then REALITY_SNI=$target; break; fi
  done
  [[ -n $REALITY_SNI ]] || { echo 'Нет доступного TLS 1.3/h2 target. Укажите REALITY_SNI=подходящий.домен.' >&2; exit 1; }
fi

getent group xfreedom-net >/dev/null || groupadd --system xfreedom-net
id xfreedom-net >/dev/null 2>&1 || useradd --system --gid xfreedom-net --home-dir /nonexistent --shell /usr/sbin/nologin xfreedom-net
install -d -m 750 -o root -g xfreedom-net "$BASE"
if [[ -s $BASE/state.json ]]; then
  tar -czf "$DATA/backups/config-before-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -C /etc xfreedom-solo
fi
python3 "$RELEASE/infra/solo/render.py" --base "$BASE" --bin "$RELEASE/bin" --ip "$PUBLIC_IP" --sni "$REALITY_SNI" --release "$REF"
chgrp xfreedom-net "$BASE/xray.json" "$BASE/hysteria.json" "$BASE/server.key" "$BASE/server.crt"
"$RELEASE/bin/xray" run -test -config "$BASE/xray.json"

COMPOSE=(docker compose --env-file "$BASE/compose.env" -f "$RELEASE/infra/solo/compose.yaml")
"${COMPOSE[@]}" config --quiet
docker build -t "xfreedom-solo:$REF" "$RELEASE"
"${COMPOSE[@]}" pull postgres qdrant
# Persist the exact pulled image digests. Routine restarts never update software.
python3 - "$BASE/images.lock.json" <<'PY'
import json,subprocess,sys
images={}
for image in ('postgres:18.6-alpine','qdrant/qdrant:v1.19.0'):
 images[image]=json.loads(subprocess.check_output(['docker','image','inspect',image]))[0]['RepoDigests']
open(sys.argv[1],'w').write(json.dumps(images,indent=2)+'\n')
PY
ln -sfn "$RELEASE" "$ROOT/current"
for name in xray hysteria; do
  if [[ $name == xray ]]; then ARGS="run -config $BASE/xray.json"; else ARGS="server -c $BASE/hysteria.json"; fi
  cat >"/etc/systemd/system/xfreedom-$name.service" <<EOF
[Unit]
Description=XFreedom $name
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5
[Service]
User=xfreedom-net
Group=xfreedom-net
ExecStart=$RELEASE/bin/$name $ARGS
Restart=on-failure
RestartSec=10
TimeoutStopSec=20
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077
LimitNOFILE=1048576
[Install]
WantedBy=multi-user.target
EOF
done
cat >/usr/local/sbin/xfreedom-solo <<'EOF'
#!/usr/bin/env bash
exec python3 /opt/xfreedom-solo/current/infra/solo/manage.py "$@"
EOF
chmod 755 /usr/local/sbin/xfreedom-solo
for job in repair probe backup; do
  case "$job" in repair) TIMER=$'OnBootSec=2min\nOnUnitActiveSec=60s';; probe) TIMER=$'OnBootSec=5min\nOnUnitActiveSec=15min';; backup) TIMER=$'OnCalendar=*-*-* 03:15:00\nPersistent=true';; esac
  cat >"/etc/systemd/system/xfreedom-solo-$job.service" <<EOF
[Unit]
Description=XFreedom solo $job
After=docker.service network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/xfreedom-solo $job
TimeoutStartSec=15min
UMask=0077
EOF
  cat >"/etc/systemd/system/xfreedom-solo-$job.timer" <<EOF
[Unit]
Description=XFreedom scheduled $job
[Timer]
$TIMER
RandomizedDelaySec=20
[Install]
WantedBy=timers.target
EOF
done
# Preserve SSH configuration and existing firewall policy. Only add VPN rules to
# an already active UFW installation; never enable a new deny policy remotely.
if command -v ufw >/dev/null && LC_ALL=C ufw status | grep -q '^Status: active'; then
  ufw allow 443/tcp comment 'XFreedom REALITY'
  ufw allow 443/udp comment 'XFreedom Hysteria2'
fi
systemctl daemon-reload
systemctl enable --now xfreedom-xray xfreedom-hysteria
"${COMPOSE[@]}" up -d --wait --wait-timeout 180
# Release the operation lock before invoking the manager, which takes the same lock.
flock -u 9
xfreedom-solo probe
xfreedom-solo backup
systemctl enable --now xfreedom-solo-repair.timer xfreedom-solo-probe.timer xfreedom-solo-backup.timer
python3 - "$REF" "$PUBLIC_IP" <<'PY'
import json,sys,time
from pathlib import Path
Path('/etc/xfreedom-solo/installed.json').write_text(json.dumps({'release':sys.argv[1],'public_ip':sys.argv[2],'installed_at':int(time.time())})+'\n')
PY
tar -czf "$BASE/client-bundle.tar.gz" -C "$BASE/clients" .
chmod 600 "$BASE/client-bundle.tar.gz"
echo 'Установка завершена: обе службы прошли локальные TCP/UDP проверки.'
echo "Профили: $BASE/client-bundle.tar.gz"
echo 'Ссылки REALITY: sudo xfreedom-solo links'
echo 'Панель: ssh -N -L 8080:127.0.0.1:8080 USER@НОВЫЙ_IP, затем http://localhost:8080/admin'
echo 'Внешний firewall VPS должен разрешать TCP/443 и UDP/443.'
echo 'Доступность из вашей сети в России ещё требует проверки на устройстве.'
