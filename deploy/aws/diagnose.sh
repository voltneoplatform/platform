#!/usr/bin/env bash
# Read-only health report for the test site, shown as annotations on the run:
# container state, recent errors from the API and Caddy, and a file-storage
# round trip. Changes nothing except a small test file in the bucket.
# shellcheck source=deploy/aws/lib.sh
source "$(dirname "$0")/lib.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"; "$here/aws/ports.sh" closed || true' EXIT
umask 077
SERVER_IP=$(lsl get-static-ip --static-ip-name "$STATIC_IP" | jq -r .staticIp.ipAddress)
ssh_open
wait_for 120 "SSH to the server" remote true

# show <title> <text>: up to 10 notices of ~3,000 characters each.
show() {
  local title=$1 text=$2 i=0
  while [ -n "$text" ] && [ $i -lt 10 ]; do
    i=$((i + 1))
    echo "::notice title=$title ($i)::$(head -c 3000 <<<"$text" | tr '\n' '¶' | sed 's/¶/ ¶ /g')"
    text=$(tail -c +3001 <<<"$text")
  done
}

show "Containers" "$(remote 'cd /opt/voltneo && sudo docker compose ps --format "{{.Service}} {{.State}} {{.Status}}"' 2>&1)"
show "API errors (last ${HOURS:-6} h)" "$(remote "cd /opt/voltneo && sudo docker compose logs --no-color --since ${HOURS:-6}h api 2>&1 | grep -iE 'error|exception|warn|fail' | tail -40" 2>&1)"
show "Caddy errors (last ${HOURS:-6} h)" "$(remote "cd /opt/voltneo && sudo docker compose logs --no-color --since ${HOURS:-6}h caddy 2>&1 | grep -iE '\"level\":\"(error|warn)\"' | tail -15" 2>&1)"

# File storage round trip from inside the API container, with its own settings.
cat >"$work/s3check.js" <<'JS'
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
(async () => {
  const c = new S3Client({ region: process.env.S3_REGION, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
  const Key = `ops-check/${Date.now()}.txt`, Bucket = process.env.S3_BUCKET;
  const t = Date.now();
  try {
    await c.send(new PutObjectCommand({ Bucket, Key, Body: 'ok', ContentType: 'text/plain', IfNoneMatch: '*' }));
    const g = await c.send(new GetObjectCommand({ Bucket, Key }));
    const body = await g.Body.transformToString();
    await c.send(new DeleteObjectCommand({ Bucket, Key }));
    console.log(`put/get/delete ok in ${Date.now() - t} ms, read back "${body}", encryption ${g.ServerSideEncryption || 'none reported'}`);
  } catch (e) {
    console.log(`FAILED after ${Date.now() - t} ms: ${e.name}: ${e.message} (HTTP ${e.$metadata?.httpStatusCode})`);
  }
})();
JS
remote_copy "$work/s3check.js" "$user@$SERVER_IP:/tmp/s3check.js"
show "File storage check" "$(remote 'cd /opt/voltneo && sudo docker compose cp /tmp/s3check.js api:/tmp/s3check.js >/dev/null && sudo docker compose exec -T -w /repo/apps/api api node /tmp/s3check.js; rm -f /tmp/s3check.js' 2>&1)"
