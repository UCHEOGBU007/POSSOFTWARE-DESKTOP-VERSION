# MVP launch runbook

## Included in this code change

- The POS computes checkout discounts and tax consistently with the server RPC.
- `record_sale_v2` uses the terminal's stable sale UUID as an idempotency key,
  recalculates from the current database catalog, updates stock and customer
  totals in one transaction, and writes stock movements once.
- Offline sales are committed to IndexedDB before a receipt is shown. The
  client retries them when connectivity returns and retains failed records for
  review instead of dropping or blindly uploading them.
- A previously authenticated outlet session can resume from its local cache
  for up to 48 hours. It must still have the persisted Supabase session and a
  cached active staff/outlet profile. Logging out clears that offline lease.
- Web builds generate an offline app-shell service worker. Electron builds
  keep the installed application shell local and use a sandboxed renderer.
- Receipts have 58 mm and 80 mm layouts. Browser printing uses the browser/OS
  print dialog; browser BLE printers must support writable GATT, and browser
  network printing requires a compatible local HTTP print bridge. Electron
  lists OS-installed printers (including USB, OS-paired Bluetooth, and Wi-Fi)
  and can send raw ESC/POS over the local network to a printer on TCP port 9100.
- Authenticated checkout, billing, admin, and staff-provisioning operations
  have server-side request limits. Anonymous login and signup attempts still
  need Supabase Auth's built-in rate limits configured in the project.

## Deploy the database and functions

For a new project, apply `supabase_schema.sql` first, then apply every migration
in timestamp order:

1. `202611120001_billing_and_outlet_entitlements.sql`
2. `202611120002_admin_subscription_overrides.sql`
3. `202611120003_annual_terms_and_payment_instructions.sql`
4. `202611150001_offline_sales_and_rate_limits.sql`

For an existing project, compare its applied migration history with that list
and apply only the missing migrations. Run this sequence in a staging project
before production; the application code now calls `record_sale_v2` and disables
the older `record_sale` RPC.

Deploy both functions:

```powershell
supabase functions deploy admin-merchant --project-ref <project-ref>
supabase functions deploy provision-staff --project-ref <project-ref>
```

Configure `APP_ORIGIN` for the web app and `APP_ORIGINS` as a comma-separated
allowlist if the desktop client also needs a browser origin. Edge Functions
must have the standard Supabase URL and anon key; `provision-staff` also needs
the service-role key as an Edge Function secret. Never add that key to Vite or
the desktop renderer.

## Configure the public app

Production builds now fail closed unless `VITE_SUPABASE_URL` is HTTPS and a
Supabase publishable or anon key is configured. Set those values in the build
environment; do not commit `.env`.

In Supabase Auth, set the production site URL and redirect allowlist, enable
merchant email confirmation, set the password policy, and configure signup and
login rate limits. The staff provisioning function confirms staff accounts
after an approved merchant creates them.

Schedule `public.cleanup_api_rate_limits()` with the project's trusted
scheduled-job mechanism to remove rate-limit events older than one day. It is
granted to `service_role` only.

## Offline sale reconciliation

Offline terminal sales are local until the authenticated staff session can
reach Supabase. On replay, the server validates the active subscription,
current catalog prices, and stock. A sale that conflicts with current stock or
has an insufficient tender remains queued and is shown as needing review; it
is not silently forced into cloud inventory. Managers should reconcile these
cases before treating cloud reports as complete. Offline receipts are marked
pending, and a server-adjusted total remains flagged in the POS.

Before a public launch, validate this behavior with two terminals in staging,
including a dropped connection during checkout and simultaneous sales of the
last units of a product. Confirm tenant isolation with separate merchant and
staff accounts, verify backup restoration, and confirm the configured auth
limits and billing/payment workflows in the deployed project. Also print short
and long receipts on both paper widths using the exact browser and Electron
installers and printer models you plan to support.
