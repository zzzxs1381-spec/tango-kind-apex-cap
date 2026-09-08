#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE=${1:-/etc/xfreedom/mesh.env}
[[ -r "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${WG_IP:?WG_IP required}"
: "${PEER1_PUBLIC_KEY:?PEER1_PUBLIC_KEY required}"
: "${PEER1_ENDPOINT:?PEER1_ENDPOINT required}"
: "${PEER1_WG_IP:?PEER1_WG_IP required}"
: "${PEER2_PUBLIC_KEY:?PEER2_PUBLIC_KEY required}"
: "${PEER2_ENDPOINT:?PEER2_ENDPOINT required}"
: "${PEER2_WG_IP:?PEER2_WG_IP required}"

PRIVATE_KEY=$(cat /etc/wireguard/privatekey)

umask 077
cat >/etc/wireguard/wg0.conf <<EOF
[Interface]
Address = ${WG_IP}/24
ListenPort = 51820
PrivateKey = ${PRIVATE_KEY}

[Peer]
PublicKey = ${PEER1_PUBLIC_KEY}
Endpoint = ${PEER1_ENDPOINT}:51820
AllowedIPs = ${PEER1_WG_IP}/32
PersistentKeepalive = 25

[Peer]
PublicKey = ${PEER2_PUBLIC_KEY}
Endpoint = ${PEER2_ENDPOINT}:51820
AllowedIPs = ${PEER2_WG_IP}/32
PersistentKeepalive = 25
EOF

systemctl enable wg-quick@wg0
systemctl restart wg-quick@wg0
wg show wg0
