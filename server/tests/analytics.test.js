/* CLOTHZA Step 20 tests — admin analytics + full regression.
   Runs against an isolated in-memory MongoDB; no external services.
   Analytics numbers are asserted against hand-computed fixtures seeded
   directly through the models (exact statuses, payments, dates). */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.JWT_SECRET = 'test-jwt-secret-for-analytics-suite'
process.env.JWT_EXPIRES_IN = '7d'
process.env.RAZORPAY_KEY_ID = 'test_key'
process.env.RAZORPAY_KEY_SECRET = 'test_secret'
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret'

const { createApp } = await import('../src/app.js')
const User = (await import('../src/models/User.js')).default
const Product = (await import('../src/models/Product.js')).default
const Order = (await import('../src/models/Order.js')).default

let mongod
let app
let admin
let seq = 0

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (n) => new Date(Date.now() - n * DAY_MS)
const utcKey = (d) => new Date(d).toISOString().slice(0, 10)

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

function orderNumber() {
  seq += 1
  return `CLZ-AN-${String(seq).padStart(4, '0')}`
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

/* Minimal valid order with full caller control over money/state/time. */
async function seedOrder({
  userId,
  items,
  total,
  paymentStatus = 'paid',
  orderStatus = 'delivered',
  createdAt = new Date(),
  coupon,
  discount = 0,
}) {
  const subtotal = items.reduce((n, l) => n + l.price * l.qty, 0)
  const doc = {
    user: userId,
    orderNumber: orderNumber(),
    items: items.map((l) => ({
      product: l.product,
      productId: l.slug,
      slug: l.slug,
      name: l.name,
      image: '',
      price: l.price,
      size: 'M',
      colour: null,
      qty: l.qty,
    })),
    customer: CUSTOMER,
    shippingAddress: SHIPPING,
    deliveryMethod: { id: 'standard', label: 'Standard', charge: 0, eta: '' },
    subtotal,
    shippingCost: 0,
    tax: 0,
    discount,
    total,
    paymentMethod: 'cod',
    paymentStatus,
    orderStatus,
    createdAt,
  }
  if (coupon) doc.coupon = coupon
  return Order.create(doc)
}

function line(product, qty, priceOverride) {
  return {
    product: product._id,
    slug: product.slug,
    name: product.name,
    price: priceOverride ?? product.price,
    qty,
  }
}

let u1
let u2
let pA
let pB

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri('clothza-analytics-test')
  process.env.MONGODB_URI = uri
  await mongoose.connect(uri)
  app = createApp()
  admin = await makeAdmin('analytics-admin@example.com')
})

after(async () => {
  await mongoose.disconnect().catch(() => {})
  await mongod?.stop()
})

/* Runs first, before any fixture exists (admin account only, which is
   role=admin and therefore invisible to customer metrics). */
describe('analytics on an empty database', () => {
  it('overview is all zeros', async () => {
    const res = await admin.get('/api/admin/analytics/overview?range=30d')
    assert.equal(res.status, 200)
    const { totals, period, ordersByStatus } = res.body.data
    assert.deepEqual(
      [totals.revenue, totals.orders, totals.customers, totals.products, totals.paidOrders, totals.unpaidOrders, totals.averageOrderValue],
      [0, 0, 0, 0, 0, 0, 0],
    )
    assert.deepEqual([period.revenue, period.orders, period.averageOrderValue], [0, 0, 0])
    assert.deepEqual(ordersByStatus, {
      pending: 0, confirmed: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0,
    })
  })

  it('sales zero-fills every day; products/categories/coupons empty; customers zero', async () => {
    const sales = await admin.get('/api/admin/analytics/sales?range=7d')
    assert.equal(sales.status, 200)
    assert.equal(sales.body.data.days.length, 7)
    for (const d of sales.body.data.days) {
      assert.deepEqual([d.orders, d.revenue], [0, 0])
    }
    const products = await admin.get('/api/admin/analytics/products')
    assert.deepEqual(products.body.data.items, [])
    const categories = await admin.get('/api/admin/analytics/categories')
    assert.deepEqual(categories.body.data.items, [])
    const coupons = await admin.get('/api/admin/analytics/coupons')
    assert.deepEqual([coupons.body.data.totalUses, coupons.body.data.totalDiscount], [0, 0])
    assert.deepEqual(coupons.body.data.top, [])
    const customers = await admin.get('/api/admin/analytics/customers')
    assert.deepEqual(
      [customers.body.data.totalCustomers, customers.body.data.newCustomers, customers.body.data.repeatCustomers],
      [0, 0, 0],
    )
  })
})

describe('analytics fixtures', () => {
  it('seed users, products and a hand-computed order set', async () => {
    await registerAgent('analytics-u1@example.com', 'Shopper One')
    await registerAgent('analytics-u2@example.com', 'Shopper Two')
    u1 = await User.findOne({ email: 'analytics-u1@example.com' })
    u2 = await User.findOne({ email: 'analytics-u2@example.com' })
    pA = await Product.create({
      slug: 'analytics-kurta-a', name: 'Analytics Kurta A', description: 'A.',
      price: 1000, category: 'kurtas', subcategory: 'casual', gender: 'men',
      sizes: ['M'], stock: 100,
    })
    pB = await Product.create({
      slug: 'analytics-saree-b', name: 'Analytics Saree B', description: 'B.',
      price: 2000, category: 'sarees', subcategory: 'silk', gender: 'women',
      sizes: ['M'], stock: 100,
    })

    // o1: paid + delivered, 2x pA, coupon SAVE10 (200 off), 5 days ago
    await seedOrder({
      userId: u1._id, items: [line(pA, 2)], total: 2000,
      paymentStatus: 'paid', orderStatus: 'delivered', createdAt: daysAgo(5),
      coupon: { code: 'SAVE10', discountType: 'percentage', discountValue: 10, discountAmount: 200 },
      discount: 200,
    })
    // o2: paid + shipped, 1x pB, 2 days ago
    await seedOrder({
      userId: u1._id, items: [line(pB, 1)], total: 2000,
      paymentStatus: 'paid', orderStatus: 'shipped', createdAt: daysAgo(2),
    })
    // o3: unpaid + pending, 1x pA, 1 day ago
    await seedOrder({
      userId: u2._id, items: [line(pA, 1)], total: 1000,
      paymentStatus: 'pending', orderStatus: 'pending', createdAt: daysAgo(1),
    })
    // o4: paid BUT cancelled — must never count as revenue
    await seedOrder({
      userId: u2._id, items: [line(pB, 1)], total: 2000,
      paymentStatus: 'paid', orderStatus: 'cancelled', createdAt: daysAgo(3),
      coupon: { code: 'SAVE10', discountType: 'percentage', discountValue: 10, discountAmount: 150 },
      discount: 150,
    })
    // o5: failed payment + pending, 1x pA, today
    await seedOrder({
      userId: u1._id, items: [line(pA, 1)], total: 1000,
      paymentStatus: 'failed', orderStatus: 'pending', createdAt: new Date(),
    })
    // o6: ancient paid + delivered order (100 days ago) — outside 30d/90d
    await seedOrder({
      userId: u1._id, items: [line(pB, 2)], total: 5000,
      paymentStatus: 'paid', orderStatus: 'delivered', createdAt: daysAgo(100),
    })
    // o7: paid + processing, 1x pB, coupon FLAT50 (100 off), 1 day ago
    await seedOrder({
      userId: u2._id, items: [line(pB, 1)], total: 1900,
      paymentStatus: 'paid', orderStatus: 'processing', createdAt: daysAgo(1),
      coupon: { code: 'FLAT50', discountType: 'fixed', discountValue: 100, discountAmount: 100 },
      discount: 100,
    })
    // Rewrite pA's live price AFTER purchase — snapshot math must not move.
    await Product.updateOne({ _id: pA._id }, { $set: { price: 9999 } })
    assert.equal(await Order.countDocuments(), 7)
  })
})

describe('analytics authorization', () => {
  const paths = [
    '/api/admin/analytics/overview',
    '/api/admin/analytics/sales',
    '/api/admin/analytics/products',
    '/api/admin/analytics/categories',
    '/api/admin/analytics/customers',
    '/api/admin/analytics/coupons',
  ]
  it('unauthenticated → 401 on every analytics endpoint', async () => {
    const anon = request(app)
    for (const p of paths) {
      const res = await anon.get(p)
      assert.equal(res.status, 401, p)
      assert.equal(res.body.success, false)
    }
  })

  it('authenticated non-admin → 403 on every analytics endpoint', async () => {
    const user = await registerAgent('analytics-user403@example.com')
    for (const p of paths) {
      const res = await user.get(p)
      assert.equal(res.status, 403, p)
    }
  })
})

describe('overview metrics', () => {
  it('lifetime totals: revenue counts paid non-cancelled only', async () => {
    const res = await admin.get('/api/admin/analytics/overview?range=all')
    assert.equal(res.status, 200)
    const { totals } = res.body.data
    // o1 2000 + o2 2000 + o6 5000 + o7 1900 = 10900; o4 cancelled excluded
    assert.equal(totals.revenue, 10900)
    assert.equal(totals.orders, 7)
    assert.equal(totals.customers, 3) // u1, u2, user403 (admin excluded)
    assert.equal(totals.products, 2)
    assert.equal(totals.paidOrders, 4)
    assert.equal(totals.unpaidOrders, 2) // o3 pending + o5 failed
    assert.equal(totals.averageOrderValue, 10900 / 4)
  })

  it('period scoping: 30d excludes the 100-day-old order', async () => {
    const res = await admin.get('/api/admin/analytics/overview?range=30d')
    assert.equal(res.status, 200)
    const { period } = res.body.data
    // o1 + o2 + o7 revenue; o3/o5 unpaid; o4 cancelled
    assert.equal(period.revenue, 5900)
    assert.equal(period.orders, 5) // o1, o2, o3, o5, o7
    assert.equal(period.averageOrderValue, 5900 / 5)
  })

  it('order status aggregation uses the ORDER_STATUS enum, no parallel system', async () => {
    const res = await admin.get('/api/admin/analytics/overview')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.data.ordersByStatus, {
      pending: 2, confirmed: 0, processing: 1, shipped: 1, delivered: 2, cancelled: 1,
    })
  })

  it('invalid range → 400; start-after-end → 400; oversized custom → 400', async () => {
    assert.equal((await admin.get('/api/admin/analytics/overview?range=forever')).status, 400)
    const badOrder = await admin.get(
      '/api/admin/analytics/overview?range=custom&start=2026-05-02&end=2026-05-01',
    )
    assert.equal(badOrder.status, 400)
    const badDates = await admin.get('/api/admin/analytics/overview?range=custom&start=nah&end=nah')
    assert.equal(badDates.status, 400)
    const tooBig = await admin.get(
      '/api/admin/analytics/overview?range=custom&start=2020-01-01&end=2026-01-01',
    )
    assert.equal(tooBig.status, 400)
  })
})

describe('sales analytics', () => {
  it('7d returns 7 UTC buckets with matching totals', async () => {
    const res = await admin.get('/api/admin/analytics/sales?range=7d')
    assert.equal(res.status, 200)
    assert.equal(res.body.data.range.timezone, 'UTC')
    const { days, totals } = res.body.data
    assert.equal(days.length, 7)
    const sumOrders = days.reduce((n, d) => n + d.orders, 0)
    const sumRevenue = days.reduce((n, d) => n + d.revenue, 0)
    assert.equal(totals.orders, sumOrders)
    assert.equal(totals.revenue, sumRevenue)
    // o1 (5d ago) + o2 (2d) + o3/o7 (1d) + o5 (today) = 5 orders in window
    assert.equal(sumOrders, 5)
    // paid in window: o1 2000 + o2 2000 + o7 1900
    assert.equal(sumRevenue, 5900)
    const bucket = days.find((d) => d.date === utcKey(daysAgo(2)))
    assert.ok(bucket && bucket.orders >= 1, 'o2 must land in its UTC bucket')
  })

  it('today returns a single bucket; all rejects sales (unbounded)', async () => {
    const today = await admin.get('/api/admin/analytics/sales?range=today')
    assert.equal(today.status, 200)
    assert.equal(today.body.data.days.length, 1)
    assert.equal((await admin.get('/api/admin/analytics/sales?range=all')).status, 400)
  })

  it('custom range with no orders zero-fills', async () => {
    const res = await admin.get(
      '/api/admin/analytics/sales?range=custom&start=2001-01-01&end=2001-01-03',
    )
    assert.equal(res.status, 200)
    assert.equal(res.body.data.days.length, 3)
    assert.deepEqual([res.body.data.totals.orders, res.body.data.totals.revenue], [0, 0])
  })
})

describe('product + category analytics', () => {
  it('top products use snapshot prices (live price change ignored)', async () => {
    const res = await admin.get('/api/admin/analytics/products?range=30d&limit=10')
    assert.equal(res.status, 200)
    const [first, second] = res.body.data.items
    // pA: o1(2) + o3(1) + o5(1) @ snapshot 1000 → qty 4, revenue 4000
    assert.equal(first.slug, 'analytics-kurta-a')
    assert.equal(first.name, 'Analytics Kurta A')
    assert.equal(first.quantity, 4)
    assert.equal(first.revenue, 4000)
    assert.equal(first.orders, 3)
    // pB: o2(1) + o7(1) @ 2000 → qty 2, revenue 4000, orders 2 (revenue tie broken by quantity)
    assert.equal(second.slug, 'analytics-saree-b')
    assert.equal(second.quantity, 2)
    assert.equal(second.revenue, 4000)
    assert.equal(second.orders, 2)
  })

  it('limit allowlist: 5 works, bogus falls back to 10', async () => {
    const five = await admin.get('/api/admin/analytics/products?limit=5')
    assert.equal(five.status, 200)
    assert.equal(five.body.data.limit, 5)
    assert.ok(five.body.data.items.length <= 5)
    const bogus = await admin.get('/api/admin/analytics/products?limit=999')
    assert.equal(bogus.body.data.limit, 10)
  })

  it('categories aggregate quantities, revenue and order counts', async () => {
    const res = await admin.get('/api/admin/analytics/categories?range=30d')
    assert.equal(res.status, 200)
    const kurtas = res.body.data.items.find((c) => c.category === 'kurtas')
    const sarees = res.body.data.items.find((c) => c.category === 'sarees')
    assert.deepEqual([kurtas.quantity, kurtas.revenue, kurtas.orders], [4, 4000, 3])
    assert.deepEqual([sarees.quantity, sarees.revenue, sarees.orders], [2, 4000, 2])
  })
})

describe('customer + coupon analytics', () => {
  it('customer aggregates without PII', async () => {
    const res = await admin.get('/api/admin/analytics/customers?range=30d')
    assert.equal(res.status, 200)
    const d = res.body.data
    assert.equal(d.totalCustomers, 3)
    assert.equal(d.newCustomers, 3)
    assert.equal(d.customersWithOrders, 2) // u1 + u2 lifetime
    assert.equal(d.customersWithOrdersInPeriod, 2)
    // u1: o1,o2,o5 (3) / u2: o3,o7 (2, o4 cancelled excluded) → both repeat
    assert.equal(d.repeatCustomers, 2)
    assert.equal(d.averageOrdersPerCustomer, 2.5)
  })

  it('coupon aggregates read order snapshots; cancelled uses excluded', async () => {
    const res = await admin.get('/api/admin/analytics/coupons?range=30d')
    assert.equal(res.status, 200)
    const d = res.body.data
    // o1 SAVE10/200 + o7 FLAT50/100; o4 (cancelled) excluded
    assert.equal(d.totalUses, 2)
    assert.equal(d.totalDiscount, 300)
    assert.deepEqual(d.top.map((t) => t.code), ['SAVE10', 'FLAT50'])
    assert.deepEqual([d.top[0].uses, d.top[0].discount], [1, 200])
    assert.deepEqual([d.top[1].uses, d.top[1].discount], [1, 100])
  })
})

describe('analytics secrecy', () => {
  it('no secrets, hashes, tokens or credentials in any analytics response', async () => {
    const paths = [
      '/api/admin/analytics/overview?range=30d',
      '/api/admin/analytics/sales?range=7d',
      '/api/admin/analytics/products',
      '/api/admin/analytics/categories',
      '/api/admin/analytics/customers',
      '/api/admin/analytics/coupons',
    ]
    for (const p of paths) {
      const res = await admin.get(p)
      assert.equal(res.status, 200, p)
      const blob = JSON.stringify(res.body).toLowerCase()
      for (const needle of ['passwordhash', 'password', 'jwt', 'razorpay', 'secret', 'token', 'cvv', 'cardnumber']) {
        assert.ok(!blob.includes(needle), `${p} leaked "${needle}"`)
      }
    }
  })
})
