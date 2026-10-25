#!/usr/bin/env bash
# Puts a built release on the server. Needs: API_IMAGE, ADMIN_IMAGE, GHCR_USER,
# GHCR_TOKEN, SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, and SERVER_IP, DB_HOST,
# DB_PORT from provision.sh. Optional: CASHFREE_APP_ID, CASHFREE_SECRET_KEY,
# FIRST_ADMIN_EMAIL, FIRST_ADMIN_NAME.
# shellcheck source=deploy/aws/lib.sh
source "$(dirname "$0")/lib.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"; "$here/aws/ports.sh" closed || true' EXIT
umask 077

# --- Short-lived SSH access issued by Lightsail (no stored SSH key) --------------
access=$(lsl get-instance-access-details --instance-name "$INSTANCE" --protocol ssh)
jq -r .accessDetails.privateKey <<<"$access" > "$work/key"
jq -r .accessDetails.certKey <<<"$access" > "$work/key-cert.pub"
user=$(jq -r .accessDetails.username <<<"$access")
jq -r --arg ip "$SERVER_IP" '.accessDetails.hostKeys[] | "\($ip) \(.algorithm) \(.publicKey)"' <<<"$access" > "$work/known_hosts"
ssh_opts=(-i "$work/key" -o CertificateFile="$work/key-cert.pub" -o UserKnownHostsFile="$work/known_hosts"
  -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o BatchMode=yes)
remote() { ssh "${ssh_opts[@]}" "$user@$SERVER_IP" "$@"; }

runner_ip=$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')
"$here/aws/ports.sh" open "$runner_ip/32"
wait_for 600 "SSH and the first-boot setup" remote test -f /var/lib/voltneo-first-boot-done

# --- File storage key: created once and kept on the server ------------------------
if ! remote sudo test -s /opt/voltneo/s3.env; then
  keys=$(lsl get-bucket-access-keys --bucket-name "$BUCKET")
  if [ "$(jq '.accessKeys | length' <<<"$keys")" -ge 2 ]; then
    oldest=$(jq -r '.accessKeys | sort_by(.createdAt) | .[0].accessKeyId' <<<"$keys")
    lsl delete-bucket-access-key --bucket-name "$BUCKET" --access-key-id "$oldest" >/dev/null
  fi
  new=$(lsl create-bucket-access-key --bucket-name "$BUCKET")
  echo "::add-mask::$(jq -r .accessKey.secretAccessKey <<<"$new")"
  {
    echo "S3_ACCESS_KEY_ID='$(jq -r .accessKey.accessKeyId <<<"$new")'"
    echo "S3_SECRET_ACCESS_KEY='$(jq -r .accessKey.secretAccessKey <<<"$new")'"
  } > "$work/s3.env"
  notice "File storage" "Created a new access key for $BUCKET"
fi

# --- Settings ---------------------------------------------------------------------
db_password=$(lsl get-relational-database-master-user-password \
  --relational-database-name "$DATABASE" --password-version CURRENT | jq -r .masterUserPassword)
echo "::add-mask::$db_password"
db="postgresql://$DB_USER:$db_password@$DB_HOST:$DB_PORT/$DB_NAME"
ca=/etc/ssl/rds-global-bundle.pem

# Every value is single-quoted so Docker never expands "$" inside it.
put() {
  case "$2" in *"'"* | *$'\n'*) fail "Setting $1 contains a quote or a line break" ;; esac
  printf "%s='%s'\n" "$1" "$2"
}
payment=none
[ -n "${CASHFREE_APP_ID:-}" ] && [ -n "${CASHFREE_SECRET_KEY:-}" ] && payment=cashfree
{
  put NODE_ENV production
  put DEPLOYMENT "$ENV_NAME"
  put DATABASE_URL "$db?sslmode=verify-full&sslrootcert=$ca"
  put MIGRATE_DATABASE_URL "$db?sslmode=require&sslcert=$ca"
  put OTP_DELIVERY ses
  put SES_REGION "$REGION"
  put SES_FROM "$SES_FROM"
  put SES_ACCESS_KEY_ID "${SES_ACCESS_KEY_ID:?Add the SES_ACCESS_KEY_ID secret in GitHub}"
  put SES_SECRET_ACCESS_KEY "${SES_SECRET_ACCESS_KEY:?Add the SES_SECRET_ACCESS_KEY secret in GitHub}"
  put FILE_STORAGE s3
  put S3_BUCKET "$BUCKET"
  put S3_REGION "$REGION"
  put MESSAGE_DELIVERY log
  put JOBS_ENABLED true
  put ADMIN_ORIGIN "https://$ADMIN_HOST"
  put PUBLIC_API_URL "https://$API_HOST"
  put PAYMENT_GATEWAY "$payment"
  if [ "$payment" = cashfree ]; then
    put CASHFREE_ENV sandbox
    put CASHFREE_APP_ID "$CASHFREE_APP_ID"
    put CASHFREE_SECRET_KEY "$CASHFREE_SECRET_KEY"
  fi
  # Used only while the database has no staff: creates the first super admin.
  put BOOTSTRAP_SUPER_ADMIN_NAME "${FIRST_ADMIN_NAME:-Volt Neo Admin}"
  put BOOTSTRAP_SUPER_ADMIN_EMAIL "${FIRST_ADMIN_EMAIL:-}"
} > "$work/runtime.env"
{
  put API_IMAGE "${API_IMAGE:?}"
  put ADMIN_IMAGE "${ADMIN_IMAGE:?}"
  put ADMIN_HOST "$ADMIN_HOST"
  put API_HOST "$API_HOST"
} > "$work/.env"
[ "$payment" = cashfree ] || notice "UPI links" "Off: add the CASHFREE_APP_ID and CASHFREE_SECRET_KEY secrets to turn on Cashfree sandbox"

# --- Copy and apply ---------------------------------------------------------------
remote 'rm -rf /tmp/voltneo-release && mkdir -m 700 /tmp/voltneo-release'
files=("$here/server/compose.yml" "$here/server/Caddyfile" "$here/server/apply.sh" "$work/runtime.env" "$work/.env")
[ -f "$work/s3.env" ] && files+=("$work/s3.env")
scp -q "${ssh_opts[@]}" "${files[@]}" "$user@$SERVER_IP:/tmp/voltneo-release/"
printf '%s' "${GHCR_TOKEN:?}" | remote "sudo GHCR_USER='${GHCR_USER:?}' bash /tmp/voltneo-release/apply.sh"

# --- Check from outside --------------------------------------------------------------
if curl -fsS --max-time 10 "https://$API_HOST/v1/health" >/dev/null 2>&1; then
  notice "Online" "https://$ADMIN_HOST and https://$API_HOST are answering"
else
  notice "Not reachable by name yet" "Point $DOMAIN to the Lightsail nameservers; https starts once DNS has moved"
fi
