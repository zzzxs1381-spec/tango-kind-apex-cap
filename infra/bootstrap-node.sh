#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

install_apt() {
  apt-get update
  apt-get install -y ca-certificates curl git jq openssl wireguard wireguard-tools rsync ufw docker.io
  if ! apt-get install -y docker-compose-v2; then
    apt-get install -y docker-compose-plugin
  fi
}

install_dnf() {
  dnf install -y ca-certificates curl git jq openssl wireguard-tools rsync firewalld docker docker-compose-plugin
}

if command -v apt-get >/dev/null 2>&1; then
  install_apt
elif command -v dnf >/dev/null 2>&1; then
  install_dnf
else
  echo "Unsupported distribution: need apt or dnf" >&2
  exit 1
fi

systemctl enable --now docker

install -d -m 700 /etc/xfreedom /etc/wireguard /opt/xfreedom
if [[ ! -s /etc/wireguard/privatekey ]]; then
  umask 077
  wg genkey > /etc/wireguard/privatekey
  wg pubkey < /etc/wireguard/privatekey > /etc/wireguard/publickey
fi

cat >/etc/sysctl.d/99-xfreedom.conf <<'EOF'
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
EOF
sysctl --system >/dev/null

if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp
  ufw allow 51820/udp
  ufw --force enable
fi

echo "=== XFreedom bootstrap complete ==="
echo "hostname: $(hostname -f 2>/dev/null || hostname)"
echo "os: $(. /etc/os-release; echo "$PRETTY_NAME")"
echo "kernel: $(uname -r)"
echo "docker: $(docker --version)"
echo "compose: $(docker compose version 2>/dev/null || true)"
echo "wireguard-public-key:"
cat /etc/wireguard/publickey
