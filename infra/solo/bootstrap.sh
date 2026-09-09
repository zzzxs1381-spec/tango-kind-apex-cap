#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Запустите через sudo bash.' >&2; exit 1; }
REF=${XF_REF:?Укажите XF_REF — полный SHA проверенного коммита}
[[ $REF =~ ^[a-f0-9]{40}$ ]] || { echo 'XF_REF должен содержать 40 шестнадцатеричных символов.' >&2; exit 1; }
if ! command -v git >/dev/null || ! command -v python3 >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o DPkg::Lock::Timeout=120 update
  apt-get -o DPkg::Lock::Timeout=120 install -y git python3 ca-certificates
fi
STAGE=$(mktemp -d /root/xfreedom-source.XXXXXXXX)
trap 'rm -rf -- "$STAGE"' EXIT
git -C "$STAGE" init --quiet
git -C "$STAGE" remote add origin https://github.com/zzzxs1381-spec/tango-kind-apex-cap.git
git -C "$STAGE" fetch --quiet --depth 1 origin "$REF"
git -C "$STAGE" checkout --quiet --detach FETCH_HEAD
[[ $(git -C "$STAGE" rev-parse HEAD) == "$REF" ]] || { echo 'SHA исходников не совпал.' >&2; exit 1; }
bash "$STAGE/infra/solo/install.sh" "$@"
