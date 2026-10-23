# Volt Neo platform

Backend, head-office admin panel, Field App and Driver App for Volt Neo's Neo Own
(lease-to-own battery) business. Business rules come from **Business & Brand
Foundation V2.1** (Decision Log D1–D52) and the **Platform MVP Spec V1**.

## Status

| Milestone                   | Delivers                                                                               | State    |
| --------------------------- | -------------------------------------------------------------------------------------- | -------- |
| **M0 Foundation**           | Monorepo, database, staff login with roles, tests on every change                      | **Done** |
| **M1 Set-up data**          | Battery types, inventory, plans with versions and cost floor, drivers with KYC         | **Done** |
| **M2 Agreements and money** | Agreements, schedules, installation, payments, ledger, receipts, Schedule 1 and 5 PDFs | **Done** |
| M3 Collections              | Daily jobs, reminders, grace, late fee, immobilisation, restore, recovery              | Next     |
| M4 Operations               | Service tickets, dashboard, early exit, ownership transfer                             |          |
| M5 Field App                | Android app for agents, technicians and recovery staff                                 |          |
| M6 Driver App               | Android app for drivers in Bengali, Hindi and English                                  |          |

## Layout

```
apps/
  api/      NestJS REST API under /v1, PostgreSQL via Prisma
  admin/    Next.js head-office admin panel
  field/    Field App (React Native, Expo) — M5
  driver/   Driver App (React Native, Expo) — M6
packages/
  shared/   Roles, permissions, money helpers and types used by every app
docs/
  decisions.md   Technical decisions and why
```

## What M0 includes

- **Staff login by one-time code** sent to an email address or Indian mobile number.
  Codes expire in 5 minutes, lock after 5 wrong tries, work once, and are stored
  only as hashes. The API answers the same way for unknown accounts, so staff
  accounts cannot be probed.
- **Sessions** with short-lived access tokens and single-use refresh tokens.
  Reusing an old refresh token ends every session in that login. Sessions end
  after 30 minutes without activity or 12 hours in total. Logging out, a role
  change or deactivation takes effect at once.
- **Eight roles** from the spec (super admin, plan manager, operations manager,
  finance, support desk, field agent, technician, recovery staff) with a single
  permission map in `packages/shared/src/roles.ts`. The API checks the role from
  the database on every request. Field roles cannot sign in to the admin panel.
- **Staff management**: create, edit, change role, deactivate and reactivate.
  Nobody can deactivate themselves or change their own role, and the last
  active super admin cannot be removed.
- **Append-only audit log**: every login, staff change and suspicious event,
  with who, when, request ID and before/after values. A database trigger blocks
  UPDATE, DELETE and TRUNCATE.
- **Admin panel**: sign-in, home, staff and roles, audit log.
- **Maker-checker rules** (who may approve which action, never one's own).
- **CI**: formatting, lint, typecheck, migration check, unit tests, end-to-end
  tests against PostgreSQL, and production builds on every push and pull request.

## What M1 includes

- **Approvals (maker-checker)**: one person asks, a different person with the
  right role approves or rejects; the action runs only on approval. Used now for
  retiring a battery and for publishing a plan below its cost floor.
- **Battery types** with specifications and an append-only cost history:
  purchase cost plus per-battery allowances that make up the cost floor.
- **Inventory**: register batteries one at a time or a whole delivery at once
  (all or nothing, every problem listed), custody history, repair moves, and
  retirement through approval. Duplicate serials and GPS IDs are refused.
- **Neo Own plans**: fixed codes (NO-P01…), names in Bengali, Hindi and English
  with length and claim checks, versions, a price grid per battery type, the
  cost-floor check with exception approval, and published versions frozen in
  the database. Renames apply to new sign-ups only.
- **Drivers and KYC**: driver, vehicle (with owner and consent form for
  renter-drivers) and nominee; duplicate phone, vehicle and ID flags; ID numbers
  encrypted (Aadhaar: last 4 digits only) and masked; documents in private
  storage behind short-lived links; every view logged; a readiness checklist
  for signing an agreement in M2.
- **Admin panel**: Drivers, Plans, Inventory, Battery types and Approvals screens.

## What M2 includes

- **Agreements**: drafts built from a published plan version's price grid for
  the chosen battery type, the 2nd or 17th as due day, and a first due date at
  least 7 days ahead; signing (paper, scan uploaded) needs the readiness
  checklist complete and fixes the payment table; terms are frozen in the
  database after signing. States move draft → awaiting down payment → awaiting
  installation → active → paid off or early exit.
- **Schedule 1 (plan) and Schedule 5 (key facts) as PDFs** in Bengali, Hindi
  and English, with amounts in figures and words and a fingerprint in the
  footer to match a paper copy. Every PDF carries a draft-wording banner until
  the lawyer and native-speaker reviews are done.
- **Installation** (Schedule 3 record): in-stock battery of the right type with
  a GPS device, technician, voltage reading, condition, 1-6 photos, driver
  confirmation; the battery moves to the driver in the custody log.
- **Payments**: late fees first, then the oldest unpaid instalment; part
  payments; UPI and card need a reference that cannot be entered twice; cash
  names the staff member holding it; repeated requests with the same ID count
  once; a gap-free receipt number per financial year; an SMS receipt in the
  driver's language (logged, not delivered, until a provider is chosen); receipt
  PDFs.
- **Ledger**: double-entry journals for every payment, cash deposit and bank
  check; the database refuses any journal that does not balance; money records
  are append-only.
- **Cash**: cash held per person, bank deposits, and a check against the bank
  statement by a second person.
- **Payment webhook** at `/v1/webhooks/payments/:provider`, signature-checked
  and idempotent, with a built-in `test` provider until a gateway is chosen.
- **Moving the first due date** before installation, as a variation approved by
  a second head-office person.
- **Admin panel**: Agreements (list, new, detail with every action), Payments
  and Cash screens; agreements on the driver page.

## Run it locally

Needs Node.js 22.12 or later, pnpm 10 and Docker (or a local PostgreSQL 16).

```bash
pnpm install
docker compose up -d                      # PostgreSQL (and Redis for later milestones)
cp apps/api/.env.example apps/api/.env    # then set the bootstrap admin email
                                          # and, outside your laptop, a fresh KYC_ENCRYPTION_KEY
pnpm --filter @voltneo/shared build
pnpm --filter @voltneo/api db:generate
pnpm --filter @voltneo/api db:deploy      # apply migrations
pnpm db:seed                              # create the first super admin
pnpm dev:api                              # http://localhost:4000/v1, docs at /docs
pnpm dev:admin                            # http://localhost:3000
```

In development, login codes and driver messages (receipts) are printed in the
API log (`OTP_DELIVERY=log`, `MESSAGE_DELIVERY=log`).
The API refuses to start in production until a real SMS or email provider is
connected.

## Tests

```bash
pnpm test        # unit tests in every package
pnpm test:e2e    # API end-to-end tests; resets the voltneo_test database
pnpm typecheck
pnpm lint
pnpm format:check
```

The end-to-end suite rebuilds the test database from the migration files, so it
tests exactly what will be deployed, including the database-level rules.

## Conventions

- Money is stored in **paise as whole numbers**, never decimals.
- Times are stored in UTC and shown in India Standard Time. A business "day"
  ends at midnight IST.
- Every business rule lives in the API, never only in a screen.
- Every change to money, plans, agreement state, battery custody or staff
  access writes an audit entry in the same database transaction.
- Every outside service (SMS, WhatsApp, payments, GPS) sits behind an adapter
  with a test version, so providers can be swapped without touching business logic.
- Driver-facing text is written in Bengali, Hindi and English; staff screens are
  English for the MVP.
- KYC ID numbers are encrypted with `KYC_ENCRYPTION_KEY`. Losing the key makes
  them unreadable; keep it in the host's secret manager, never in the code.
- Uploaded files are checked by their content, renamed to random keys and never
  served directly.
- Commits end with the attribution lines in `docs/decisions.md`.

## Not legal or compliance advice

This software implements business rules that are still under professional
review (Foundation section 10, items L1–L17). Nothing here should go live with
real driver, KYC or payment data until those reviews and an independent security
review are complete.
