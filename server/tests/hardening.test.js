/* CLOTHZA Step 21 tests — production hardening + deployment readiness.
   Runs against an isolated in-memory MongoDB; no external services.
   Verifies security headers, strict CORS, rate limits, safe error
   shapes, health/readiness and webhook integrity after hardening.
   Auth/payment limiter caps are lowered via env BEFORE createApp() so
   the 429 path is exercised without hammering; nothing else in this
   file needs auth endpoints afterwards. */

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.JWT_SECRET = 'test-jwt-secret-for-hardening-suite'
process.env.JWT_EXPIRES_IN = '7d'
process.env.RAZORPAY_KEY_ID = 'test_key'
process.env.RAZORPAY_KEY_SECRET = 'test_secret'
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret'
process.env.AUTH_RATE_LIMIT_MAX = '10'

const { createApp } = await import('../src/app.js')
const User = (await import('../src/models/User.js')).default
const { errorHandler } = await import('../src/middleware/errorHandler.js')
const { cookieOptions, clearAuthCookie } = await import('../src/utils/auth.js')

let mongod
let app

function mockRes() {
  const res = { statusCode: null, body: null }
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (payload) => {
    res.body = payload
    return res
  }
  return res
}

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri('clothza-hardening-test')
  process.env.MONGODB_URI = uri
  await mongoose.connect(uri)
  app = createApp()
})

after(async () => {
  await mongoose.disconnect().catch(() => {})
  await mongod?.stop()
})

describe('security headers', () => {
  it('helmet sets safe headers and hides x-powered-by', async () => {
    const res = await request(app).get('/api/health')
    assert.equal(res.status, 200)
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
    assert.ok(res.headers['x-frame-options'], 'frameguard header present')
    assert.ok(res.headers['content-security-policy'], 'CSP present')
    assert.ok(!('x-powered-by' in res.headers), 'x-powered-by must be hidden')
  })
})

describe('CORS hardening', () => {
  it('allowed dev origin succeeds with credentials header', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173')
    assert.equal(res.status, 200)
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173')
  })

  it('unknown origin is rejected (no wildcard, no ACAO header)', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example')
    assert.equal(res.status, 403)
    assert.ok(!res.headers['access-control-allow-origin'], 'must not echo untrusted origins')
    assert.equal(res.body.success, false)
  })

  it('requests without Origin (native/curl/supertest) still work', async () => {
    const res = await request(app).get('/api/health')
    assert.equal(res.status, 200)
    assert.equal(res.body.success, true)
  })
})

describe('health and readiness', () => {
  it('GET /api/health reports running state without secrets', async () => {
    const res = await request(app).get('/api/health')
    assert.equal(res.status, 200)
    assert.equal(res.body.success, true)
    assert.equal(res.body.database, 'connected')
    const blob = JSON.stringify(res.body).toLowerCase()
    for (const needle of ['mongodb', 'password', 'secret', 'token', 'jwt']) {
      assert.ok(!blob.includes(needle), `health leaked "${needle}"`)
    }
  })

  it('GET /api/health/ready returns 200 when the database is connected', async () => {
    const res = await request(app).get('/api/health/ready')
    assert.equal(res.status, 200)
    assert.equal(res.body.ready, true)
  })
})

describe('safe error shapes', () => {
  it('unknown routes return consistent JSON 404', async () => {
    const res = await request(app).get('/api/does-not-exist')
    assert.equal(res.status, 404)
    assert.equal(res.body.success, false)
    assert.ok(typeof res.body.message === 'string')
  })

  it('oversized JSON body returns 413 JSON (never HTML)', async () => {
    const big = `{"name":"${'x'.repeat(2 * 1024 * 1024)}"}`
    const res = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send(big)
    assert.equal(res.status, 413)
    assert.equal(res.body.success, false)
  })

  it('malformed JSON returns 400 JSON', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"name": oops}')
    assert.equal(res.status, 400)
    assert.equal(res.body.success, false)
  })

  it('central handler maps CastError/11000 safely and hides production 500 details', async () => {
    const castErr = new mongoose.Error.CastError('ObjectId', 'nope', '_id')
    const r1 = mockRes()
    errorHandler(castErr, {}, r1, () => {})
    assert.equal(r1.statusCode, 400)
    assert.equal(r1.body.success, false)

    const dup = new Error('E11000 duplicate key error collection: x')
    dup.code = 11000
    const r2 = mockRes()
    errorHandler(dup, {}, r2, () => {})
    assert.equal(r2.statusCode, 409)
    assert.ok(!JSON.stringify(r2.body).includes('E11000'))

    const saved = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const boom = new Error('secret db exploded at /srv/x.js')
      boom.stack = 'Error: secret db exploded\n    at /srv/x.js:1:1'
      const r3 = mockRes()
      errorHandler(boom, {}, r3, () => {})
      assert.equal(r3.statusCode, 500)
      assert.equal(r3.body.message, 'Internal server error')
      assert.ok(!('stack' in r3.body))
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = saved
    }
  })
})

describe('session cookie production behavior', () => {
  it('defaults to lax without secure outside production', () => {
    const opts = cookieOptions()
    assert.equal(opts.httpOnly, true)
    assert.equal(opts.sameSite, 'lax')
    assert.equal(opts.secure, false)
    assert.equal(opts.path, '/')
  })

  it('COOKIE_SAMESITE=none forces secure (cross-domain deployments)', () => {
    process.env.COOKIE_SAMESITE = 'none'
    try {
      const opts = cookieOptions()
      assert.equal(opts.sameSite, 'none')
      assert.equal(opts.secure, true)
    } finally {
      delete process.env.COOKIE_SAMESITE
    }
  })

  it('bogus COOKIE_SAMESITE falls back to lax', () => {
    process.env.COOKIE_SAMESITE = 'sometimes'
    try {
      assert.equal(cookieOptions().sameSite, 'lax')
    } finally {
      delete process.env.COOKIE_SAMESITE
    }
  })

  it('clearAuthCookie mirrors the live cookie flags so logout clears reliably', () => {
    const seen = {}
    clearAuthCookie({ clearCookie: (name, opts) => Object.assign(seen, { name, opts }) })
    const live = cookieOptions()
    assert.equal(seen.name, 'clothza_token')
    assert.equal(seen.opts.sameSite, live.sameSite)
    assert.equal(seen.opts.secure, live.secure)
    assert.equal(seen.opts.path, live.path)
    assert.equal(seen.opts.httpOnly, true)
  })

  it('login sets an http-only session cookie', async () => {
    const agent = request.agent(app)
    await agent.post('/api/auth/register').send({ name: 'Cookie User', email: 'cookie-user@example.com', password: 'password123' })
    const res = await agent.post('/api/auth/login').send({ email: 'cookie-user@example.com', password: 'password123' })
    assert.equal(res.status, 200)
    const setCookie = res.headers['set-cookie']?.join(';') || ''
    assert.match(setCookie, /clothza_token=[^;]+;.*httponly/i)
  })
})

describe('webhook integrity after hardening', () => {
  it('signed webhook for unknown order still 200s (raw body + HMAC intact)', async () => {
    const payload = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: 'order_unknown999', id: 'pay_x' } } },
    })
    const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(payload).digest('hex')
    const res = await request(app)
      .post('/api/payments/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sig)
      .send(payload)
    assert.equal(res.status, 200)
    assert.equal(res.body.success, true)
  })

  it('payment limiter emits standard headers without throttling legit use', async () => {
    const res = await request(app)
      .post('/api/payments/razorpay/order')
      .send({ deliveryMethod: 'standard', paymentMethod: 'card' })
    assert.equal(res.status, 401) // no session — limiter runs first, auth still enforced
    assert.ok(res.headers['ratelimit-limit'], 'RateLimit-Limit header present')
  })
})

describe('rate limiting on auth endpoints', () => {
  it('non-admin user fixture for 403 checks (1 auth hit)', async () => {
    const agent = request.agent(app)
    const reg = await agent
      .post('/api/auth/register')
      .send({ name: 'Rate User', email: 'rate-user@example.com', password: 'password123' })
    assert.equal(reg.status, 201)
    assert.equal((await agent.get('/api/admin/dashboard')).status, 403)
  })

  it('exceeding AUTH_RATE_LIMIT_MAX returns JSON 429 (last test using auth routes)', async () => {
    const anon = request(app)
    let lastStatus = null
    let lastBody = null
    // Login has its own limiter instance (max 10): 10 logins allowed, 11th is 429.
    for (let i = 0; i < 11; i += 1) {
      const res = await anon
        .post('/api/auth/login')
        .send({ email: 'rate-user@example.com', password: 'wrong-password' })
      lastStatus = res.status
      lastBody = res.body
    }
    assert.equal(lastStatus, 429)
    assert.equal(lastBody.success, false)
    assert.ok(typeof lastBody.message === 'string')
  })
})

/* Must run last: disconnects the database to prove the 503 path. */
describe('readiness when the database is down', () => {
  it('GET /api/health/ready returns 503 with safe body', async () => {
    await mongoose.disconnect()
    const res = await request(app).get('/api/health/ready')
    assert.equal(res.status, 503)
    assert.equal(res.body.ready, false)
    assert.ok(!JSON.stringify(res.body).toLowerCase().includes('mongodb+srv'))
    // Reconnect so after() teardown stays clean.
    await mongoose.connect(process.env.MONGODB_URI)
    const back = await request(app).get('/api/health/ready')
    assert.equal(back.status, 200)
  })
})

describe('admin user sanity (post-rate-limit, no auth endpoints)', () => {
  it('user lookup still works directly', async () => {
    const user = await User.findOne({ email: 'rate-user@example.com' }).lean()
    assert.ok(user)
    assert.ok(!('passwordHash' in user) || typeof user.passwordHash === 'string')
  })
})
