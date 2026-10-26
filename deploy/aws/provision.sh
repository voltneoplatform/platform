#!/usr/bin/env bash
# Creates the hosting pieces if they do not exist yet, and checks the ones that do.
# Safe to run on every deploy: nothing is created twice and nothing is deleted.
# shellcheck source=deploy/aws/lib.sh
source "$(dirname "$0")/lib.sh"

# --- Server ------------------------------------------------------------------
if ! exists lsl get-instance --instance-name "$INSTANCE"; then
  bundle=$(lsl get-bundles | jq -r --argjson ram "$SERVER_RAM_GB" '
    [.bundles[] | select(.isActive and .ramSizeInGb == $ram
      and (.supportedPlatforms | index("LINUX_UNIX"))
      and (.bundleId | test("ipv6|memory|compute") | not))] | sort_by(.price) | .[0].bundleId')
  blueprint=$(lsl get-blueprints | jq -r '
    [.blueprints[] | select(.isActive and .platform == "LINUX_UNIX" and (.blueprintId | startswith("ubuntu_24")))]
    | sort_by(.blueprintId) | last | .blueprintId')
  [ "$bundle" != null ] && [ "$blueprint" != null ] || fail "No matching server plan or Ubuntu image"
  notice "Creating server" "$INSTANCE ($bundle, $blueprint) in $ZONE"
  lsl create-instances --instance-names "$INSTANCE" --availability-zone "$ZONE" \
    --blueprint-id "$blueprint" --bundle-id "$bundle" \
    --user-data "file://$here/server/first-boot.sh" \
    --tags key=project,value=voltneo key=env,value="$ENV_NAME" >/dev/null
fi
wait_for 600 "the server to start" \
  bash -c "aws lightsail get-instance-state --instance-name '$INSTANCE' --region '$REGION' --query state.name --output text | grep -qx running"

# Daily snapshot at 02:30 IST (Lightsail takes whole UTC hours); it keeps the last seven.
if ! lsl get-instance --instance-name "$INSTANCE" | jq -e '.instance.addOns[]? | select(.name == "AutoSnapshot" and .status == "Enabled")' >/dev/null; then
  lsl enable-add-on --resource-name "$INSTANCE" \
    --add-on-request 'addOnType=AutoSnapshot,autoSnapshotAddOnRequest={snapshotTimeOfDay=21:00}' >/dev/null
  notice "Snapshots" "Daily server snapshots turned on (02:30 IST)"
fi

# --- Fixed public address --------------------------------------------------------
if ! exists lsl get-static-ip --static-ip-name "$STATIC_IP"; then
  lsl allocate-static-ip --static-ip-name "$STATIC_IP" >/dev/null
fi
if ! lsl get-static-ip --static-ip-name "$STATIC_IP" | jq -e --arg i "$INSTANCE" '.staticIp.attachedTo == $i' >/dev/null; then
  lsl attach-static-ip --static-ip-name "$STATIC_IP" --instance-name "$INSTANCE" >/dev/null
fi
ip=$(lsl get-static-ip --static-ip-name "$STATIC_IP" | jq -r .staticIp.ipAddress)

# --- Firewall: web traffic only; SSH only from the Lightsail browser console -----
"$here/aws/ports.sh" closed

# --- Database (managed PostgreSQL, encrypted, not reachable from the internet) ----
if ! exists lsl get-relational-database --relational-database-name "$DATABASE"; then
  dbbundle=$(lsl get-relational-database-bundles | jq -r --argjson ram "$DB_RAM_GB" '
    [.bundles[] | select(.isActive and .isEncrypted and .ramSizeInGb == $ram
      and (.bundleId | test("ha") | not))] | sort_by(.price) | .[0].bundleId')
  dbblueprint=$(lsl get-relational-database-blueprints | jq -r '
    [.blueprints[] | select(.engine == "postgres")] as $pg
    | ([$pg[] | select(.blueprintId == "postgres_16")] + [$pg[] | select(.isEngineDefault)])[0].blueprintId')
  [ "$dbbundle" != null ] && [ "$dbblueprint" != null ] || fail "No matching database plan"
  notice "Creating database" "$DATABASE ($dbbundle, $dbblueprint); this takes 10 to 20 minutes"
  # Hex only, so the password needs no escaping anywhere. AWS keeps it; deploys read it back.
  lsl create-relational-database --relational-database-name "$DATABASE" \
    --availability-zone "$ZONE" --relational-database-blueprint-id "$dbblueprint" \
    --relational-database-bundle-id "$dbbundle" --master-database-name "$DB_NAME" \
    --master-username "$DB_USER" --master-user-password "$(openssl rand -hex 24)" \
    --no-publicly-accessible --preferred-backup-window 20:30-21:00 \
    --preferred-maintenance-window Sun:21:30-Sun:22:00 \
    --tags key=project,value=voltneo key=env,value="$ENV_NAME" >/dev/null
fi
wait_for 2400 "the database to be ready" \
  bash -c "aws lightsail get-relational-database --relational-database-name '$DATABASE' --region '$REGION' --query relationalDatabase.state --output text | grep -qx available"
lsl get-relational-database --relational-database-name "$DATABASE" | jq -e '
  .relationalDatabase | (.publiclyAccessible | not) and .backupRetentionEnabled' >/dev/null \
  || fail "The database must be private with automatic backups on"

# --- File storage (private bucket, versioned so a deleted file can be recovered) ---
if ! exists lsl get-buckets --bucket-name "$BUCKET"; then
  bbundle=$(lsl get-bucket-bundles | jq -r --argjson gb "$BUCKET_STORAGE_GB" '
    [.bundles[] | select(.isActive and .storagePerMonthInGb == $gb)][0].bundleId')
  [ "$bbundle" != null ] || fail "No matching storage plan"
  notice "Creating file storage" "$BUCKET ($bbundle)"
  lsl create-bucket --bucket-name "$BUCKET" --bundle-id "$bbundle" --enable-object-versioning \
    --tags key=project,value=voltneo key=env,value="$ENV_NAME" >/dev/null
fi
lsl get-buckets --bucket-name "$BUCKET" | jq -e '.buckets[0].accessRules.getObject == "private" and (.buckets[0].accessRules.allowPublicOverrides | not)' >/dev/null \
  || fail "The file bucket must be private"

# --- DNS ---------------------------------------------------------------------
# The domain already serves the website and email from its current DNS provider,
# so its nameservers stay where they are. This script lists the records to add
# there and checks them through public DNS; it never changes them itself.
need=()
# want <type> <name> <value>: notes a record that must exist, and whether it does.
want() {
  local type=$1 name=$2 value=$3 have
  have=$(dig +short "$type" "$name" @1.1.1.1 | sed 's/\.$//' | tr -d '"' | tr '[:upper:]' '[:lower:]')
  if grep -qixF -- "$(tr -d '"' <<<"${value%.}" | tr '[:upper:]' '[:lower:]')" <<<"$have"; then
    echo "DNS ok: $type $name"
  else
    need+=("$type  $name  →  $value")
  fi
}
notice "Current DNS for $DOMAIN" "nameservers: $(dig +short NS "$DOMAIN" @1.1.1.1 | tr '\n' ' ')· mail: $(dig +short MX "$DOMAIN" @1.1.1.1 | tr '\n' ' ')"
want A "$ADMIN_HOST" "$ip"
want A "$API_HOST" "$ip"

# --- Email (SES, Mumbai): sending domain with DKIM, SPF and DMARC ---------------
if ! exists ses get-email-identity --email-identity "$DOMAIN"; then
  ses create-email-identity --email-identity "$DOMAIN" >/dev/null
fi
for token in $(ses get-email-identity --email-identity "$DOMAIN" | jq -r '.DkimAttributes.Tokens[]'); do
  want CNAME "$token._domainkey.$DOMAIN" "$token.dkim.amazonses.com"
done
ses put-email-identity-mail-from-attributes --email-identity "$DOMAIN" \
  --mail-from-domain "$MAIL_FROM_DOMAIN" --behavior-on-mx-failure USE_DEFAULT_VALUE >/dev/null
want MX "$MAIL_FROM_DOMAIN" "10 feedback-smtp.$REGION.amazonses.com"
want TXT "$MAIL_FROM_DOMAIN" "v=spf1 include:amazonses.com ~all"
# A DMARC record only if the domain has none; an existing one is left as it is.
if ! dig +short TXT "_dmarc.$DOMAIN" @1.1.1.1 | grep -qi 'v=DMARC1'; then
  want TXT "_dmarc.$DOMAIN" "v=DMARC1; p=none;"
fi

# While SES is in its sandbox it only delivers to confirmed addresses.
IFS=',' read -ra recipients <<<"${SES_TEST_RECIPIENTS:-}"
for r in "${recipients[@]}"; do
  r=$(echo "$r" | tr -d ' ' | tr '[:upper:]' '[:lower:]')
  [ -n "$r" ] || continue
  exists ses get-email-identity --email-identity "$r" \
    || { ses create-email-identity --email-identity "$r" >/dev/null; notice "Email check sent" "AWS emailed $r a link to confirm the address"; }
done

[ -n "${SES_TEST_RECIPIENTS:-}" ] || notice "Email testers" "Not set: add the GitHub variable SES_TEST_RECIPIENTS (comma-separated emails) while SES is in its sandbox"

# --- Summary -----------------------------------------------------------------------
domain_status=$(ses get-email-identity --email-identity "$DOMAIN" | jq -r '.VerificationStatus')
sandbox=$(ses get-account | jq -r 'if .ProductionAccessEnabled then "production access" else "sandbox (confirmed addresses only)" end')
notice "Server address" "$ip"
if [ ${#need[@]} -gt 0 ]; then
  i=0
  for r in "${need[@]}"; do
    i=$((i + 1))
    notice "Add DNS record $i of ${#need[@]}" "$r"
  done
else
  notice "DNS" "All records are in place"
fi
notice "Email" "Domain $domain_status; SES $sandbox"

db=$(lsl get-relational-database --relational-database-name "$DATABASE")
{
  echo "SERVER_IP=$ip"
  echo "DB_HOST=$(jq -r .relationalDatabase.masterEndpoint.address <<<"$db")"
  echo "DB_PORT=$(jq -r .relationalDatabase.masterEndpoint.port <<<"$db")"
} >> "${GITHUB_ENV:-/dev/null}"
