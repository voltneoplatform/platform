# shellcheck shell=bash
# Shared helpers for the hosting scripts. Needs the AWS CLI and jq (both on GitHub's runners).
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=deploy/staging.conf
source "$here/${DEPLOY_CONF:-staging.conf}"

lsl() { aws lightsail "$@" --region "$REGION" --output json; }
# Lightsail DNS zones are managed only through N. Virginia (an AWS rule; no customer data).
dns() { aws lightsail "$@" --region us-east-1 --output json; }
ses() { aws sesv2 "$@" --region "$REGION" --output json; }
notice() { echo "::notice title=$1::$2"; }
fail() { echo "::error::$1"; exit 1; }

# wait_for <seconds> <description> <command...>: retries until the command succeeds.
wait_for() {
  local limit=$1 what=$2 start=$SECONDS
  shift 2
  until "$@" >/dev/null 2>&1; do
    ((SECONDS - start < limit)) || fail "Timed out waiting for $what"
    sleep 15
  done
}
