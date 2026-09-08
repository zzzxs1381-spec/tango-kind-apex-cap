#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EDGE_IP=${1:?usage: cluster-bootstrap.sh EDGE_IP CORE1_IP CORE2_IP}
CORE1_IP=${2:?usage: cluster-bootstrap.sh EDGE_IP CORE1_IP CORE2_IP}
CORE2_IP=${3:?usage: cluster-bootstrap.sh EDGE_IP CORE1_IP CORE2_IP}

XF_REPO=${XF_REPO:-zzzxs1381-spec/tango-kind-apex-cap}
XF_REF=${XF_REF:-main}
REALITY_SNI=${REALITY_SNI:-www.microsoft.com}
WORK=${XF_WORKDIR:-/root/xfreedom-rkn-controller}

EDGE_MESH=10.77.0.1
CORE1_MESH=10.77.0.2
CORE2_MESH=10.77.0.3

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this controller as root on Ubuntu." >&2
  exit 1
fi

if [[ -r /etc/os-release ]]; then
  . /etc/os-release
else
  echo "Cannot detect controller OS." >&2
  exit 1
fi
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "Controller must be Ubuntu. Found: ${PRETTY_NAME:-unknown}" >&2
  exit 1
fi

for ip in "$EDGE_IP" "$CORE1_IP" "$CORE2_IP"; do
  if ! [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    echo "Invalid IPv4 address: $ip" >&2
    exit 2
  fi
done
if [[ "$EDGE_IP" == "$CORE1_IP" || "$EDGE_IP" == "$CORE2_IP" || "$CORE1_IP" == "$CORE2_IP" ]]; then
  echo "All three public IPs must be different." >&2
  exit 2
fi

echo "XFreedom resilient cluster"
echo "  edge  : $EDGE_IP -> $EDGE_MESH"
echo "  core1 : $CORE1_IP -> $CORE1_MESH"
echo "  core2 : $CORE2_IP -> $CORE2_MESH"
echo
read -rsp "root password for edge  ($EDGE_IP): " EDGE_PASS; echo
read -rsp "root password for core1 ($CORE1_IP): " CORE1_PASS; echo
read -rsp "root password for core2 ($CORE2_IP): " CORE2_PASS; echo
[[ -n "$EDGE_PASS" && -n "$CORE1_PASS" && -n "$CORE2_PASS" ]] || { echo "Passwords cannot be empty." >&2; exit 2; }

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y openssh-client sshpass curl jq openssl ca-certificates

install -d -m 700 "$WORK"
KNOWN_HOSTS="$WORK/known_hosts"
RESULTS="$WORK/client-links.txt"
: >"$RESULTS"
touch "$KNOWN_HOSTS"
chmod 600 "$KNOWN_HOSTS"

SSH_OPTS=(
  -o "UserKnownHostsFile=$KNOWN_HOSTS"
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=12
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=3
  -o LogLevel=ERROR
)

run_ssh() {
  local ip=$1 pass=$2
  shift 2
  SSHPASS="$pass" sshpass -e ssh "${SSH_OPTS[@]}" "root@${ip}" "$@"
}

run_scp() {
  local ip=$1 pass=$2 src=$3 dst=$4
  SSHPASS="$pass" sshpass -e scp "${SSH_OPTS[@]}" "$src" "root@${ip}:${dst}"
}

retry() {
  local tries=$1 delay=$2
  shift 2
  local i
  for ((i=1; i<=tries; i++)); do
    if "$@"; then return 0; fi
    if (( i < tries )); then
      echo "retry $i/$tries failed; retrying..." >&2
      sleep "$delay"
    fi
  done
  return 1
}

echo
echo "[1/8] Testing SSH access..."
retry 3 3 run_ssh "$EDGE_IP" "$EDGE_PASS" "echo edge-ok"
retry 3 3 run_ssh "$CORE1_IP" "$CORE1_PASS" "echo core1-ok"
retry 3 3 run_ssh "$CORE2_IP" "$CORE2_PASS" "echo core2-ok"

echo "[2/8] Downloading pinned deployment scripts..."
BASE_URL="https://raw.githubusercontent.com/${XF_REPO}/${XF_REF}/infra/rkn"
curl -fL --retry 4 --retry-delay 2 "$BASE_URL/node-bootstrap.sh" -o "$WORK/node-bootstrap.sh"
curl -fL --retry 4 --retry-delay 2 "$BASE_URL/configure-node.sh" -o "$WORK/configure-node.sh"
chmod 700 "$WORK/node-bootstrap.sh" "$WORK/configure-node.sh"
bash -n "$WORK/node-bootstrap.sh" "$WORK/configure-node.sh"

preflight() {
  local ip=$1 pass=$2 role=$3
  echo "--- preflight $role $ip"
  run_ssh "$ip" "$pass" 'set -e
    echo "host=$(hostname)"
    . /etc/os-release; echo "os=$PRETTY_NAME"
    echo "kernel=$(uname -r)"
    echo "disk=$(df -h / | tail -n1)"
    echo "ports-before:"
    ss -H -lntup | grep -E "(:443[[:space:]]|:80[[:space:]])" || true
    conflict=$(ss -H -lntup | grep -E ":443[[:space:]]" | grep -Ev "(xray|hysteria)" || true)
    if [ -n "$conflict" ]; then
      echo "PORT_443_CONFLICT:"
      echo "$conflict"
      exit 42
    fi'
}

echo "[3/8] Inventory and port conflict checks..."
preflight "$EDGE_IP" "$EDGE_PASS" edge
preflight "$CORE1_IP" "$CORE1_PASS" core1
preflight "$CORE2_IP" "$CORE2_PASS" core2

stage_one() {
  local ip=$1 pass=$2 role=$3 mesh=$4
  echo "--- bootstrap $role $ip"
  run_ssh "$ip" "$pass" "mkdir -p /root/xfreedom-rkn-stage"
  run_scp "$ip" "$pass" "$WORK/node-bootstrap.sh" "/root/xfreedom-rkn-stage/node-bootstrap.sh"
  run_scp "$ip" "$pass" "$WORK/configure-node.sh" "/root/xfreedom-rkn-stage/configure-node.sh"
  run_ssh "$ip" "$pass" "chmod 700 /root/xfreedom-rkn-stage/*.sh && REALITY_SNI='$REALITY_SNI' /root/xfreedom-rkn-stage/node-bootstrap.sh '$role' '$ip' '$mesh'"
}

echo "[4/8] Installing Ubuntu network stack on all nodes..."
stage_one "$EDGE_IP" "$EDGE_PASS" edge "$EDGE_MESH"
stage_one "$CORE1_IP" "$CORE1_PASS" core1 "$CORE1_MESH"
stage_one "$CORE2_IP" "$CORE2_PASS" core2 "$CORE2_MESH"

EDGE_PUB=$(run_ssh "$EDGE_IP" "$EDGE_PASS" "cat /etc/xfreedom-rkn/awg-public.key")
CORE1_PUB=$(run_ssh "$CORE1_IP" "$CORE1_PASS" "cat /etc/xfreedom-rkn/awg-public.key")
CORE2_PUB=$(run_ssh "$CORE2_IP" "$CORE2_PASS" "cat /etc/xfreedom-rkn/awg-public.key")
[[ -n "$EDGE_PUB" && -n "$CORE1_PUB" && -n "$CORE2_PUB" ]] || { echo "Failed to collect AmneziaWG public keys." >&2; exit 1; }

rand_u16() {
  local min=$1 max=$2 n
  n=$(od -An -N2 -tu2 /dev/urandom | tr -d ' ')
  echo $(( min + n % (max - min + 1) ))
}
rand_u32() {
  od -An -N4 -tu4 /dev/urandom | tr -d ' '
}
unique_u32() {
  local a b c d
  while :; do
    a=$(rand_u32); b=$(rand_u32); c=$(rand_u32); d=$(rand_u32)
    if [[ "$a" != "$b" && "$a" != "$c" && "$a" != "$d" && "$b" != "$c" && "$b" != "$d" && "$c" != "$d" ]]; then
      echo "$a $b $c $d"
      return
    fi
  done
}

AWG_PORT=$(rand_u16 20000 50000)
AWG_S1=$(rand_u16 40 120)
while :; do AWG_S2=$(rand_u16 40 120); [[ "$AWG_S2" != "$AWG_S1" ]] && break; done
read -r AWG_H1 AWG_H2 AWG_H3 AWG_H4 < <(unique_u32)
PSK_EDGE_CORE1=$(openssl rand -base64 32 | tr -d '\n')
PSK_EDGE_CORE2=$(openssl rand -base64 32 | tr -d '\n')
PSK_CORE1_CORE2=$(openssl rand -base64 32 | tr -d '\n')

write_cluster_env() {
  local ip=$1 pass=$2 p1key=$3 p1psk=$4 p1endpoint=$5 p1mesh=$6 p2key=$7 p2psk=$8 p2endpoint=$9 p2mesh=${10}
  local tmp
  tmp=$(mktemp)
  cat >"$tmp" <<EOF
PEER1_PUBLIC_KEY=$p1key
PEER1_PSK=$p1psk
PEER1_ENDPOINT=$p1endpoint
PEER1_MESH_IP=$p1mesh
PEER2_PUBLIC_KEY=$p2key
PEER2_PSK=$p2psk
PEER2_ENDPOINT=$p2endpoint
PEER2_MESH_IP=$p2mesh
AWG_PORT=$AWG_PORT
AWG_S1=$AWG_S1
AWG_S2=$AWG_S2
AWG_H1=$AWG_H1
AWG_H2=$AWG_H2
AWG_H3=$AWG_H3
AWG_H4=$AWG_H4
CORE1_MESH_IP=$CORE1_MESH
CORE2_MESH_IP=$CORE2_MESH
EOF
  run_scp "$ip" "$pass" "$tmp" "/etc/xfreedom-rkn/cluster.env"
  run_ssh "$ip" "$pass" "chmod 600 /etc/xfreedom-rkn/cluster.env"
  rm -f "$tmp"
}

echo "[5/8] Building private AmneziaWG full mesh..."
write_cluster_env "$EDGE_IP" "$EDGE_PASS" "$CORE1_PUB" "$PSK_EDGE_CORE1" "$CORE1_IP" "$CORE1_MESH" "$CORE2_PUB" "$PSK_EDGE_CORE2" "$CORE2_IP" "$CORE2_MESH"
write_cluster_env "$CORE1_IP" "$CORE1_PASS" "$EDGE_PUB" "$PSK_EDGE_CORE1" "$EDGE_IP" "$EDGE_MESH" "$CORE2_PUB" "$PSK_CORE1_CORE2" "$CORE2_IP" "$CORE2_MESH"
write_cluster_env "$CORE2_IP" "$CORE2_PASS" "$EDGE_PUB" "$PSK_EDGE_CORE2" "$EDGE_IP" "$EDGE_MESH" "$CORE1_PUB" "$PSK_CORE1_CORE2" "$CORE1_IP" "$CORE1_MESH"

configure() {
  local ip=$1 pass=$2 role=$3
  echo "--- configure $role $ip"
  if ! retry 2 4 run_ssh "$ip" "$pass" "/root/xfreedom-rkn-stage/configure-node.sh"; then
    echo "Diagnostics for $role:" >&2
    run_ssh "$ip" "$pass" "journalctl --no-pager -n 100 -u awg-quick@awg0.service -u xray.service -u hysteria-server.service" || true
    exit 1
  fi
}

echo "[6/8] Configuring REALITY, Hysteria2 and watchdog..."
configure "$CORE1_IP" "$CORE1_PASS" core1
configure "$CORE2_IP" "$CORE2_PASS" core2
configure "$EDGE_IP" "$EDGE_PASS" edge

verify_node() {
  local ip=$1 pass=$2 role=$3 peer1=$4 peer2=$5
  echo "--- verify $role $ip"
  run_ssh "$ip" "$pass" "set -e
    systemctl is-active --quiet awg-quick@awg0.service
    systemctl is-active --quiet xray.service
    systemctl is-active --quiet hysteria-server.service
    systemctl is-enabled --quiet xfreedom-rkn-watchdog.timer
    ip link show awg0 >/dev/null
    ss -lnt | grep -qE '[:.]443[[:space:]]'
    ss -lnu | grep -qE '[:.]443[[:space:]]'
    ping -c 2 -W 2 '$peer1' >/dev/null
    ping -c 2 -W 2 '$peer2' >/dev/null
    awg show awg0
    echo services-ok"
}

echo "[7/8] End-to-end verification..."
verify_node "$EDGE_IP" "$EDGE_PASS" edge "$CORE1_MESH" "$CORE2_MESH"
verify_node "$CORE1_IP" "$CORE1_PASS" core1 "$EDGE_MESH" "$CORE2_MESH"
verify_node "$CORE2_IP" "$CORE2_PASS" core2 "$EDGE_MESH" "$CORE1_MESH"

echo "[8/8] Collecting client profiles..."
{
  echo "### EDGE $EDGE_IP"
  run_ssh "$EDGE_IP" "$EDGE_PASS" "cat /etc/xfreedom-rkn/client-links.txt"
  echo
  echo "### CORE1 $CORE1_IP"
  run_ssh "$CORE1_IP" "$CORE1_PASS" "cat /etc/xfreedom-rkn/client-links.txt"
  echo
  echo "### CORE2 $CORE2_IP"
  run_ssh "$CORE2_IP" "$CORE2_PASS" "cat /etc/xfreedom-rkn/client-links.txt"
} >"$RESULTS"

chmod 600 "$RESULTS"
unset EDGE_PASS CORE1_PASS CORE2_PASS

echo
echo "========================================"
echo "XFreedom cluster is UP"
echo "AmneziaWG mesh: $EDGE_MESH <-> $CORE1_MESH <-> $CORE2_MESH"
echo "TCP 443: VLESS + REALITY"
echo "UDP 443: Hysteria2 + Salamander"
echo "profiles: $RESULTS"
echo "========================================"
cat "$RESULTS"
