/* CLOTHZA cross-site production auth tests — Vercel frontend + Render
   API live on different sites, so the session cookie must default to
   SameSite=None with Secure in production (explicit COOKIE_SAMESITE
   still wins), CORS must echo the exact CLIENT_URL origin with
   credentials, and a login Set-Cookie must round-trip through
   GET /api/auth/me. Runs against an isolated in-memory MongoDB. */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  CLIENT_URL: process.env.CLIENT_URL,
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  MONGODB_URI: process.env.MONGODB_URI,
}

process.env.NODE_ENV = 'production'
process.env.CLIENT_URL = 'https://clothza-client.vercel.app'
delete process.env.COOKIE_SAMESITE
process.env.JWT_SECRET = 'test-jwt-secret-for-cross-site-suite-0123456789'
process.env.JWT_EXPIRES_IN = '7d'

const { createApp } = await import('../src/app.js')
const { cookieOptions } = await import('../src/utils/auth.js')
const { checkProductionConfig } = await import('../src/utils/prodConfig.js')

let mongod
let app

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri('clothza-cross-site-test')
  process.env.MONGODB_URI = uri
  await mongoose.connect(uri)
  app = createApp()
})

after(async () => {
  await mongoose.disconnect().catch(() => {})
  await mongod?.stop()
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('cross-site session cookie defaults (production)', () => {
  it('defaults to SameSite=None with Secure + HttpOnly when CLIENT_URL is set', () => {
    delete process.env.COOKIE_SAMESITE
    const opts = cookieOptions()
    assert.equal(opts.sameSite, 'none')
    assert.equal(opts.secure, true)
    assert.equal(opts.httpOnly, true)
    assert.equal(opts.path, '/')
  })

  it('an explicit COOKIE_SAMESITE is always honored', () => {
    process.env.COOKIE_SAMESITE = 'lax'
    try {
      assert.equal(cookieOptions().sameSite, 'lax')
    } finally {
      delete process.env.COOKIE_SAMESITE
    }
  })

  it('stays lax in production when CLIENT_URL is not set (fail-closed CORS anyway)', () => {
    const clientUrl = process.env.CLIENT_URL
    delete process.env.CLIENT_URL
    delete process.env.COOKIE_SAMESITE
    try {
      const opts = cookieOptions()
      assert.equal(opts.sameSite, 'lax')
      assert.equal(opts.secure, true) // production is still Secure
    } finally {
      process.env.CLIENT_URL = clientUrl
    }
  })
})

describe('production config cross-site warnings', () => {
  it('explicit lax/strict with CLIENT_URL warns about the session cookie', () => {
    const base = {
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://x',
      JWT_SECRET: 's'.repeat(40),
      CLIENT_URL: 'https://clothza-client.vercel.app',
    }
    assert.ok(
      checkProductionConfig({ ...base, COOKIE_SAMESITE: 'lax' }).warnings.some((m) =>
        m.includes('COOKIE_SAMESITE'),
      ),
    )
    // Unset is clean — the server default already covers cross-site.
    assert.ok(
      !checkProductionConfig(base).warnings.some((m) => m.includes('COOKIE_SAMESITE')),
    )
  })
})

describe('live cross-site session round-trip', () => {
  it('login Set-Cookie carries SameSite=None; Secure; HttpOnly; Path=/', async () => {
    const agent = request.agent(app)
    const reg = await agent
      .post('/api/auth/register')
      .send({ name: 'Cross Site', email: 'cross-site@example.com', password: 'password123' })
    assert.equal(reg.status, 201, reg.text)
    const setCookie = (reg.headers['set-cookie'] || []).join(';')
    assert.match(setCookie, /clothza_token=[^;]+/i)
    assert.match(setCookie, /samesite=none/i)
    assert.match(setCookie, /secure/i)
    assert.match(setCookie, /httponly/i)
  })

  it('session cookie round-trips through GET /api/auth/me', async () => {
    // NOTE: the login cookie is Secure, so an http test jar (supertest
    // agent) correctly withholds it — forward it explicitly instead to
    // prove the token itself authenticates the session endpoint.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cross-site@example.com', password: 'password123' })
    assert.equal(login.status, 200)
    const raw = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ')
    assert.match(raw, /clothza_token=[^;]+/i)
    const me = await request(app).get('/api/auth/me').set('Cookie', raw)
    assert.equal(me.status, 200)
    assert.equal(me.body.data.user.email, 'cross-site@example.com')
  })

  it('CORS echoes the exact production origin with credentials; rejects unknown origins', async () => {
    const allowed = await request(app)
      .get('/api/health')
      .set('Origin', 'https://clothza-client.vercel.app')
    assert.equal(allowed.status, 200)
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://clothza-client.vercel.app')
    assert.equal(allowed.headers['access-control-allow-credentials'], 'true')

    const denied = await request(app).get('/api/health').set('Origin', 'https://evil.example')
    assert.equal(denied.status, 403)
    assert.ok(!denied.headers['access-control-allow-origin'])
  })
})
