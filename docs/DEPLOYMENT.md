# CLOTHZA — Deployment Guide (Preparation Only — Nothing Here Deploys Anything)

Practical checklist for taking CLOTHZA to production. Work through each
section when you provision hosting. No step here performs a deployment.

Payments are DEMO ONLY (Cash on Delivery + simulated Online Payment).
There is no real payment gateway and none is required — skip any
gateway credential steps you may expect from a typical store.

## 0. Pre-Flight (Local)

- [ ] `cd server && npm install && npm test` — full suite green.
- [ ] `cd client && npm install && npm run build && npm run lint` — clean.
- [ ] `git status` shows no `.env` files (they are git-ignored; only
      `.env.example` files are tracked).
- [ ] No real secrets in tracked files (search for `mongodb+srv://`,
      `rzp_`, `sk_live`, `AKIA`, literal passwords). Rotate anything that
      was ever committed.

## 1. MongoDB Atlas

- [ ] CLOTHZA already uses an existing Atlas database — REUSE it. Do not
      create a new project, cluster, database or user for this app.
- [ ] Production deployment supplies the existing connection string as
      the backend `MONGODB_URI` secret through the hosting platform's
      secret/environment-variable settings (never in code, docs or the
      frontend). The value itself is never written down anywhere in repo.
- [ ] Database user keeps a strong generated password; network access
      limited to the backend host (or `0.0.0.0/0` only if the host has
      no static IP).
- [ ] Connection string looks like
      `mongodb+srv://<user>:<password>@<cluster>/?retryWrites=true&w=majority`.
- [ ] The app redacts URIs automatically in logs; health/readiness
      endpoints expose states only, never credentials.

## 2. Backend Deployment (Render / Railway / VPS)

- [ ] Root: `server/`, build: `npm install`, start: `npm start`
      (Node 18+; `engines` declares `>=18`).
- [ ] Environment variables — BACKEND / SERVER-ONLY (host secret
      store; never in code, never in the frontend, never committed):
      REQUIRED in production (the server refuses to boot without them):
      `MONGODB_URI`, `JWT_SECRET` (long random ≥32 chars, unique per
      environment). STRONGLY RECOMMENDED: `CLIENT_URL` (exact frontend
      origin — CORS is fail-closed without it), `PORT` (or
      host-provided), `NODE_ENV=production`, `JWT_EXPIRES_IN=7d`.
      OPTIONAL: `COOKIE_SAMESITE` (only for cross-domain setups, see §4),
      email (`EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `SMTP_HOST`,
      `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`) if sending mail,
      rate-limit tuning (`AUTH_RATE_LIMIT_MAX`, `PAYMENT_RATE_LIMIT_MAX`),
      Cloudinary (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
      `CLOUDINARY_API_SECRET`) only if server-side image uploads are
      needed (the CMS works without them).
- [ ] Keep `ALLOW_ADMIN_BOOTSTRAP` unset unless you are actively creating
      the first admin, then remove it again.
- [ ] Verify `GET https://<api>/api/health` → 200 and
      `GET https://<api>/api/health/ready` → 200 (`ready: true`).
- [ ] Graceful shutdown is built in (SIGINT/SIGTERM close HTTP + MongoDB).

## 3. Frontend Deployment (Vercel / Netlify / Static Host)

- [ ] Root: `client/`, build: `npm install && npm run build`, publish `dist/`.
- [ ] Set FRONTEND variable `VITE_API_URL=https://<api-domain>/api`
      in the host's env (rebuild on change — Vite inlines it at build
      time). This is the ONLY browser variable.
- [ ] Never add `VITE_` secrets (they ship to every visitor): no
      `MONGODB_URI`, no `JWT_SECRET`, no Cloudinary secret, no database
      credentials, no server-only variables — the frontend build is
      scanned for these before every release.
- [ ] `client/vercel.json` is committed and maps all routes to
      `index.html`, so deep links (`/product/:slug`, `/account`, …)
      work on Vercel out of the box. No other platform file is needed.

## 4. CORS

- [ ] Backend `CLIENT_URL` is exactly the frontend origin
      (`https://<your-frontend-domain>`, no trailing slash, no `*`).
- [ ] Unknown origins get 403 with no `Access-Control-Allow-Origin` echo;
      requests without `Origin` (native apps, curl) still work with auth.
- [ ] Cookies require HTTPS in production (`Secure` flag is automatic when
      `NODE_ENV=production`); test login/logout/session restore.
- [ ] Cross-domain deployments (app and API on different sites): set
      `COOKIE_SAMESITE=none` on the backend so browsers send the session
      cookie on API fetches (`Secure` is then forced on; HTTPS required).
      Same-site deployments keep the default `lax`.

## 5. Demo Online Payment — No Credentials Required

- [ ] Nothing to provision: checkout offers Cash on Delivery plus a
      clearly-labelled simulated Online Payment (Demo). No gateway
      account, no API keys, no webhook.
- [ ] `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` /
      `RAZORPAY_WEBHOOK_SECRET` are OPTIONAL legacy test-mode settings
      only — leave them unset in production. The demo flow and all
      automated tests run without them.
- [ ] Never add a real payment gateway without a full security review;
      never expose any payment secret to the frontend; never log one.

## 6. Razorpay Webhook (Legacy Test-Mode Only — Optional)

- [ ] Only relevant if you intentionally exercise the legacy Razorpay
      TEST MODE flow in development. Leave unconfigured in production.
- [ ] Dashboard → Webhooks → add `POST https://<api>/api/payments/razorpay/webhook`.
- [ ] Subscribe to `payment.captured` and `payment.failed`.
- [ ] The endpoint verifies HMAC-SHA256 over the **raw** body — keep any
      reverse proxy from altering the payload (no body rewriting).
- [ ] Send a test event; expect `200 { success: true }`. Replays are safe
      (idempotent attempts + atomic claims).

## 7. SMTP

- [ ] Use a transactional provider (or your own SMTP) with auth credentials
      stored as backend secrets only.
- [ ] `EMAIL_FROM` should be a deliverable sender identity for your domain
      (add SPF/DKIM per your provider's docs).
- [ ] With email unconfigured the store still runs (notifications are
      recorded; sending is skipped) — verify by ordering with the vars
      removed in a staging slot.

## 8. Health Checks

- [ ] Liveness: `GET /api/health` → 200.
- [ ] Readiness: `GET /api/health/ready` → 200 when MongoDB is connected,
      503 otherwise. Point load-balancer readiness here.
- [ ] Neither endpoint exposes URIs, credentials or internals.

## 9. HTTPS

- [ ] Terminate TLS at the host / CDN (both frontend and API origins).
- [ ] Mixed-content check: the frontend must call the API over HTTPS only.
- [ ] `app.set('trust proxy', 1)` is already configured for single-proxy
      hosts so secure cookies and client IPs behave behind the proxy.

## 10. Domain Configuration

- [ ] Frontend domain → static host; API domain/subdomain → backend host.
- [ ] DNS + certificates verified on both; `CLIENT_URL` and `VITE_API_URL`
      updated to match; login flow re-tested end to end.

## 11. Git Security

- [ ] `.env`, `.env.*` (except `.env.example`) are ignored — confirm with
      `git check-ignore server/.env client/.env` after `git init`.
- [ ] `.env.example` files contain placeholders only.
- [ ] If a real credential was ever committed: rotate it immediately
      (DB password, JWT secret, Razorpay keys, SMTP password), purge it
      from history, and treat the old value as compromised.
- [ ] First admin is created via `node src/scripts/makeAdmin.js <email>`
      (needs DB access + `ALLOW_ADMIN_BOOTSTRAP=true` in production) —
      there is no HTTP privilege-escalation endpoint by design.

## 12. Post-Deploy Smoke Test

Walk the whole store as a customer, then as an admin. Stop on the
first failure.

CUSTOMER
- [ ] Homepage renders (hero, new arrivals, collections).
- [ ] Product listing + filters; product details page loads.
- [ ] Search returns relevant products.
- [ ] Register a new account, log out, log back in (session restores).
- [ ] Add to bag → cart shows line, quantity edits stick, refresh keeps it.
- [ ] Wishlist add/remove persists across login.
- [ ] Guest checkout attempt redirects to login, then returns to checkout.
- [ ] Place a COD order → confirmation page (reload does NOT duplicate).
- [ ] Place a Demo Online Payment order → "Pay (Demo)" → paid order.
- [ ] Order confirmation shows correct totals, payment method/status.
- [ ] My Orders lists both orders with live statuses; order detail opens.
- [ ] Notifications: ORDER_PLACED (+ demo success) arrived, unread badge
      shows, mark-read works, order link opens the order.

ADMIN (separate admin account via `makeAdmin.js`)
- [ ] Admin login → dashboard renders live numbers.
- [ ] Admin products: create/edit/unpublish a product (storefront reflects).
- [ ] Admin orders: find the customer orders, walk
      Confirmed → Processing → Shipped → Delivered.
- [ ] Customer sees each status update + notification in real time.
- [ ] CMS content edit + media upload appear publicly; reset works.
- [ ] Reviews: approve/reject flows; coupons: create/validate at checkout.

PLATFORM
- [ ] API health: `GET /api/health` → 200; readiness → 200 (`ready: true`).
- [ ] Unknown-origin CORS request is rejected; bad login is rate-limited
      (429 JSON) after sustained abuse, normal use unaffected.
- [ ] Error responses contain no stacks, paths or secrets
      (`NODE_ENV=production`).
- [ ] No `.env` or secret was committed (`git status` clean of secrets).

## 13. How to Run Locally (Development)

- [ ] Backend: copy `server/.env.example` to `server/.env` (local only,
      never committed). `MONGODB_URI` may point at a local MongoDB or
      Atlas test cluster; `JWT_SECRET` any long random string.
- [ ] Seed the catalog once: `cd server && npm run seed:products`.
- [ ] Start the API: `cd server && npm run dev` (http://localhost:5000).
- [ ] Frontend: `cd client && npm run dev` (http://localhost:5173,
      `VITE_API_URL` defaults to the local API — no edit needed).
- [ ] First admin: register via the storefront, then
      `cd server && node src/scripts/makeAdmin.js <email>`.
- [ ] Full verification: `npm test -- --test-concurrency=1` (sequential —
      parallel runs hit the known test-runner DB contention),
      `npm run build`, `npm run lint`.
