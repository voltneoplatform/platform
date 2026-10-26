# Hosting (test site)

The test site runs on AWS Lightsail in Mumbai (decisions T82–T90). GitHub
Actions does everything; nobody logs in to the server to deploy.

| Piece        | Name                                   | What it holds                                 |
| ------------ | -------------------------------------- | --------------------------------------------- |
| Server       | `voltneo-staging` (4 GB)               | API, admin panel, Valkey, Caddy (Docker)      |
| Fixed IP     | `voltneo-staging-ip`                   | admin.voltcompany.in, api.voltcompany.in      |
| Database     | `voltneo-staging-db` (2 GB, encrypted) | PostgreSQL, private, daily automatic backups  |
| File storage | `voltcompany-staging-files`            | KYC photos, signed agreements, PDFs (private) |
| DNS          | `voltcompany.in` zone                  | Lightsail nameservers                         |
| Email        | SES identity `voltcompany.in`          | Staff sign-in codes                           |

## How a deploy runs

`.github/workflows/hosting.yml` runs after CI passes on `main` (or from the
Actions tab, or on a push to the `hosting-test` branch):

1. Builds `deploy/api.Dockerfile` and `deploy/admin.Dockerfile` and pushes them
   to GitHub's container registry, tagged with the commit.
2. `deploy/aws/provision.sh` creates anything missing (server, IP, firewall,
   database, bucket, SES domain) and checks the rest. It never deletes
   anything. DNS stays with the domain's current provider (it also serves the
   website and email): the run lists any records still to add there as
   notices, and checks them through public DNS.
3. `deploy/aws/deploy.sh` gets a short-lived SSH certificate from Lightsail,
   opens SSH to the runner only, writes the settings, and runs
   `deploy/server/apply.sh` on the server: pull images, run migrations, start,
   wait for health, roll back the app version if it fails. SSH is closed again.

## GitHub settings it reads

| Kind     | Name                                         | Notes                                                      |
| -------- | -------------------------------------------- | ---------------------------------------------------------- |
| Secret   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | IAM user `github-deploy` (Lightsail and SES only)          |
| Secret   | `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` | IAM user `voltneo-mailer` (send email only)                |
| Secret   | `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`     | Optional; sandbox keys turn on UPI links                   |
| Variable | `AWS_REGION`                                 | `ap-south-1`                                               |
| Variable | `FIRST_ADMIN_EMAIL`, `FIRST_ADMIN_NAME`      | First super admin, created only while there are no staff   |
| Variable | `SES_TEST_RECIPIENTS`                        | Comma-separated addresses AWS should confirm (SES sandbox) |

## On the server

`/opt/voltneo` holds `compose.yml`, `Caddyfile`, `.env` (image tags),
`runtime.env` (settings, rewritten each deploy), `s3.env` (file-storage key)
and `secrets.env` (sign-in, OTP and KYC keys, generated there once). Losing
`secrets.env` signs everyone out and makes stored KYC ID numbers unreadable;
the daily snapshots keep it. For a look, use **Connect using SSH** in the
Lightsail console, then `cd /opt/voltneo && sudo docker compose ps` or
`sudo docker compose logs --tail 100 api`.
