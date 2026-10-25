# shellcheck shell=bash
# Shared helpers for the hosting scripts. Needs the AWS CLI and jq (both on GitHub's runners).
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=deploy/staging.conf
source "$here/${DEPLOY_CONF:-staging.conf}"

# aws_call <region> <service> <args...>: on failure, shows AWS's message as an
# error annotation (run logs are not always at hand) and returns its exit code.
aws_call() {
  local region=$1 err rc=0
  shift
  err=$(mktemp)
  aws "$@" --region "$region" --output json 2>"$err" || rc=$?
  if [ "$rc" -ne 0 ] && [ -z "${QUIET_AWS:-}" ]; then
    echo "::error title=aws $1 $2::$(tr '\n' ' ' <"$err" | cut -c1-400)" >&2
  fi
  rm -f "$err"
  return "$rc"
}
lsl() { aws_call "$REGION" lightsail "$@"; }
# Lightsail DNS zones are managed only through N. Virginia (an AWS rule; no customer data).
dns() { aws_call us-east-1 lightsail "$@"; }
ses() { aws_call "$REGION" sesv2 "$@"; }
# For "does it exist?" checks, where a failure is expected and not an error.
exists() { QUIET_AWS=1 "$@" >/dev/null 2>&1; }
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
