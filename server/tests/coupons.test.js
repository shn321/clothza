/* CLOTHZA Step 18 tests — coupons & promotions + full regression.
   Runs against an isolated in-memory MongoDB; no external services.
   Razorpay paths are exercised with placeholder test secrets so no
   network is ever touched (unconfigured/bad-signature paths only). */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.JWT_SECRET = 'test-jwt-secret-for-coupon-suite'
process.env.JWT_EXPIRES_IN = '7d'
process.env.RAZORPAY_KEY_ID = 'test_key'
process.env.RAZORPAY_KEY_SECRET = 'test_secret'
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret'

const { createApp } = await import('../src/app.js')
const User = (await import('../src/models/User.js')).default
const Product = (await import('../src/models/Product.js')).default
const Order = (await import('../src/models/Order.js')).default
const Coupon = (await import('../src/models/Coupon.js')).default
const Review = (await import('../src/models/Review.js')).default

let mongod
let app
let seq = 0

const CUSTOMER = {
  firstName: 'Asha',
  lastName: 'Sharma',
  email: 'asha.sharma@example.com',
  phone: '+919876543210',
}
const SHIPPING = {
  address: '14 MG Road',
  apartment: '',
  city: 'Bengaluru',
  state: 'Karnataka',
  pin: '560001',
  country: 'India',
}

const DAY = 24 * 60 * 60 * 1000
const isoYesterday = () => new Date(Date.now() - DAY).toISOString()
const isoTomorrow = () => new Date(Date.now() + DAY).toISOString()

function nextId(prefix) {
  seq += 1
  return `${prefix}-${seq}`
}

function productDoc(overrides = {}) {
  const slug = nextId('coupon-kurta')
  return {
    slug,
    name: `Coupon Kurta ${seq}`,
    description: 'A kurta for coupon tests.',
    price: 1000,
    category: 'kurtas',
    subcategory: 'casual',
    gender: 'men',
    images: ['https://example.com/kurta.jpg'],
    colors: ['ivory'],
    sizes: ['M', 'L'],
    stock: 50,
    tags: ['kurta'],
    ...overrides,
  }
}

function couponPayload(code, overrides = {}) {
  return {
    code,
    description: 'Test coupon',
    discountType: 'percentage',
    discountValue: 10,
    minimumOrderValue: 0,
    maximumDiscount: 0,
    startDate: isoYesterday(),
    expiryDate: isoTomorrow(),
    usageLimit: 0,
    perUserLimit: 5,
    isActive: true,
    ...overrides,
  }
}

async function registerAgent(email, name = 'Test User') {
  const agent = request.agent(app)
  const res = await agent
    .post('/api/auth/register')
    .send({ name, email, password: 'password123' })
  assert.equal(res.status, 201, `register failed for ${email}: ${res.text}`)
  return agent
}

async function makeAdmin(email) {
  const agent = await registerAgent(email, 'Admin User')
  await User.updateOne({ email }, { $set: { role: 'admin' } })
  return agent
}

/* Unique admin per coupon-creating test to keep sessions isolated. */
async function adminWithCoupon(code, overrides = {}) {
  const admin = await makeAdmin(`${nextId('couponadmin')}@example.com`)
  const res = await admin.post('/api/admin/coupons').send(couponPayload(code, overrides))
  assert.equal(res.status, 201, `coupon create failed for ${code}: ${res.text}`)
  return { admin, coupon: res.body.data.coupon }
}

/* Shopper with a real product in a real database cart. */
async function shopperWithProduct(email, productOverrides = {}, qty = 2) {
  const agent = await registerAgent(email)
  const product = await Product.create(productDoc(productOverrides))
  const add = await agent.post('/api/cart/items').send({ productId: product.slug, size: 'M', qty })
  assert.equal(add.status, 200, `add to cart failed: ${add.text}`)
  return { agent, product }
}

async function placeCodOrder(agent, email, extra = {}) {
  return agent.post('/api/orders').send({
    customer: { ...CUSTOMER, email },
    shipping: SHIPPING,
    deliveryMethod: 'standard',
    paymentMethod: 'cod',
    ...extra,
  })
}

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri('clothza-coupon-test')
  process.env.MONGODB_URI = uri
  await mongoose.connect(uri)
  app = createApp()
})

after(async () => {
  await mongoose.disconnect().catch(() => {})
  await mongod?.stop()
})

describe('coupon validation API', () => {
  it('unauthenticated validation → 401', async () => {
    const res = await request(app).post('/api/coupons/validate').send({ code: 'WELCOME10' })
    assert.equal(res.status, 401)
    assert.equal(res.body.success, false)
  })

  it('missing code → 400', async () => {
    const agent = await registerAgent('coupon-nocode@example.com')
    const res = await agent.post('/api/coupons/validate').send({})
    assert.equal(res.status, 400)
  })

  it('valid percentage coupon: 10% of ₹2000 → ₹200', async () => {
    const code = nextId('PCT').toUpperCase()
    await adminWithCoupon(code, { discountValue: 10 })
    const { agent } = await shopperWithProduct('coupon-pct@example.com', { price: 1000 }, 2)
    const res = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.coupon.code, code)
    assert.equal(res.body.data.coupon.discountType, 'percentage')
    assert.equal(res.body.data.subtotal, 2000)
    assert.equal(res.body.data.eligibleSubtotal, 2000)
    assert.equal(res.body.data.discountAmount, 200)
    assert.equal(res.body.data.subtotalAfterDiscount, 1800)
  })

  it('valid fixed coupon: ₹500 off ₹2000 → ₹500', async () => {
    const code = nextId('FIX').toUpperCase()
    await adminWithCoupon(code, { discountType: 'fixed', discountValue: 500 })
    const { agent } = await shopperWithProduct('coupon-fix@example.com', { price: 1000 }, 2)
    const res = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.discountAmount, 500)
    assert.equal(res.body.data.subtotalAfterDiscount, 1500)
  })

  it('fixed discount is capped at the eligible subtotal', async () => {
    const code = nextId('BIGFIX').toUpperCase()
    await adminWithCoupon(code, { discountType: 'fixed', discountValue: 99999 })
    const { agent } = await shopperWithProduct('coupon-bigfix@example.com', { price: 400 }, 1)
    const res = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.discountAmount, 400)
  })

  it('unknown code → 404', async () => {
    const { agent } = await shopperWithProduct('coupon-unknown@example.com')
    const res = await agent.post('/api/coupons/validate').send({ code: 'NO-SUCH-CODEX' })
    assert.equal(res.status, 404)
    assert.equal(res.body.success, false)
  })

  it('inactive coupon → 400', async () => {
    const code = nextId('INACT').toUpperCase()
    await adminWithCoupon(code, { isActive: false })
    const { agent } = await shopperWithProduct('coupon-inact@example.com')
    const res = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(res.status, 400)
    assert.match(res.body.message, /no longer active/i)
  })

  it('expired coupon → 400', async () => {
    const code = nextId('EXP').toUpperCase()
    await adminWithCoupon(code, {
      startDate: new Date(Date.now() - 3 * DAY).toISOString(),
      expiryDate: new Date(Date.now() - DAY).toISOString(),
    })
    const { agent } = await shopperWithProduct('coupon-exp@example.com')
    const res = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(res.status, 400)
    assert.match(res.body.message, /expired/i)
  })

  it('future (not-yet-active) coupon → 400', async () => {
    const code = nextId('FUT').toUpperCase()
    await adminWithCoupon(code, {
      startDate: new Date(Date.now() + DAY).toISOString(),
      expiryDate: new Date(Date.now() + 3 * DAY).toISOString(),
    })
    const { agent } = await shopperWithProduct('coupon-fut@example.com')
    const res = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(res.status, 400)
    assert.match(res.body.message, /not active yet/i)
  })

  it('minimum order value enforced → 400', async () => {
    const code = nextId('MIN').toUpperCase()
    await adminWithCoupon(code, { minimumOrderValue: 5000 })
    const { agent } = await shopperWithProduct('coupon-min@example.com', { price: 1000 }, 2)
    const res = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(res.status, 400)
    assert.match(res.body.message, /minimum order/i)
  })

  it('percentage capped by maximumDiscount', async () => {
    const code = nextId('CAP').toUpperCase()
    await adminWithCoupon(code, { discountValue: 50, maximumDiscount: 100 })
    const { agent } = await shopperWithProduct('coupon-cap@example.com', { price: 1000 }, 2)
    const res = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.discountAmount, 100)
  })

  it('product restriction: matching line gets discount, others → not applicable', async () => {
    const code = nextId('PROD').toUpperCase()
    const target = await Product.create(productDoc({ price: 1000 }))
    const other = await Product.create(productDoc({ price: 1000 }))
    await adminWithCoupon(code, { discountValue: 20, applicableProducts: [String(target._id)] })

    const agent = await registerAgent('coupon-prod@example.com')
    await agent.post('/api/cart/items').send({ productId: target.slug, size: 'M', qty: 1 })
    const ok = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.data.eligibleSubtotal, 1000)
    assert.equal(ok.body.data.discountAmount, 200)

    const agent2 = await registerAgent('coupon-prod2@example.com')
    await agent2.post('/api/cart/items').send({ productId: other.slug, size: 'M', qty: 1 })
    const no = await agent2.post('/api/coupons/validate').send({ code })
    assert.equal(no.status, 400)
    assert.match(no.body.message, /not applicable/i)
  })

  it('category restriction enforced', async () => {
    const code = nextId('CAT').toUpperCase()
    await adminWithCoupon(code, { discountValue: 10, applicableCategories: ['sarees'] })
    const { agent } = await shopperWithProduct('coupon-cat@example.com', { category: 'kurtas' }, 1)
    const res = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(res.status, 400)
    assert.match(res.body.message, /not applicable/i)

    const agent2 = await registerAgent('coupon-cat2@example.com')
    const saree = await Product.create(productDoc({ category: 'sarees', price: 2000 }))
    await agent2.post('/api/cart/items').send({ productId: saree.slug, size: 'M', qty: 1 })
    const ok = await agent2.post('/api/coupons/validate').send({ code })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.data.discountAmount, 200)
  })

  it('gender restriction enforced', async () => {
    const code = nextId('GEN').toUpperCase()
    await adminWithCoupon(code, { discountValue: 10, applicableGender: ['women'] })
    const { agent } = await shopperWithProduct('coupon-gen@example.com', { gender: 'men' }, 1)
    const res = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(res.status, 400)
    assert.match(res.body.message, /not applicable/i)

    const agent2 = await registerAgent('coupon-gen2@example.com')
    const dress = await Product.create(productDoc({ gender: 'women', price: 1500 }))
    await agent2.post('/api/cart/items').send({ productId: dress.slug, size: 'M', qty: 1 })
    const ok = await agent2.post('/api/coupons/validate').send({ code })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.data.discountAmount, 150)
  })

  it('lowercase code normalizes to uppercase', async () => {
    const code = nextId('lower').toUpperCase()
    await adminWithCoupon(code.toLowerCase(), { discountValue: 10 })
    const stored = await Coupon.findOne({ code }).lean()
    assert.ok(stored, 'code should be stored uppercase')
    const { agent } = await shopperWithProduct('coupon-case@example.com', { price: 1000 }, 1)
    const res = await agent.post('/api/coupons/validate').send({ code: code.toLowerCase() })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.coupon.code, code)
  })

  it('validation never consumes usage', async () => {
    const code = nextId('NOUSE').toUpperCase()
    await adminWithCoupon(code, { discountValue: 10 })
    const { agent } = await shopperWithProduct('coupon-nouse@example.com', { price: 1000 }, 1)
    await agent.post('/api/coupons/validate').send({ code })
    await agent.post('/api/coupons/validate').send({ code })
    const stored = await Coupon.findOne({ code }).lean()
    assert.equal(stored.usageCount, 0)
    assert.deepEqual(stored.usedBy, [])
  })
})

describe('coupon usage limits', () => {
  it('global usageLimit: second shopper rejected after first order', async () => {
    const code = nextId('GLB').toUpperCase()
    await adminWithCoupon(code, { discountValue: 10, usageLimit: 1, perUserLimit: 5 })

    const first = await shopperWithProduct('coupon-glb1@example.com', { price: 1000 }, 1)
    const order = await placeCodOrder(first.agent, 'coupon-glb1@example.com', { couponCode: code })
    assert.equal(order.status, 201, order.text)

    const second = await shopperWithProduct('coupon-glb2@example.com', { price: 1000 }, 1)
    const res = await second.agent.post('/api/coupons/validate').send({ code })
    assert.equal(res.status, 400)
    assert.match(res.body.message, /usage limit/i)
    const stored = await Coupon.findOne({ code }).lean()
    assert.equal(stored.usageCount, 1)
  })

  it('perUserLimit: same shopper rejected on second use', async () => {
    const code = nextId('PERU').toUpperCase()
    await adminWithCoupon(code, { discountValue: 10, perUserLimit: 1 })

    const email = 'coupon-peru@example.com'
    const first = await shopperWithProduct(email, { price: 1000 }, 1)
    const order = await placeCodOrder(first.agent, email, { couponCode: code })
    assert.equal(order.status, 201, order.text)

    await first.agent.post('/api/cart/items').send({ productId: first.product.slug, size: 'M', qty: 1 })
    const res = await first.agent.post('/api/coupons/validate').send({ code })
    assert.equal(res.status, 400)
    assert.match(res.body.message, /maximum number of times/i)
    const order2 = await placeCodOrder(first.agent, email, { couponCode: code })
    assert.equal(order2.status, 400)
    const stored = await Coupon.findOne({ code }).lean()
    assert.equal(stored.usageCount, 1)
  })
})

describe('order integration (server-side source of truth)', () => {
  it('COD order applies coupon snapshot + server-computed totals', async () => {
    const code = nextId('ORD').toUpperCase()
    await adminWithCoupon(code, { discountValue: 10 })
    const { agent } = await shopperWithProduct('coupon-ord@example.com', { price: 1000 }, 2)
    const res = await placeCodOrder(agent, 'coupon-ord@example.com', { couponCode: code })
    assert.equal(res.status, 201, res.text)
    const order = res.body.data.order
    assert.equal(order.subtotal, 2000)
    assert.equal(order.discount, 200)
    assert.equal(order.total, 1800)
    assert.equal(order.coupon.code, code)
    assert.equal(order.coupon.discountType, 'percentage')
    assert.equal(order.coupon.discountValue, 10)
    assert.equal(order.coupon.discountAmount, 200)
    const stored = await Coupon.findOne({ code }).lean()
    assert.equal(stored.usageCount, 1)
  })

  it('forged frontend discount/total ignored — server recalculates', async () => {
    const code = nextId('FORGE').toUpperCase()
    await adminWithCoupon(code, { discountValue: 10 })
    const { agent } = await shopperWithProduct('coupon-forge@example.com', { price: 1000 }, 2)
    const res = await agent.post('/api/orders').send({
      customer: { ...CUSTOMER, email: 'coupon-forge@example.com' },
      shipping: SHIPPING,
      deliveryMethod: 'standard',
      paymentMethod: 'cod',
      couponCode: code,
      subtotal: 1,
      discount: 1999,
      total: 1,
    })
    assert.equal(res.status, 201, res.text)
    assert.equal(res.body.data.order.subtotal, 2000)
    assert.equal(res.body.data.order.discount, 200)
    assert.equal(res.body.data.order.total, 1800)
  })

  it('discount field without a coupon code is ignored (discount 0)', async () => {
    const { agent } = await shopperWithProduct('coupon-nocode2@example.com', { price: 1000 }, 1)
    const res = await agent.post('/api/orders').send({
      customer: { ...CUSTOMER, email: 'coupon-nocode2@example.com' },
      shipping: SHIPPING,
      deliveryMethod: 'standard',
      paymentMethod: 'cod',
      discount: 500,
      total: 500,
    })
    assert.equal(res.status, 201, res.text)
    assert.equal(res.body.data.order.discount, 0)
    assert.equal(res.body.data.order.total, 1000)
    assert.ok(!('coupon' in res.body.data.order))
  })

  it('order without couponCode after validation = coupon removed (full total)', async () => {
    const code = nextId('RMV').toUpperCase()
    await adminWithCoupon(code, { discountValue: 25 })
    const { agent } = await shopperWithProduct('coupon-rmv@example.com', { price: 1000 }, 2)
    const v = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(v.status, 200)
    assert.equal(v.body.data.discountAmount, 500)
    const res = await placeCodOrder(agent, 'coupon-rmv@example.com')
    assert.equal(res.status, 201, res.text)
    assert.equal(res.body.data.order.discount, 0)
    assert.equal(res.body.data.order.total, 2000)
    const stored = await Coupon.findOne({ code }).lean()
    assert.equal(stored.usageCount, 0)
  })

  it('failed order does not consume coupon usage', async () => {
    const code = nextId('FAIL').toUpperCase()
    await adminWithCoupon(code, { discountValue: 10 })
    const { agent } = await shopperWithProduct('coupon-fail@example.com', { price: 1000 }, 1)
    const res = await agent.post('/api/orders').send({
      customer: { ...CUSTOMER, email: 'coupon-fail@example.com' },
      shipping: { ...SHIPPING, address: '' },
      deliveryMethod: 'standard',
      paymentMethod: 'cod',
      couponCode: code,
    })
    assert.equal(res.status, 400)
    const stored = await Coupon.findOne({ code }).lean()
    assert.equal(stored.usageCount, 0)
    assert.deepEqual(stored.usedBy, [])
  })

  it('expired coupon rejected at order time even if previously valid', async () => {
    const code = nextId('ORDX').toUpperCase()
    const { admin } = await adminWithCoupon(code, { discountValue: 10 })
    const { agent } = await shopperWithProduct('coupon-ordx@example.com', { price: 1000 }, 1)
    const v = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(v.status, 200)
    const couponId = v.body.data.coupon.code
    assert.equal(couponId, code)
    await Coupon.updateOne({ code }, { $set: { expiryDate: new Date(Date.now() - 1000) } })
    assert.ok(admin)
    const res = await placeCodOrder(agent, 'coupon-ordx@example.com', { couponCode: code })
    assert.equal(res.status, 400)
    assert.match(res.body.message, /expired/i)
  })
})

describe('admin coupon management', () => {
  it('anonymous → 401 on all coupon admin endpoints', async () => {
    const anon = request(app)
    assert.equal((await anon.get('/api/admin/coupons')).status, 401)
    assert.equal((await anon.post('/api/admin/coupons').send({})).status, 401)
    assert.equal((await anon.get(`/api/admin/coupons/${new mongoose.Types.ObjectId()}`)).status, 401)
    assert.equal((await anon.patch(`/api/admin/coupons/${new mongoose.Types.ObjectId()}`).send({})).status, 401)
    assert.equal((await anon.delete(`/api/admin/coupons/${new mongoose.Types.ObjectId()}`)).status, 401)
  })

  it('normal user → 403 on all coupon admin endpoints', async () => {
    const user = await registerAgent('coupon-user403@example.com')
    const id = new mongoose.Types.ObjectId()
    assert.equal((await user.get('/api/admin/coupons')).status, 403)
    assert.equal((await user.post('/api/admin/coupons').send({})).status, 403)
    assert.equal((await user.get(`/api/admin/coupons/${id}`)).status, 403)
    assert.equal((await user.patch(`/api/admin/coupons/${id}`).send({})).status, 403)
    assert.equal((await user.delete(`/api/admin/coupons/${id}`)).status, 403)
  })

  it('admin CRUD: create → get → edit → deactivate → delete', async () => {
    const admin = await makeAdmin('coupon-crud-admin@example.com')
    const code = nextId('CRUD').toUpperCase()
    const created = await admin.post('/api/admin/coupons').send(couponPayload(code, { discountValue: 15 }))
    assert.equal(created.status, 201)
    const id = created.body.data.coupon.id
    assert.ok(id)

    const got = await admin.get(`/api/admin/coupons/${id}`)
    assert.equal(got.status, 200)
    assert.equal(got.body.data.coupon.code, code)
    assert.equal(got.body.data.coupon.usageCount, 0)

    const edited = await admin.patch(`/api/admin/coupons/${id}`).send({ description: 'Updated', discountValue: 20 })
    assert.equal(edited.status, 200)
    assert.equal(edited.body.data.coupon.description, 'Updated')
    assert.equal(edited.body.data.coupon.discountValue, 20)

    const deactivated = await admin.patch(`/api/admin/coupons/${id}`).send({ isActive: false })
    assert.equal(deactivated.status, 200)
    assert.equal(deactivated.body.data.coupon.isActive, false)

    const deleted = await admin.delete(`/api/admin/coupons/${id}`)
    assert.equal(deleted.status, 200)
    assert.equal((await admin.get(`/api/admin/coupons/${id}`)).status, 404)
  })

  it('duplicate code → 409', async () => {
    const admin = await makeAdmin('coupon-dup-admin@example.com')
    const code = nextId('DUP').toUpperCase()
    assert.equal((await admin.post('/api/admin/coupons').send(couponPayload(code))).status, 201)
    const dup = await admin.post('/api/admin/coupons').send(couponPayload(code.toLowerCase()))
    assert.equal(dup.status, 409)
  })

  it('invalid fields rejected: bad percentage, negative, bad dates, bad product, bad per-user', async () => {
    const admin = await makeAdmin('coupon-bad-admin@example.com')
    const badCases = [
      couponPayload(nextId('B1').toUpperCase(), { discountValue: 150 }),
      couponPayload(nextId('B2').toUpperCase(), { discountValue: 0 }),
      couponPayload(nextId('B3').toUpperCase(), { discountType: 'fixed', discountValue: -50 }),
      couponPayload(nextId('B4').toUpperCase(), { minimumOrderValue: -10 }),
      couponPayload(nextId('B5').toUpperCase(), { maximumDiscount: -5 }),
      couponPayload(nextId('B6').toUpperCase(), {
        startDate: isoTomorrow(),
        expiryDate: isoYesterday(),
      }),
      couponPayload(nextId('B7').toUpperCase(), { applicableProducts: ['not-an-object-id'] }),
      couponPayload(nextId('B8').toUpperCase(), {
        applicableProducts: [String(new mongoose.Types.ObjectId())],
      }),
      couponPayload(nextId('B9').toUpperCase(), { perUserLimit: 0 }),
      couponPayload(nextId('B10').toUpperCase(), { usageLimit: -1 }),
      couponPayload(nextId('B11').toUpperCase(), { discountType: 'bogus', discountValue: 10 }),
      couponPayload(nextId('B12').toUpperCase(), { applicableGender: ['kids'] }),
    ]
    for (const payload of badCases) {
      const res = await admin.post('/api/admin/coupons').send(payload)
      assert.equal(res.status, 400, `expected 400 for ${payload.code}: ${res.text}`)
    }
  })

  it('server-owned fields cannot be written (usageCount/usedBy rejected on PATCH)', async () => {
    const admin = await makeAdmin('coupon-guard-admin@example.com')
    const code = nextId('GRD').toUpperCase()
    const created = await admin.post('/api/admin/coupons').send({
      ...couponPayload(code),
      usageCount: 999,
      usedBy: [],
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.coupon.usageCount, 0)
    const id = created.body.data.coupon.id
    assert.equal((await admin.patch(`/api/admin/coupons/${id}`).send({ usageCount: 5 })).status, 400)
    assert.equal((await admin.patch(`/api/admin/coupons/${id}`).send({ usedBy: [] })).status, 400)
  })

  it('list: search q, active filter, expired filter', async () => {
    const admin = await makeAdmin('coupon-list-admin@example.com')
    const activeCode = nextId('LISTA').toUpperCase()
    const expiredCode = nextId('LISTX').toUpperCase()
    assert.equal((await admin.post('/api/admin/coupons').send(couponPayload(activeCode))).status, 201)
    assert.equal(
      (
        await admin.post('/api/admin/coupons').send(
          couponPayload(expiredCode, {
            startDate: new Date(Date.now() - 3 * DAY).toISOString(),
            expiryDate: new Date(Date.now() - DAY).toISOString(),
          }),
        )
      ).status,
      201,
    )

    const search = await admin.get(`/api/admin/coupons?q=${activeCode.slice(0, 8)}`)
    assert.equal(search.status, 200)
    assert.ok(search.body.data.coupons.some((c) => c.code === activeCode))

    const expiredOnly = await admin.get('/api/admin/coupons?expired=true')
    assert.equal(expiredOnly.status, 200)
    assert.ok(expiredOnly.body.data.coupons.some((c) => c.code === expiredCode))
    assert.ok(!expiredOnly.body.data.coupons.some((c) => c.code === activeCode))

    const inactive = await admin.get('/api/admin/coupons?active=false')
    assert.equal(inactive.status, 200)
    assert.ok(Array.isArray(inactive.body.data.coupons))
  })
})

describe('regressions (everything else untouched)', () => {
  it('auth regression: register → login → me', async () => {
    const agent = request.agent(app)
    const reg = await agent
      .post('/api/auth/register')
      .send({ name: 'Reg Test', email: 'coup-regtest@example.com', password: 'password123' })
    assert.equal(reg.status, 201)
    const login = await agent
      .post('/api/auth/login')
      .send({ email: 'coup-regtest@example.com', password: 'password123' })
    assert.equal(login.status, 200)
    const me = await agent.get('/api/auth/me')
    assert.equal(me.status, 200)
  })

  it('cart regression: add → get', async () => {
    const agent = await registerAgent('coup-cartreg@example.com', 'Cart Reg')
    await Product.create(productDoc({ slug: 'coup-cart-kurta', name: 'Coup Cart Kurta', stock: 20 }))
    const add = await agent.post('/api/cart/items').send({ productId: 'coup-cart-kurta', size: 'M', qty: 1 })
    assert.equal(add.status, 200)
    const get = await agent.get('/api/cart')
    assert.equal(get.status, 200)
    assert.ok(get.body.data.items.length >= 1)
  })

  it('wishlist regression: add → get', async () => {
    const agent = await registerAgent('coup-wishreg@example.com', 'Wish Reg')
    await Product.create(productDoc({ slug: 'coup-wish-kurta', name: 'Coup Wish Kurta' }))
    const add = await agent.post('/api/wishlist/items/coup-wish-kurta')
    assert.equal(add.status, 200)
    const get = await agent.get('/api/wishlist')
    assert.equal(get.status, 200)
    assert.ok(get.body.data.ids.includes('coup-wish-kurta'))
  })

  it('COD regression: plain order without coupon', async () => {
    const agent = await registerAgent('coup-codreg@example.com', 'COD Reg')
    await Product.create(productDoc({ slug: 'coup-cod-kurta', name: 'Coup COD Kurta', price: 1499, stock: 10 }))
    await agent.post('/api/cart/items').send({ productId: 'coup-cod-kurta', size: 'M', qty: 1 })
    const created = await placeCodOrder(agent, 'coup-codreg@example.com')
    assert.equal(created.status, 201, created.text)
    assert.equal(created.body.data.order.discount, 0)
    assert.equal(created.body.data.order.total, 1499)
    const num = created.body.data.order.orderNumber
    assert.equal((await agent.get('/api/orders')).status, 200)
    assert.equal((await agent.get(`/api/orders/${num}`)).status, 200)
  })

  it('razorpay regression: coupon checked before gateway; 503/401/400 preserved', async () => {
    const code = nextId('RZP').toUpperCase()
    await adminWithCoupon(code, { discountValue: 10 })
    const { agent } = await shopperWithProduct('coup-payreg@example.com', { price: 1200 }, 1)

    const savedKey = process.env.RAZORPAY_KEY_ID
    const savedSecret = process.env.RAZORPAY_KEY_SECRET
    delete process.env.RAZORPAY_KEY_ID
    delete process.env.RAZORPAY_KEY_SECRET

    // Invalid coupon fails with the coupon error even when gateway is down.
    const badCoupon = await agent.post('/api/payments/razorpay/order').send({
      deliveryMethod: 'standard',
      paymentMethod: 'card',
      couponCode: 'NO-SUCH-RZP',
    })
    assert.equal(badCoupon.status, 404)

    // Valid coupon + unconfigured gateway → 503 (no network, no usage consumed).
    const unconfigured = await agent.post('/api/payments/razorpay/order').send({
      deliveryMethod: 'standard',
      paymentMethod: 'card',
      couponCode: code,
    })
    assert.equal(unconfigured.status, 503)
    process.env.RAZORPAY_KEY_ID = savedKey
    process.env.RAZORPAY_KEY_SECRET = savedSecret
    const stored = await Coupon.findOne({ code }).lean()
    assert.equal(stored.usageCount, 0)

    const verify = await agent.post('/api/payments/razorpay/verify').send({
      razorpay_order_id: 'order_test123',
      razorpay_payment_id: 'pay_test123',
      razorpay_signature: 'wrong-signature',
      customer: { ...CUSTOMER, email: 'coup-payreg@example.com' },
      shipping: SHIPPING,
    })
    assert.equal(verify.status, 401)

    const webhook = await request(app)
      .post('/api/payments/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'invalid')
      .send(JSON.stringify({ event: 'payment.captured' }))
    assert.equal(webhook.status, 400)
  })

  it('review regression: verified-purchase review still works', async () => {
    const product = await Product.create(
      productDoc({ slug: 'coup-review-kurta', name: 'Coup Review Kurta' }),
    )
    const agent = await registerAgent('coup-buyer1@example.com', 'Buyer One')
    const user = await User.findOne({ email: 'coup-buyer1@example.com' })
    seq += 1
    const order = await Order.create({
      user: user._id,
      orderNumber: `CLZ-CP-${String(seq).padStart(4, '0')}`,
      items: [{
        product: product._id, productId: product.slug, slug: product.slug,
        name: product.name, image: '', price: product.price, size: 'M', colour: null, qty: 1,
      }],
      customer: { ...CUSTOMER, email: 'coup-buyer1@example.com' },
      shippingAddress: SHIPPING,
      deliveryMethod: { id: 'standard', label: 'Standard', charge: 0, eta: '' },
      subtotal: product.price, shippingCost: 0, tax: 0, discount: 0, total: product.price,
      paymentMethod: 'cod', paymentStatus: 'pending',
      orderStatus: 'delivered',
    })
    const res = await agent.post(`/api/products/${product.slug}/reviews`).send({
      rating: 5,
      title: 'Excellent kurta',
      comment: 'The fabric feels premium and the fit is exactly as described.',
      orderNumber: order.orderNumber,
    })
    assert.equal(res.status, 201, res.text)
    assert.equal(res.body.data.review.verifiedPurchase, true)
    assert.ok(await Review.findById(res.body.data.review.id).lean())
  })

  it('admin regression: dashboard + products + coupons list', async () => {
    const admin = await makeAdmin('coup-dash-admin@example.com')
    assert.equal((await admin.get('/api/admin/dashboard')).status, 200)
    assert.equal((await admin.get('/api/admin/products')).status, 200)
    const coupons = await admin.get('/api/admin/coupons')
    assert.equal(coupons.status, 200)
    assert.ok(Array.isArray(coupons.body.data.coupons))
  })
})
