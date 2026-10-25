#!/usr/bin/env bash
# ports.sh closed            → web (80, 443) open; SSH only from the Lightsail browser console
# ports.sh open <ip>/32       → also lets this deploy run reach SSH, for the duration of the deploy
# shellcheck source=deploy/aws/lib.sh
source "$(dirname "$0")/lib.sh"
ports='[{"fromPort":80,"toPort":80,"protocol":"tcp"},{"fromPort":443,"toPort":443,"protocol":"tcp"},{"fromPort":443,"toPort":443,"protocol":"udp"}'
ssh='{"fromPort":22,"toPort":22,"protocol":"tcp","cidrListAliases":["lightsail-connect"]'
case "${1:-}" in
  closed) json="$ports,$ssh}]" ;;
  open) json="$ports,$ssh,\"cidrs\":[\"${2:?}\"]}]" ;;
  *) fail "usage: ports.sh closed | open <cidr>" ;;
esac
lsl put-instance-public-ports --instance-name "$INSTANCE" --port-infos "$json" >/dev/null
