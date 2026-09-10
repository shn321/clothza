import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

/* CLOTHZA production security middleware (Step 21) — lightweight,
   no infrastructure. Helmet for response headers, strict CORS without
   wildcards, and in-memory rate limits on sensitive endpoints only
   (auth + payments). Product browsing, cart, analytics and webhooks
   are never throttled. */

export function securityHeaders() {
  return helmet({
    /* API-only: no frontend is served from Express, so a strict CSP
       that blocks everything browser-rendered is safe and correct. */
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    /* Razorpay webhook posts raw JSON cross-site; COEP/COOP/CORP stay
       at helmet defaults except CORP, which is disabled so legitimate
       CORS fetches from the storefront are never blocked. */
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: process.env.NODE_ENV === 'production' ? undefined : false,
  })
}

function allowedOrigins() {
  const list = []
  const clientUrl = String(process.env.CLIENT_URL || '').trim().replace(/\/+$/, '')
  if (clientUrl) list.push(clientUrl)
  if (process.env.NODE_ENV !== 'production') {
    for (const dev of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      if (!list.includes(dev)) list.push(dev)
    }
  }
  return list
}

/* Strict origin check: exact allowlist match only. Requests WITHOUT an
   Origin header (supertest, curl, native mobile, server-to-server) have
   nothing to enforce at the browser level and are allowed through —
   authentication still applies. Never a wildcard with credentials. */
export function corsOptions() {
  const allow = allowedOrigins()
  return {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (allow.includes(origin)) return callback(null, true)
      const err = new Error('CORS origin not allowed')
      err.statusCode = 403
      return callback(err)
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    optionsSuccessStatus: 204,
    maxAge: 600,
  }
}

function limiterOptions({ windowMs, max, message }) {
  return {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    /* Consistent JSON error shape (never the default plain-text). */
    handler: (req, res) => {
      res.status(429).json({ success: false, message })
    },
  }
}

/* Auth endpoints: generous enough for real users and the automated
   suite (separate processes per file), strict enough to blunt
   credential stuffing. Overridable via env for tests. */
export function authLimiter() {
  const max = Number(process.env.AUTH_RATE_LIMIT_MAX) || 200
  return rateLimit(
    limiterOptions({
      windowMs: 15 * 60 * 1000,
      max,
      message: 'Too many authentication attempts. Please try again in a few minutes.',
    }),
  )
}

/* Payment creation/verification: brute-force and replay probing guard.
   The cryptographic verification itself is unchanged. */
export function paymentLimiter() {
  const max = Number(process.env.PAYMENT_RATE_LIMIT_MAX) || 200
  return rateLimit(
    limiterOptions({
      windowMs: 15 * 60 * 1000,
      max,
      message: 'Too many payment attempts. Please wait a few minutes and try again.',
    }),
  )
}
