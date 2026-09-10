# CLOTHZA backend

Foundation only: Express API + Mongoose wiring. No auth, no payments, no order APIs yet.

## Setup

```bash
cp .env.example .env   # then fill in your own MONGODB_URI (never commit .env)
npm install
```

## Run

```bash
npm start      # production-style start
npm run dev    # watch mode (Node --watch)
```

Health check: `GET http://localhost:5000/api/health`

```json
{ "success": true, "message": "CLOTHZA API is running" }
```

Without `MONGODB_URI` the API still boots (health check works) and logs a warning while waiting for the real database URI.

## Admin dashboard (Step 16)

The admin UI lives at `http://localhost:5173/admin` and all data comes
from `/api/admin/*`, which requires a session cookie **and** `role: "admin"`
(`requireAuth` + `requireAdmin`, enforced server-side).

### Creating the first admin (local, development only)

There is **no HTTP endpoint** that grants admin rights. Promote an
already-registered account with the CLI script (database access via
`MONGODB_URI` is itself the authorization):

```bash
# 1. Register the account in the storefront (/register), then:
npm run make:admin -- admin@example.com
# or: ADMIN_EMAIL=admin@example.com npm run make:admin
```

The script refuses to run in production unless
`ALLOW_ADMIN_BOOTSTRAP=true` is set. See `.env.example`.

### Tests

```bash
npm test   # isolated in-memory MongoDB, no external services
```
