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

# --- SSH with short-lived certificates from Lightsail (needs $work and $SERVER_IP) ---
# shellcheck disable=SC2154 # work and SERVER_IP are set by the calling script
# The certificate lasts only minutes, so ssh_access is called again before each phase.
ssh_access() {
  local access
  access=$(lsl get-instance-access-details --instance-name "$INSTANCE" --protocol ssh)
  jq -r .accessDetails.privateKey <<<"$access" >"$work/key"
  jq -r .accessDetails.certKey <<<"$access" >"$work/key-cert.pub"
  chmod 600 "$work/key"
  user=$(jq -r .accessDetails.username <<<"$access")
  jq -r --arg ip "$SERVER_IP" '.accessDetails.hostKeys[] | "\($ip) \(.algorithm) \(.publicKey)"' <<<"$access" >"$work/known_hosts"
}
remote() {
  ssh -i "$work/key" -o CertificateFile="$work/key-cert.pub" -o UserKnownHostsFile="$work/known_hosts" \
    -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o BatchMode=yes "$user@$SERVER_IP" "$@"
}
remote_copy() {
  scp -q -i "$work/key" -o CertificateFile="$work/key-cert.pub" -o UserKnownHostsFile="$work/known_hosts" \
    -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o BatchMode=yes "$@"
}
# Opens SSH to this runner only (closed again by ports.sh closed) and fetches a certificate.
ssh_open() {
  local runner_ip
  runner_ip=$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')
  "$here/aws/ports.sh" open "$runner_ip/32"
  ssh_access
}
