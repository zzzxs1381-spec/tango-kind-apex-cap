#!/usr/bin/env bash
set -Eeuo pipefail

ROLE=${1:?usage: node-bootstrap.sh edge|core1|core2 PUBLIC_IP MESH_IP}
PUBLIC_IP=${2:?public IP required}
MESH_IP=${3:?mesh IP required}
REALITY_SNI=${REALITY_SNI:-www.microsoft.com}

case "$ROLE" in edge|core1|core2) ;; *) echo "invalid role: $ROLE" >&2; exit 2;; esac

if [[ ${EUID} -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "unsupported OS" >&2
  exit 1
fi
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "This bootstrap is intentionally limited to Ubuntu. Found: ${PRETTY_NAME:-unknown}" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl wget jq openssl qrencode ufw fail2ban   software-properties-common python3-launchpadlib gnupg2 rsync git iproute2   iptables nftables uuid-runtime
apt-get install -y "linux-headers-$(uname -r)" || apt-get install -y linux-headers-generic

if ! grep -Rqs "amnezia/ppa" /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null; then
  add-apt-repository -y ppa:amnezia/ppa
fi
apt-get update
apt-get install -y amneziawg

if ! command -v awg >/dev/null 2>&1 || ! command -v awg-quick >/dev/null 2>&1; then
  echo "AmneziaWG tools were not installed" >&2
  exit 1
fi

if ! command -v xray >/dev/null 2>&1; then
  bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
fi

if ! command -v hysteria >/dev/null 2>&1; then
  HYSTERIA_USER=root bash <(curl -fsSL https://get.hy2.sh/)
fi

install -d -m 700 /etc/xfreedom-rkn /etc/amnezia/amneziawg /etc/hysteria
BACKUP_DIR="/etc/xfreedom-rkn/backup-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$BACKUP_DIR"
[[ -f /usr/local/etc/xray/config.json ]] && cp -a /usr/local/etc/xray/config.json "$BACKUP_DIR/xray-config.json" || true
[[ -f /etc/hysteria/config.yaml ]] && cp -a /etc/hysteria/config.yaml "$BACKUP_DIR/hysteria-config.yaml" || true
[[ -f /etc/amnezia/amneziawg/awg0.conf ]] && cp -a /etc/amnezia/amneziawg/awg0.conf "$BACKUP_DIR/awg0.conf" || true

cat >/etc/sysctl.d/99-xfreedom-rkn.conf <<'EOF'
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
sysctl --system >/dev/null || true

AWG_PRIV_FILE=/etc/xfreedom-rkn/awg-private.key
AWG_PUB_FILE=/etc/xfreedom-rkn/awg-public.key
if [[ ! -s "$AWG_PRIV_FILE" ]]; then
  umask 077
  awg genkey >"$AWG_PRIV_FILE"
  awg pubkey <"$AWG_PRIV_FILE" >"$AWG_PUB_FILE"
fi

SECRETS=/etc/xfreedom-rkn/secrets.env
if [[ ! -s "$SECRETS" ]]; then
  XRAY_UUID=$(xray uuid)
  XRAY_PAIR=$(xray x25519)
  XRAY_PRIVATE=$(awk -F': *' '/^PrivateKey:/{print $2; exit} /^Private key:/{print $2; exit}' <<<"$XRAY_PAIR")
  XRAY_PASSWORD=$(awk -F': *' '/^Password/{print $2; exit} /^Public key:/{print $2; exit}' <<<"$XRAY_PAIR")
  if [[ -z "$XRAY_PRIVATE" || -z "$XRAY_PASSWORD" ]]; then
    echo "Could not parse xray x25519 output" >&2
    exit 1
  fi
  SHORT_ID=$(openssl rand -hex 8)
  HY2_PASSWORD=$(openssl rand -hex 24)
  HY2_OBFS=$(openssl rand -hex 24)
  cat >"$SECRETS" <<EOF
XRAY_UUID=$XRAY_UUID
XRAY_PRIVATE=$XRAY_PRIVATE
XRAY_PASSWORD=$XRAY_PASSWORD
SHORT_ID=$SHORT_ID
HY2_PASSWORD=$HY2_PASSWORD
HY2_OBFS=$HY2_OBFS
EOF
  chmod 600 "$SECRETS"
fi

cat >/etc/xfreedom-rkn/node.env <<EOF
ROLE=$ROLE
PUBLIC_IP=$PUBLIC_IP
MESH_IP=$MESH_IP
REALITY_SNI=$REALITY_SNI
EOF
chmod 600 /etc/xfreedom-rkn/node.env

if [[ ! -s /etc/hysteria/server.key || ! -s /etc/hysteria/server.crt ]]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 825     -keyout /etc/hysteria/server.key     -out /etc/hysteria/server.crt     -subj "/CN=$REALITY_SNI"     -addext "subjectAltName=DNS:$REALITY_SNI" >/dev/null 2>&1
  chmod 600 /etc/hysteria/server.key
  chmod 644 /etc/hysteria/server.crt
fi

ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

systemctl enable --now fail2ban >/dev/null 2>&1 || true

echo "ROLE=$ROLE"
echo "PUBLIC_IP=$PUBLIC_IP"
echo "MESH_IP=$MESH_IP"
echo "AWG_PUBLIC=$(cat "$AWG_PUB_FILE")"
echo "XRAY_VERSION=$(xray version | head -n1)"
echo "HYSTERIA_VERSION=$(hysteria version 2>/dev/null | head -n1 || true)"
