/* CLOTHZA Step 32 — final security + production-readiness regression.
   Locks in the audit invariants in one place: no role escalation,
   hashed passwords, session forgery/expiry rejection, ownership-only
   access (no userId trust), admin boundaries, unpublished invisibility,
   malformed-ID safety, NoSQL-injection resistance, security headers,
   body limits and rate-limit presence.
   Runs against an isolated in-memory MongoDB; no external services. */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.JWT_SECRET = 'test-jwt-secret-for-step32-suite'
process.env.JWT_EXPIRES_IN = '7d'

const { createApp } = await import('../src/app.js')
const User = (await import('../src/models/User.js')).default
const Product = (await import('../src/models/Product.js')).default

let mongod
let app
let seq = 0

function nextEmail(prefix) {
  seq += 1
  return `${prefix}-${seq}@example.com`
}

async function registerAgent(email, name = 'Step32 User', extra = {}) {
  const agent = request.agent(app)
  const res = await agent
    .post('/api/auth/register')
    .send({ name, email, password: 'password123', ...extra })
  assert.equal(res.status, 201, `register failed for ${email}: ${res.text}`)
  return agent
}

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri('clothza-step32-test')
  process.env.MONGODB_URI = uri
  await mongoose.connect(uri)
  app = createApp()
  await Product.create({
    slug: 's32-kurta',
    name: 'Step32 Kurta',
    description: 'Step-32 security test product.',
    price: 1000,
    category: 'kurtas',
    gender: 'men',
    images: [],
    colors: [],
    sizes: [],
    stock: 10,
    tags: [],
  })
})

after(async () => {
  await mongoose.disconnect().catch(() => {})
  await mongod?.stop()
})

describe('authentication hardening', () => {
  it('register ignores role escalation; passwords are hashed, never plaintext', async () => {
    const email = nextEmail('s32-nodescalate')
    const agent = await registerAgent(email, 'Escalator', { role: 'admin' })
    assert.equal((await agent.get('/api/admin/dashboard')).status, 403)
    const stored = await User.findOne({ email }).select('+passwordHash').lean()
    assert.ok(stored)
    assert.equal(stored.role, 'user')
    assert.notEqual(stored.passwordHash, 'password123')
    assert.equal(await bcrypt.compare('password123', stored.passwordHash), true)
  })

  it('auth responses never leak passwordHash', async () => {
    const email = nextEmail('s32-noleak')
    const agent = await registerAgent(email)
    const me = await agent.get('/api/auth/me')
    assert.equal(me.status, 200)
    assert.doesNotMatch(JSON.stringify(me.body), /passwordHash/i)
  })

  it('forged, wrong-secret, expired and unknown-user sessions → 401', async () => {
    const email = nextEmail('s32-session')
    await registerAgent(email)
    const me = await User.findOne({ email }).lean()
    const anon = request(app)
    const probes = [
      'garbage-token',
      jwt.sign({ sub: String(me._id) }, 'wrong-secret', { expiresIn: '7d' }),
      jwt.sign({ sub: String(me._id) }, process.env.JWT_SECRET, { expiresIn: '-10s' }),
      jwt.sign({ sub: String(new mongoose.Types.ObjectId()) }, process.env.JWT_SECRET, { expiresIn: '7d' }),
    ]
    for (const token of probes) {
      const res = await anon.get('/api/auth/me').set('Cookie', `clothza_token=${token}`)
      assert.equal(res.status, 401, `expected 401 for probe: ${String(token).slice(0, 24)}`)
    }
  })

  it('NoSQL injection via object email cannot bypass login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: { $gt: '' }, password: { $gt: '' } })
    assert.ok([400, 401].includes(res.status))
    assert.equal(res.body.success, false)
    const cookies = (res.headers['set-cookie'] || []).join(';')
    assert.doesNotMatch(cookies, /clothza_token=/i)
  })
})

describe('ownership is always session-derived (IDOR)', () => {
  it('forged userId in body/query cannot touch another user’s resources', async () => {
    const victimEmail = nextEmail('s32-victim')
    const victim = await registerAgent(victimEmail, 'Victim')
    await victim.post('/api/cart/items').send({ productId: 's32-kurta', qty: 1 })
    const victimDoc = await User.findOne({ email: victimEmail }).lean()

    const attacker = await registerAgent(nextEmail('s32-attacker'), 'Attacker')
    // Attacker's own cart is empty — victim's lines are invisible.
    assert.equal((await attacker.get('/api/cart')).body.data.count, 0)
    // Forged userId fields are ignored, never trusted.
    const forged = await attacker.post('/api/cart/items').send({
      productId: 's32-kurta', qty: 1, userId: String(victimDoc._id), user: String(victimDoc._id),
    })
    assert.equal(forged.status, 200)
    assert.equal((await attacker.get('/api/cart')).body.data.count, 1)
    assert.equal((await victim.get('/api/cart')).body.data.count, 1)
    // Wishlist isolation holds the same way.
    await victim.post('/api/wishlist/items/s32-kurta')
    assert.equal((await attacker.get('/api/wishlist')).body.data.count, 0)
  })
})

describe('admin boundary across every mutation area', () => {
  it('anonymous → 401, customer → 403 on admin writes + analytics', async () => {
    const customer = await registerAgent(nextEmail('s32-cust'))
    const anon = request(app)
    const probes = [
      ['post', '/api/admin/products', { name: 'X', slug: 'x-1', price: 1, category: 'c' }],
      ['post', '/api/admin/coupons', { code: 'X' }],
      ['put', '/api/admin/content/homepage.hero', { content: {} }],
      ['post', '/api/admin/media', { url: 'https://example.com/x.jpg' }],
      ['get', '/api/admin/analytics/overview', null],
      ['get', '/api/admin/dashboard', null],
    ]
    for (const [method, path, body] of probes) {
      let r = anon[method](path)
      if (body) r = r.send(body)
      assert.equal((await r).status, 401, `anon ${method} ${path}`)
      let r2 = customer[method](path)
      if (body) r2 = r2.send(body)
      const status = (await r2).status
      assert.ok([400, 403].includes(status), `customer ${method} ${path} → ${status}`)
    }
  })
})

describe('input + product visibility safety', () => {
  it('malformed ids are safe 404s, never 500s', async () => {
    const agent = await registerAgent(nextEmail('s32-ids'))
    assert.equal((await agent.get('/api/orders/not-a-real-order!!')).status, 404)
    assert.equal((await agent.patch('/api/notifications/xyz/read')).status, 404)
    assert.equal((await request(app).get('/api/products/../../../../etc/passwd')).status, 404)
  })

  it('unpublished products stay invisible publicly but visible to admins', async () => {
    const adminEmail = nextEmail('s32-prodadmin')
    const admin = await registerAgent(adminEmail, 'Prod Admin')
    await User.updateOne({ email: adminEmail }, { $set: { role: 'admin' } })
    const created = await admin.post('/api/admin/products').send({
      name: 'Hidden Gem', slug: 's32-hidden-gem', price: 500, category: 'kurtas', stock: 3,
    })
    assert.equal(created.status, 201)
    await admin.patch('/api/admin/products/s32-hidden-gem').send({ isPublished: false })
    assert.equal((await request(app).get('/api/products/s32-hidden-gem')).status, 404)
    const list = await request(app).get('/api/products?limit=100')
    assert.ok(!list.body.data.some((p) => p.slug === 's32-hidden-gem'))
    assert.equal((await admin.get('/api/admin/products/s32-hidden-gem')).status, 200)
  })

  it('query-operator pollution does not crash or bypass filters', async () => {
    const res = await request(app).get('/api/products?gender[$gt]=&limit=5')
    assert.ok([200, 400].includes(res.status))
    assert.equal(res.body.success, res.status === 200)
  })
})

describe('transport hardening', () => {
  it('helmet headers present, x-powered-by hidden', async () => {
    const res = await request(app).get('/api/health')
    assert.equal(res.status, 200)
    assert.ok(!('x-powered-by' in res.headers))
    assert.ok(res.headers['content-security-policy'])
  })

  it('oversized JSON → 413 JSON (never HTML)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(`{"email":"${'a'.repeat(2 * 1024 * 1024)}"}`)
    assert.equal(res.status, 413)
    assert.equal(res.body.success, false)
  })

  it('auth limiter present without blocking legitimate use', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: nextEmail('s32-ratelimit'), password: 'wrong' })
    assert.ok([401, 429].includes(res.status))
    assert.ok(res.headers['ratelimit-limit'])
  })
})
