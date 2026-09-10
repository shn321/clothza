# CLOTHZA — Deployment Checklist

Practical, no-deploy-performed checklist for taking CLOTHZA to production.
Nothing here deploys anything by itself — work through each section when
you provision hosting.

## 0. Pre-Flight (Local)

- [ ] `cd server && npm install && npm test` — full suite green.
- [ ] `cd client && npm install && npm run build && npm run lint` — clean.
- [ ] `git status` shows no `.env` files (they are git-ignored; only
      `.env.example` files are tracked).
- [ ] No real secrets in tracked files (search for `mongodb+srv://`,
      `rzp_`, `sk_live`, `AKIA`, literal passwords). Rotate anything that
      was ever committed.

## 1. MongoDB Atlas

- [ ] Create a project/cluster (M0+), database user with a strong generated
      password, and network access limited to your backend host (or
      `0.0.0.0/0` only if your host has no static IP).
- [ ] Connection string looks like
      `mongodb+srv://<user>:<password>@<cluster>/?retryWrites=true&w=majority`.
- [ ] Store it as the backend `MONGODB_URI` secret — never in code, never
      in the frontend, never in logs (the app redacts URIs automatically).

## 2. Backend Deployment (Render / Railway / VPS)

- [ ] Root: `server/`, build: `npm install`, start: `npm start`
      (Node 18+; `engines` declares `>=18`).
- [ ] Environment variables (all in the host's secret store):
      `PORT` (or host-provided), `NODE_ENV=production`, `MONGODB_URI`,
      `CLIENT_URL=https://<your-frontend-domain>`, `JWT_SECRET` (long
      random, unique per environment), `JWT_EXPIRES_IN=7d`,
      `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` /
      `RAZORPAY_WEBHOOK_SECRET`, email (`EMAIL_PROVIDER=smtp`,
      `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
      `SMTP_PASSWORD`) if sending mail.
- [ ] Keep `ALLOW_ADMIN_BOOTSTRAP` unset unless you are actively creating
      the first admin, then remove it again.
- [ ] Verify `GET https://<api>/api/health` → 200 and
      `GET https://<api>/api/health/ready` → 200 (`ready: true`).
- [ ] Graceful shutdown is built in (SIGINT/SIGTERM close HTTP + MongoDB).

## 3. Frontend Deployment (Vercel / Netlify / Static Host)

- [ ] Root: `client/`, build: `npm install && npm run build`, publish `dist/`.
- [ ] Set `VITE_API_URL=https://<api-domain>/api` in the host's env
      (rebuild on change — Vite inlines it at build time).
- [ ] `VITE_API_URL` is the ONLY browser variable; never add `VITE_`
      secrets (they ship to every visitor).

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

## 5. Razorpay Production Credentials

- [ ] Switch the Razorpay dashboard to **Live** mode and generate live keys
      (TEST MODE keys must never process real money).
- [ ] Set live `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and a live webhook
      secret on the backend only.
- [ ] Never expose any of these to the frontend; never log them.

## 6. Razorpay Webhook

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

- [ ] Health + readiness return 200.
- [ ] Register → login → browse → cart → COD order → cancel flow works.
- [ ] Admin login → dashboard/analytics render with live numbers.
- [ ] Unknown-origin CORS request is rejected; bad login is rate-limited
      (429 JSON) after sustained abuse, normal use unaffected.
- [ ] Error responses contain no stacks, paths or secrets
      (`NODE_ENV=production`).
