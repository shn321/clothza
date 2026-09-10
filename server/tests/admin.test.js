/* CLOTHZA Step 16 tests — admin dashboard + full regression.
   Runs against an isolated in-memory MongoDB; no external services.
   Razorpay paths are exercised with placeholder test secrets so no
   network is ever touched (bad-signature paths only). */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.JWT_SECRET = 'test-jwt-secret-for-admin-suite'
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

function productDoc(overrides = {}) {
  return {
    slug: 'test-kurta',
    name: 'Test Kurta',
    description: 'A fine test kurta.',
    price: 1499,
    originalPrice: 1999,
    category: 'men',
    subcategory: 'kurtas',
    gender: 'men',
    images: ['https://example.com/kurta.jpg'],
    colors: ['ivory'],
    sizes: ['M', 'L'],
    stock: 25,
    rating: 4.5,
    reviewCount: 12,
    tags: ['kurta'],
    isFeatured: true,
    isBestSeller: false,
    isNewArrival: true,
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
  // Re-login so the session reflects the promoted role lookup path
  // (role is read from DB per request; the cookie stays valid).
  return agent
}

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri('clothza-admin-test')
  process.env.MONGODB_URI = uri
  await mongoose.connect(uri)
  app = createApp()
})

after(async () => {
  await mongoose.disconnect().catch(() => {})
  await mongod?.stop()
})

describe('admin authorization', () => {
  it('anonymous GET /api/admin/dashboard → 401', async () => {
    const res = await request(app).get('/api/admin/dashboard')
    assert.equal(res.status, 401)
    assert.equal(res.body.success, false)
  })

  it('anonymous admin product/order/customer endpoints → 401', async () => {
    const anon = request(app)
    const gets = await Promise.all([
      anon.get('/api/admin/products'),
      anon.get('/api/admin/orders'),
      anon.get('/api/admin/customers'),
    ])
    for (const r of gets) assert.equal(r.status, 401)
    const post = await anon.post('/api/admin/products').send({ name: 'x' })
    assert.equal(post.status, 401)
  })

  it('authenticated non-admin → 403 on every admin endpoint', async () => {
    const user = await registerAgent('user403@example.com')
    const gets = await Promise.all([
      user.get('/api/admin/dashboard'),
      user.get('/api/admin/products'),
      user.get('/api/admin/orders'),
      user.get('/api/admin/customers'),
      user.post('/api/admin/products').send({ name: 'x' }),
      user.patch('/api/admin/orders/CLZ-1/status').send({ status: 'shipped' }),
    ])
    for (const r of gets) assert.equal(r.status, 403)
  })

  it('admin → 200 on dashboard', async () => {
    const admin = await makeAdmin('admin112@example.com')
    const res = await admin.get('/api/admin/dashboard')
    assert.equal(res.status, 200)
    assert.equal(res.body.success, true)
    assert.ok(res.body.data.totals)
  })
})

describe('admin product management', () => {
  let admin
  before(async () => {
    admin = await makeAdmin('productadmin@example.com')
  })

  it('admin product list → 200 with pagination', async () => {
    await Product.create(productDoc({ slug: 'list-kurta', name: 'List Kurta' }))
    const res = await admin.get('/api/admin/products')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.data))
    assert.ok(res.body.pagination)
  })

  it('create product → 201', async () => {
    const res = await admin.post('/api/admin/products').send(productDoc({ slug: 'create-kurta', name: 'Create Kurta' }))
    assert.equal(res.status, 201)
    assert.equal(res.body.data.slug, 'create-kurta')
  })

  it('invalid product rejected → 400 (missing name, negative price/stock)', async () => {
    const r1 = await admin.post('/api/admin/products').send({ slug: 'bad-1', price: 10, category: 'men' })
    assert.equal(r1.status, 400)
    const r2 = await admin.post('/api/admin/products').send(productDoc({ slug: 'bad-2', price: -5 }))
    assert.equal(r2.status, 400)
    const r3 = await admin.post('/api/admin/products').send(productDoc({ slug: 'bad-3', stock: -1 }))
    assert.equal(r3.status, 400)
    const r4 = await admin.post('/api/admin/products').send(productDoc({ slug: 'bad-4', gender: 'alien' }))
    assert.equal(r4.status, 400)
  })

  it('duplicate slug rejected → 409', async () => {
    const base = productDoc({ slug: 'dupe-kurta', name: 'Dupe' })
    const first = await admin.post('/api/admin/products').send(base)
    assert.equal(first.status, 201)
    const second = await admin.post('/api/admin/products').send(base)
    assert.equal(second.status, 409)
  })

  it('edit product → 200 (PATCH partial)', async () => {
    const created = await admin.post('/api/admin/products').send(productDoc({ slug: 'edit-kurta', name: 'Edit Me' }))
    const id = created.body.data._id
    const res = await admin.patch(`/api/admin/products/${id}`).send({ price: 1799, stock: 7 })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.price, 1799)
    assert.equal(res.body.data.stock, 7)
  })

  it('edit to a clashing slug → 409', async () => {
    const a = await admin.post('/api/admin/products').send(productDoc({ slug: 'clash-a', name: 'A' }))
    assert.equal(a.status, 201)
    const b = await admin.post('/api/admin/products').send(productDoc({ slug: 'clash-b', name: 'B' }))
    const idB = b.body.data._id
    const res = await admin.patch(`/api/admin/products/${idB}`).send({ slug: 'clash-a' })
    assert.equal(res.status, 409)
  })

  it('delete product → 200, then 404', async () => {
    const created = await admin.post('/api/admin/products').send(productDoc({ slug: 'gone-kurta', name: 'Gone' }))
    const id = created.body.data._id
    const del = await admin.delete(`/api/admin/products/${id}`)
    assert.equal(del.status, 200)
    const again = await admin.get(`/api/admin/products/${id}`)
    assert.equal(again.status, 404)
  })

  it('delete missing product → 404', async () => {
    const res = await admin.delete('/api/admin/products/000000000000000000000000')
    assert.equal(res.status, 404)
  })
})

describe('admin orders', () => {
  let admin
  let shopper
  let orderNumber
  before(async () => {
    admin = await makeAdmin('orderadmin@example.com')
    shopper = await registerAgent('shopper@example.com', 'Shopper Singh')
    await Product.create(productDoc({ slug: 'order-kurta', name: 'Order Kurta', stock: 50 }))
    await shopper.post('/api/cart/items').send({ productId: 'order-kurta', size: 'M', qty: 2 })
    const created = await shopper.post('/api/orders').send({
      customer: { ...CUSTOMER, email: 'shopper@example.com' },
      shipping: SHIPPING,
      deliveryMethod: 'standard',
      paymentMethod: 'cod',
    })
    assert.equal(created.status, 201)
    orderNumber = created.body.data.order.orderNumber
    assert.ok(orderNumber)
  })

  it('admin order list → 200', async () => {
    const res = await admin.get('/api/admin/orders')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.data.orders))
  })

  it('admin order detail → 200 with customer + totals', async () => {
    const res = await admin.get(`/api/admin/orders/${orderNumber}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.data.order.orderNumber, orderNumber)
    assert.ok(res.body.data.order.customer)
    assert.ok(res.body.data.order.shippingAddress)
    assert.equal(typeof res.body.data.order.total, 'number')
  })

  it('admin order detail missing → 404', async () => {
    const res = await admin.get('/api/admin/orders/CLZ-NOPE-000000')
    assert.equal(res.status, 404)
  })

  it('customer cannot reach admin status endpoint → 403', async () => {
    const res = await shopper.patch(`/api/admin/orders/${orderNumber}/status`).send({ status: 'shipped' })
    assert.equal(res.status, 403)
  })

  it('valid status update pending → processing → 200', async () => {
    const res = await admin.patch(`/api/admin/orders/${orderNumber}/status`).send({ status: 'processing' })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.order.orderStatus, 'processing')
  })

  it('invalid status value → 400', async () => {
    const res = await admin.patch(`/api/admin/orders/${orderNumber}/status`).send({ status: 'teleported' })
    assert.equal(res.status, 400)
  })

  it('invalid transition (processing → delivered skips shipped... actually shipped required) — delivered directly → 409', async () => {
    // processing → delivered is not allowed (must go via shipped)
    const res = await admin.patch(`/api/admin/orders/${orderNumber}/status`).send({ status: 'delivered' })
    assert.equal(res.status, 409)
  })

  it('unauthorized order access: stranger gets 404 on customer route', async () => {
    const stranger = await registerAgent('stranger@example.com', 'Stranger')
    const res = await stranger.get(`/api/orders/${orderNumber}`)
    assert.equal(res.status, 404)
  })

  it('anonymous customer order access → 401', async () => {
    const res = await request(app).get(`/api/orders/${orderNumber}`)
    assert.equal(res.status, 401)
  })
})

describe('admin customers + security', () => {
  let admin
  before(async () => {
    admin = await makeAdmin('custadmin@example.com')
  })

  it('customer list → 200 with orderCount + totalSpent', async () => {
    const res = await admin.get('/api/admin/customers')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.data.customers))
    const shopper = res.body.data.customers.find((c) => c.email === 'shopper@example.com')
    assert.ok(shopper, 'expected shopper in customer list')
    assert.equal(typeof shopper.orderCount, 'number')
    assert.equal(typeof shopper.totalSpent, 'number')
  })

  it('sensitive User fields are never returned', async () => {
    const res = await admin.get('/api/admin/customers')
    const blob = JSON.stringify(res.body)
    assert.ok(!('passwordHash' in res.body), 'top-level leak')
    for (const c of res.body.data.customers) {
      assert.equal('passwordHash' in c, false)
      assert.equal('password' in c, false)
      assert.equal('token' in c, false)
    }
    assert.match(blob, /shopper@example\.com/)
    assert.doesNotMatch(blob, /passwordHash/)
  })

  it('dashboard never leaks secrets', async () => {
    const res = await admin.get('/api/admin/dashboard')
    assert.doesNotMatch(JSON.stringify(res.body), /passwordHash|razorpay.*secret|jwt/i)
  })
})

describe('dashboard statistics', () => {
  it('reflects live MongoDB data; revenue counts paid orders only', async () => {
    const admin = await makeAdmin('statsadmin@example.com')
    const paidTotal = 4200
    const user = await User.findOne({ email: 'statsadmin@example.com' })
    const prod = await Product.create(productDoc({ slug: 'stats-kurta', name: 'Stats Kurta', stock: 100 }))
    await Order.create({
      user: user._id,
      orderNumber: 'CLZ-STATS-PAID01',
      items: [{
        product: prod._id, productId: 'stats-kurta', slug: 'stats-kurta',
        name: 'Stats Kurta', image: '', price: paidTotal, size: null, colour: null, qty: 1,
      }],
      customer: CUSTOMER,
      shippingAddress: SHIPPING,
      deliveryMethod: { id: 'standard', label: 'Standard', charge: 0, eta: '' },
      subtotal: paidTotal, shippingCost: 0, tax: 0, discount: 0, total: paidTotal,
      paymentMethod: 'card', paymentStatus: 'paid', paymentProvider: 'razorpay',
      orderStatus: 'processing',
    })
    const before = await admin.get('/api/admin/dashboard')
    const revenue = before.body.data.totals.revenue
    assert.ok(revenue >= paidTotal, `revenue ${revenue} should include paid order ${paidTotal}`)

    // A pending (unpaid) order must NOT move revenue.
    await Order.create({
      user: user._id,
      orderNumber: 'CLZ-STATS-PEND01',
      items: [{
        product: prod._id, productId: 'stats-kurta', slug: 'stats-kurta',
        name: 'Stats Kurta', image: '', price: 99999, size: null, colour: null, qty: 1,
      }],
      customer: CUSTOMER,
      shippingAddress: SHIPPING,
      deliveryMethod: { id: 'standard', label: 'Standard', charge: 0, eta: '' },
      subtotal: 99999, shippingCost: 0, tax: 0, discount: 0, total: 99999,
      paymentMethod: 'cod', paymentStatus: 'pending',
      orderStatus: 'pending',
    })
    const afterRes = await admin.get('/api/admin/dashboard')
    assert.equal(afterRes.body.data.totals.revenue, revenue, 'unpaid order must not count as revenue')
    assert.ok(afterRes.body.data.totals.orders >= before.body.data.totals.orders + 1)
    assert.ok('pending' in afterRes.body.data.ordersByStatus)
  })
})

describe('regressions (storefront flows untouched)', () => {
  it('auth: register → login → me', async () => {
    const agent = request.agent(app)
    const reg = await agent.post('/api/auth/register').send({ name: 'Reg Test', email: 'regtest@example.com', password: 'password123' })
    assert.equal(reg.status, 201)
    assert.equal(reg.body.data.user.role, 'user')
    const login = await agent.post('/api/auth/login').send({ email: 'regtest@example.com', password: 'password123' })
    assert.equal(login.status, 200)
    const me = await agent.get('/api/auth/me')
    assert.equal(me.status, 200)
    assert.equal(me.body.data.user.email, 'regtest@example.com')
  })

  it('products: list + detail + 404', async () => {
    const list = await request(app).get('/api/products?limit=5')
    assert.equal(list.status, 200)
    assert.ok(Array.isArray(list.body.data))
    const detail = await request(app).get('/api/products/order-kurta')
    assert.equal(detail.status, 200)
    const missing = await request(app).get('/api/products/no-such-slug-xyz')
    assert.equal(missing.status, 404)
  })

  it('cart: add → get', async () => {
    const agent = await registerAgent('cartreg@example.com', 'Cart Reg')
    const add = await agent.post('/api/cart/items').send({ productId: 'order-kurta', size: 'M', qty: 1 })
    assert.equal(add.status, 200)
    const get = await agent.get('/api/cart')
    assert.equal(get.status, 200)
    assert.ok(get.body.data.items.length >= 1)
  })

  it('wishlist: add → get', async () => {
    const agent = await registerAgent('wishreg@example.com', 'Wish Reg')
    const add = await agent.post('/api/wishlist/items/order-kurta')
    assert.equal(add.status, 200)
    const get = await agent.get('/api/wishlist')
    assert.equal(get.status, 200)
    assert.ok(get.body.data.ids.includes('order-kurta'))
  })

  it('checkout + customer orders: create (COD) → list → detail', async () => {
    const agent = await registerAgent('checkoutreg@example.com', 'Checkout Reg')
    await Product.create(productDoc({ slug: 'checkout-kurta', name: 'Checkout Kurta', stock: 30 }))
    await agent.post('/api/cart/items').send({ productId: 'checkout-kurta', size: 'M', qty: 1 })
    const created = await agent.post('/api/orders').send({
      customer: { ...CUSTOMER, email: 'checkoutreg@example.com' },
      shipping: SHIPPING,
      deliveryMethod: 'standard',
      paymentMethod: 'cod',
    })
    assert.equal(created.status, 201)
    const num = created.body.data.order.orderNumber
    const list = await agent.get('/api/orders')
    assert.equal(list.status, 200)
    assert.ok(list.body.data.orders.length >= 1)
    const detail = await agent.get(`/api/orders/${num}`)
    assert.equal(detail.status, 200)
    assert.equal(detail.body.data.order.orderNumber, num)
  })

  it('razorpay: unconfigured gateway order → 503; bad verify signature → 401; bad webhook signature → 400', async () => {
    const agent = await registerAgent('payreg@example.com', 'Pay Reg')
    await Product.create(productDoc({ slug: 'pay-kurta', name: 'Pay Kurta', stock: 30 }))
    await agent.post('/api/cart/items').send({ productId: 'pay-kurta', size: 'M', qty: 1 })

    const savedKey = process.env.RAZORPAY_KEY_ID
    const savedSecret = process.env.RAZORPAY_KEY_SECRET
    delete process.env.RAZORPAY_KEY_ID
    delete process.env.RAZORPAY_KEY_SECRET
    const unconfigured = await agent.post('/api/payments/razorpay/order').send({
      deliveryMethod: 'standard', paymentMethod: 'card',
    })
    assert.equal(unconfigured.status, 503)
    process.env.RAZORPAY_KEY_ID = savedKey
    process.env.RAZORPAY_KEY_SECRET = savedSecret

    const verify = await agent.post('/api/payments/razorpay/verify').send({
      razorpay_order_id: 'order_test123',
      razorpay_payment_id: 'pay_test123',
      razorpay_signature: 'wrong-signature',
      customer: { ...CUSTOMER, email: 'payreg@example.com' },
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
})
