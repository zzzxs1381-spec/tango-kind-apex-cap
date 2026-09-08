#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

BASE=/etc/xfreedom-rkn
for f in "$BASE/node.env" "$BASE/secrets.env" "$BASE/cluster.env"; do
  [[ -r "$f" ]] || { echo "missing $f" >&2; exit 1; }
done

set -a
source "$BASE/node.env"
source "$BASE/secrets.env"
source "$BASE/cluster.env"
set +a

: "${ROLE:?}"
: "${PUBLIC_IP:?}"
: "${MESH_IP:?}"
: "${REALITY_SNI:?}"
: "${PEER1_PUBLIC_KEY:?}"
: "${PEER1_PSK:?}"
: "${PEER1_ENDPOINT:?}"
: "${PEER1_MESH_IP:?}"
: "${PEER2_PUBLIC_KEY:?}"
: "${PEER2_PSK:?}"
: "${PEER2_ENDPOINT:?}"
: "${PEER2_MESH_IP:?}"
: "${AWG_PORT:?}"
: "${AWG_S1:?}"
: "${AWG_S2:?}"
: "${AWG_H1:?}"
: "${AWG_H2:?}"
: "${AWG_H3:?}"
: "${AWG_H4:?}"
: "${CORE1_MESH_IP:?}"
: "${CORE2_MESH_IP:?}"

PRIVATE_KEY=$(cat "$BASE/awg-private.key")
install -d -m 700 /etc/amnezia/amneziawg

cat >/etc/amnezia/amneziawg/awg0.conf <<EOF
[Interface]
Address = ${MESH_IP}/24
ListenPort = ${AWG_PORT}
PrivateKey = ${PRIVATE_KEY}
Jc = 7
Jmin = 8
Jmax = 80
S1 = ${AWG_S1}
S2 = ${AWG_S2}
H1 = ${AWG_H1}
H2 = ${AWG_H2}
H3 = ${AWG_H3}
H4 = ${AWG_H4}

[Peer]
PublicKey = ${PEER1_PUBLIC_KEY}
PresharedKey = ${PEER1_PSK}
AllowedIPs = ${PEER1_MESH_IP}/32
Endpoint = ${PEER1_ENDPOINT}:${AWG_PORT}
PersistentKeepalive = 25

[Peer]
PublicKey = ${PEER2_PUBLIC_KEY}
PresharedKey = ${PEER2_PSK}
AllowedIPs = ${PEER2_MESH_IP}/32
Endpoint = ${PEER2_ENDPOINT}:${AWG_PORT}
PersistentKeepalive = 25
EOF
chmod 600 /etc/amnezia/amneziawg/awg0.conf

ufw allow "${AWG_PORT}/udp"
systemctl enable awg-quick@awg0.service
systemctl restart awg-quick@awg0.service

XRAY_CFG=/usr/local/etc/xray/config.json
mkdir -p "$(dirname "$XRAY_CFG")"

if [[ "$ROLE" == "edge" ]]; then
cat >"$XRAY_CFG" <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "tag": "reality-in",
      "listen": "0.0.0.0",
      "port": 443,
      "protocol": "vless",
      "settings": {
        "users": [
          { "id": "${XRAY_UUID}", "flow": "xtls-rprx-vision", "email": "xfreedom-edge" }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "method": "raw",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "target": "${REALITY_SNI}:443",
          "serverNames": ["${REALITY_SNI}"],
          "privateKey": "${XRAY_PRIVATE}",
          "shortIds": ["${SHORT_ID}"]
        }
      },
      "sniffing": {
        "enabled": true,
        "destOverride": ["http", "tls", "quic"],
        "routeOnly": false
      }
    }
  ],
  "outbounds": [
    {
      "tag": "core-1",
      "protocol": "socks",
      "settings": { "address": "${CORE1_MESH_IP}", "port": 1080 }
    },
    {
      "tag": "core-2",
      "protocol": "socks",
      "settings": { "address": "${CORE2_MESH_IP}", "port": 1080 }
    },
    { "tag": "direct-last-resort", "protocol": "freedom" }
  ],
  "observatory": {
    "subjectSelector": ["core-"],
    "probeUrl": "https://www.gstatic.com/generate_204",
    "probeInterval": "10s",
    "enableConcurrency": true
  },
  "routing": {
    "domainStrategy": "AsIs",
    "rules": [
      { "type": "field", "inboundTag": ["reality-in"], "balancerTag": "core-balance" }
    ],
    "balancers": [
      {
        "tag": "core-balance",
        "selector": ["core-"],
        "fallbackTag": "core-1",
        "strategy": { "type": "leastPing", "settings": {} }
      }
    ]
  }
}
EOF
else
cat >"$XRAY_CFG" <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "tag": "reality-in",
      "listen": "0.0.0.0",
      "port": 443,
      "protocol": "vless",
      "settings": {
        "users": [
          { "id": "${XRAY_UUID}", "flow": "xtls-rprx-vision", "email": "xfreedom-${ROLE}" }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "method": "raw",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "target": "${REALITY_SNI}:443",
          "serverNames": ["${REALITY_SNI}"],
          "privateKey": "${XRAY_PRIVATE}",
          "shortIds": ["${SHORT_ID}"]
        }
      },
      "sniffing": {
        "enabled": true,
        "destOverride": ["http", "tls", "quic"],
        "routeOnly": false
      }
    },
    {
      "tag": "mesh-socks",
      "listen": "${MESH_IP}",
      "port": 1080,
      "protocol": "socks",
      "settings": {
        "auth": "noauth",
        "udp": true,
        "ip": "${MESH_IP}"
      }
    }
  ],
  "outbounds": [
    { "tag": "direct", "protocol": "freedom" },
    { "tag": "block", "protocol": "blackhole" }
  ]
}
EOF
fi

xray run -test -config "$XRAY_CFG"
systemctl enable xray.service
systemctl restart xray.service

HY2_CFG=/etc/hysteria/config.yaml
if [[ "$ROLE" == "edge" ]]; then
cat >"$HY2_CFG" <<EOF
listen: :443

tls:
  cert: /etc/hysteria/server.crt
  key: /etc/hysteria/server.key
  sniGuard: disable

auth:
  type: password
  password: ${HY2_PASSWORD}

obfs:
  type: salamander
  salamander:
    password: ${HY2_OBFS}

outbounds:
  - name: foreign-core
    type: socks5
    socks5:
      addr: ${CORE1_MESH_IP}:1080

masquerade:
  type: string
  string:
    content: "OK"
    headers:
      content-type: text/plain
    statusCode: 200
EOF
else
cat >"$HY2_CFG" <<EOF
listen: :443

tls:
  cert: /etc/hysteria/server.crt
  key: /etc/hysteria/server.key
  sniGuard: disable

auth:
  type: password
  password: ${HY2_PASSWORD}

obfs:
  type: salamander
  salamander:
    password: ${HY2_OBFS}

outbounds:
  - name: direct
    type: direct

masquerade:
  type: string
  string:
    content: "OK"
    headers:
      content-type: text/plain
    statusCode: 200
EOF
fi

systemctl enable hysteria-server.service
systemctl restart hysteria-server.service
sleep 1
systemctl is-active --quiet hysteria-server.service || { journalctl --no-pager -n 80 -u hysteria-server.service >&2; exit 1; }

cat >"$BASE/watchdog.sh" <<'EOF'
#!/usr/bin/env bash
set -u

if ! ip link show awg0 >/dev/null 2>&1; then
  systemctl restart awg-quick@awg0.service || true
fi

if ! systemctl is-active --quiet xray.service; then
  systemctl restart xray.service || true
fi

if ! systemctl is-active --quiet hysteria-server.service; then
  systemctl restart hysteria-server.service || true
fi

if ! ss -lnt | grep -qE '[:.]443[[:space:]]'; then
  systemctl restart xray.service || true
fi

if ! ss -lnu | grep -qE '[:.]443[[:space:]]'; then
  systemctl restart hysteria-server.service || true
fi
EOF
chmod 700 "$BASE/watchdog.sh"

cat >/etc/systemd/system/xfreedom-rkn-watchdog.service <<EOF
[Unit]
Description=XFreedom RKN resilience watchdog
After=network-online.target

[Service]
Type=oneshot
ExecStart=${BASE}/watchdog.sh
EOF

cat >/etc/systemd/system/xfreedom-rkn-watchdog.timer <<'EOF'
[Unit]
Description=Run XFreedom RKN watchdog every minute

[Timer]
OnBootSec=45s
OnUnitActiveSec=60s
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now xfreedom-rkn-watchdog.timer

VLESS_LINK="vless://${XRAY_UUID}@${PUBLIC_IP}:443?type=tcp&encryption=none&security=reality&pbk=${XRAY_PASSWORD}&fp=chrome&sni=${REALITY_SNI}&sid=${SHORT_ID}&spx=%2F&flow=xtls-rprx-vision#XFreedom-${ROLE}-REALITY"
HY2_LINK="hysteria2://${HY2_PASSWORD}@${PUBLIC_IP}:443/?insecure=1&obfs=salamander&obfs-password=${HY2_OBFS}&sni=${REALITY_SNI}#XFreedom-${ROLE}-HY2"

cat >"$BASE/client-links.txt" <<EOF
# XFreedom ${ROLE}
# Primary TCP/TLS-like transport
${VLESS_LINK}

# UDP/QUIC fallback
${HY2_LINK}
EOF
chmod 600 "$BASE/client-links.txt"

echo "=== ${ROLE} READY ==="
awg show awg0 || true
systemctl --no-pager --full status xray.service | sed -n '1,12p' || true
systemctl --no-pager --full status hysteria-server.service | sed -n '1,12p' || true
cat "$BASE/client-links.txt"
