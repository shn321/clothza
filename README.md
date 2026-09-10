# CLOTHZA — Full-Stack E-Commerce Platform

A modern, minimalist fashion e-commerce platform built as a production-quality
full-stack portfolio project: React storefront, Node.js/Express API, MongoDB,
JWT-cookie authentication, Razorpay TEST MODE payments, admin dashboard with
business-intelligence analytics, reviews, coupons, and transactional
notifications/email.

## Project Overview

CLOTHZA is a complete online fashion store. Shoppers browse the catalog,
manage a bag and wishlist, check out as guests (demo) or signed-in customers,
pay Cash on Delivery or online via Razorpay, apply coupon codes, review
delivered purchases, and receive order notifications. Store admins manage
products, orders, reviews, coupons and customers, and monitor the business
through an analytics dashboard.

## Key Features

- **Storefront** — home, shop with search/filter/sort, men/women/collections,
  product detail pages with verified-purchase reviews and ratings.
- **Cart & wishlist** — guest (localStorage) plus database-backed carts and
  wishlists for signed-in users, with guest→account merging on login.
- **Checkout & orders** — server-computed totals from live MongoDB prices;
  frontend amounts are never trusted. COD plus Razorpay TEST MODE (cards/UPI).
- **Payments** — HMAC-signed verification, idempotent attempts, raw-body
  webhook handling, guarded stock decrements (no oversell on races).
- **Reviews** — verified-purchase only, moderation queue, live rating
  aggregation.
- **Coupons** — percentage/fixed codes with windows, usage caps, per-user
  limits, category/product/gender targeting, atomic usage accounting.
- **Notifications & email** — owner-scoped notification center plus
  transactional SMTP email with safe degradation when unconfigured.
- **Admin** — dashboard, analytics (revenue, sales, products, categories,
  customers, coupons), orders, products, reviews, coupons, customers.

## Technology Stack

| Layer    | Technology                                                              |
| -------- | ----------------------------------------------------------------------- |
| Frontend | React 19, React Router 7, Vite 8, Tailwind CSS 4, lucide-react          |
| Backend  | Node.js 18+, Express 4, Mongoose 8, Helmet, express-rate-limit          |
| Database | MongoDB (Atlas in production, memory server in tests)                   |
| Auth     | bcryptjs password hashing, JWT in HTTP-only cookies                     |
| Payments | Razorpay TEST MODE (key/secret + webhook secret, server-side only)      |
| Email    | Nodemailer SMTP with provider abstraction (`smtp` / `test` / disabled)  |
| Tests    | `node --test` + Supertest + mongodb-memory-server (fully offline)       |

## Architecture

```text
client/ (Vite + React SPA)
  src/lib/api.js            # single API layer, env-based base URL
  src/context/*             # auth, cart, wishlist, products, notifications
  src/pages/*               # storefront, checkout, account, admin

server/ (Express API)
  src/app.js                # helmet, CORS allowlist, rate limits, routes
  src/server.js             # startup, graceful SIGINT/SIGTERM shutdown
  src/routes/*              # auth, products, cart, wishlist, orders,
                            # payments, reviews, coupons, notifications, admin
  src/controllers/*         # request handling (server is source of truth)
  src/services/*            # razorpay, coupons, notifications, email, analytics
  src/models/*              # User, Product, Cart, Wishlist, Order,
                            # PaymentAttempt, Review, Coupon, Notification
  src/middleware/*          # auth (JWT cookie), error handler, security
  src/config/db.js          # redacted logging, connection state
  tests/*.test.js           # full offline suite (node --test)
```

### Backend

- `GET /api/health` and `GET /api/health/ready` (DB-aware, secret-free).
- JSON body limit 1 MB; strict CORS allowlist (never `*` with credentials);
  Razorpay webhook keeps its raw body for HMAC verification.
- Rate limits on login/register and payment order/verify (JSON 429s);
  browsing, cart and analytics are never throttled.
- Central error handler: safe JSON shapes, no stacks/secrets in production,
  CastError→400, duplicate-key→409, oversized body→413.

### MongoDB

Schemas preserve historical accuracy (order item snapshots, coupon
snapshots). Existing indexes serve listings, lookups and analytics
aggregations. Connection errors are redacted and never crash startup;
shutdown closes the connection gracefully.

### Authentication

- bcrypt (cost 12) password hashes, `select: false`, never returned.
- Short-lived JWT in an HTTP-only cookie (`Secure` + `SameSite=Lax` in
  production); no tokens in bodies, storage or logs.
- `requireAuth` + `requireAdmin` gates; ownership enforced per document.
- First admin via `server/src/scripts/makeAdmin.js` (DB access required;
  production additionally requires `ALLOW_ADMIN_BOOTSTRAP=true`).

### Payment Integration (Razorpay TEST MODE)

- Gateway order creation, HMAC signature verification and webhook
  verification are all server-side; the frontend can never mark an order
  paid. Card/UPI/CVV data never touches our servers or logs.
- `PaymentAttempt` records make verify/webhook races, replays and
  double-submits converge on a single paid order.

### Admin Dashboard & Analytics

- Live overview (revenue from paid non-cancelled orders only) plus
  date-filtered sales, order-status, top-product (snapshot prices),
  category, customer and coupon analytics — all MongoDB aggregations.
- Admin UI renders dependency-free SVG/CSS charts in the CLOTHZA style.

### Notifications / Email

- Owner-scoped notification center (`/account/notifications`) with unread
  badges, read/delete/clear, and order deep-links.
- Order/payment lifecycle events create notifications and attempt
  transactional email; failures never roll back orders. Without SMTP
  configuration the app runs normally with email safely skipped.

### Coupons

- Server-validated codes (windows, minimums, caps, global/per-user limits,
  product/category/gender targeting) with atomic usage claims and
  compensation on failed orders.

### Reviews

- One review per user/product/purchase, `pending` by default, admin
  moderation, product ratings recomputed from approved reviews only.

## Testing

```bash
npm test            # from repo root — runs the server suite (workspaces)
# or:
cd server
npm install
npm test        # node --test "tests/*.test.js" — isolated in-memory MongoDB
```

The suite covers auth, products, cart, wishlist, checkout, COD, Razorpay
TEST MODE paths, orders, cancellation, reviews, coupons, notifications,
email, admin, analytics and production hardening — fully offline.

## Environment Setup

Copy the examples and fill in your own values (never commit `.env`):

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Server (`server/.env`): `PORT`, `MONGODB_URI`, `CLIENT_URL`, `JWT_SECRET`,
`JWT_EXPIRES_IN`, optional `COOKIE_SAMESITE=none` (cross-domain front/back
ends only), `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`, optional `EMAIL_PROVIDER`/`EMAIL_FROM`/
`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`, optional
`AUTH_RATE_LIMIT_MAX` / `PAYMENT_RATE_LIMIT_MAX`.

Client (`client/.env`): `VITE_API_URL` only — the only browser-safe variable.
No server secrets may use the `VITE_` prefix.

## Local Development

Root shortcuts (npm workspaces) — or run each command inside `client/` / `server/`:

```bash
npm run dev:server   # Express API with watch mode (http://localhost:5000)
npm run dev:client   # Vite storefront (http://localhost:5173)
npm run build        # production frontend bundle (client/dist/)
npm run lint         # frontend lint
npm start            # production API server
```

```bash
# Backend
cd server
npm install
npm run dev        # or: npm start

# Frontend (new terminal, from repo root)
cd client
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle
```

Seed the catalog with `npm run seed:products` (from `server/`), then
register, and promote yourself with `node src/scripts/makeAdmin.js <email>`.

## Production Deployment

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full checklist:
frontend/backend hosting, MongoDB Atlas, environment variables, CORS,
Razorpay production credentials and webhooks, SMTP, health checks, HTTPS,
domains and Git secret safety.

## Security Notes

- Secrets live in environment variables only; `.env` is git-ignored and
  `.env.example` files contain placeholders.
- Helmet headers, strict CORS allowlist, rate-limited auth/payments,
  hardened cookies, sanitized logs and production-safe error responses.
- Every data-changing endpoint re-validates ownership, prices and totals
  on the server; the client is never trusted with money math.
