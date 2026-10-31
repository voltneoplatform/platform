# Driver App (milestone M6)

React Native (Expo), Android first, in Bengali, Hindi and English. Drivers sign
in with a code sent to their registered mobile number, see their plan and what
is due, pay exactly the amount due by UPI (Cashfree payment page), see receipts,
open the Key Facts and the signed agreement, and report a battery problem.

- API: `/v1/driver-auth/*` (sign-in) and `/v1/me/*` (everything else); driver
  tokens are signed for a separate audience, so they never work on staff routes.
- Test site: until the DLT sign-in template is approved, codes for drivers are
  emailed to the first admin (`DRIVER_CODE_TEST_EMAIL`), never sent by SMS.
- Build: the "Driver App (Android)" workflow attaches an APK to each run; the
  API address comes from the repository variable `DRIVER_API_URL` (default: the
  test site).
- Wording REQUIRES VALIDATION by native speakers before drivers use the app.

Run locally: `EXPO_PUBLIC_API_URL=http://localhost:4000 pnpm --filter @voltneo/driver web`
(the API needs `CORS_EXTRA_ORIGINS=http://localhost:8081`).
