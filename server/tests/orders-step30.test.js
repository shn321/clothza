/* CLOTHZA Step 30 — finalized e-commerce order + demo payment flow.
   Covers: guest cannot order, COD + DEMO_ONLINE creation, server-side
   totals (browser amounts ignored), quantity/stock validation, exact-once
   stock decrement, cart clear/preserve semantics, order isolation, admin
   visibility + status updates, idempotent duplicates, cancellation and
   the simulated demo quote → confirm flow.
   Runs against an isolated in-memory MongoDB; no external services. */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.JWT_SECRET = 'test-jwt-secret-for-step30-suite'
process.env.JWT_EXPIRES_IN = '7d'
process.env.RAZORPAY_KEY_ID = 'test_key'
process.env.RAZORPAY_KEY_SECRET = 'test_secret'
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret'

const { createApp } = await import('../src/app.js')
const User = (await import('../src/models/User.js')).default
const Product = (await import('../src/models/Product.js')).default
const Cart = (await import('../src/models/Cart.js')).default
const Order = (await import('../src/models/Order.js')).default

let mongod
let app
let seq = 0

const CUSTOMER = {
  firstName: 'Meera',
  lastName: 'Iyer',
  email: 'meera.iyer@example.com',
  phone: '+919876543210',
}
const SHIPPING = {
  address: '22 Rosewood Lane',
  apartment: '',
  city: 'Chennai',
  state: 'Tamil Nadu',
  pin: '600001',
  country: 'India',
}

function nextEmail(prefix) {
  seq += 1
  return `${prefix}-${seq}@example.com`
}

function productDoc(slug, overrides = {}) {
  return {
    slug,
    name: `Step30 ${slug}`,
    description: 'Step-30 order flow test product.',
    price: 1000,
    category: 'kurtas',
    gender: 'women',
    images: [],
    colors: [],
    sizes: [],
    stock: 20,
    tags: [],
    ...overrides,
  }
}

function orderBody(email, overrides = {}) {
  return {
    customer: { ...CUSTOMER, email },
    shipping: SHIPPING,
    deliveryMethod: 'standard',
    paymentMethod: 'cod',
    ...overrides,
  }
}

async function registerAgent(email, name = 'Step30 User') {
  const agent = request.agent(app)
  const res = await agent
    .post('/api/auth/register')
    .send({ name, email, password: 'password123' })
  assert.equal(res.status, 201, `register failed for ${email}: ${res.text}`)
  return agent
}

async function makeAdmin(email) {
  const agent = await registerAgent(email, 'Step30 Admin')
  await User.updateOne({ email }, { $set: { role: 'admin' } })
  return agent
}

async function stockOf(slug) {
  const p = await Product.findOne({ slug }).lean()
  return p?.stock
}

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri('clothza-step30-test')
  process.env.MONGODB_URI = uri
  await mongoose.connect(uri)
  app = createApp()
})

after(async () => {
  await mongoose.disconnect().catch(() => {})
  await mongod?.stop()
})

describe('1. guests can never create orders or demo sessions', () => {
  it('POST /api/orders without a session → 401, no order stored', async () => {
    const before = await Order.countDocuments()
    const res = await request(app).post('/api/orders').send(orderBody('guest@example.com'))
    assert.equal(res.status, 401)
    assert.equal(res.body.success, false)
    assert.equal(await Order.countDocuments(), before)
  })

  it('demo quote + confirm without a session → 401', async () => {
    assert.equal((await request(app).post('/api/payments/demo/order').send({})).status, 401)
    assert.equal(
      (await request(app).post('/api/payments/demo/confirm').send({ demoSessionId: 'DEMO-X' })).status,
      401,
    )
  })
})

describe('2–3. authenticated COD + DEMO_ONLINE orders', () => {
  it('COD order → 201, pending/cod, server totals, cart cleared', async () => {
    const email = nextEmail('s30-cod')
    const agent = await registerAgent(email)
    await Product.create(productDoc('s30-cod-kurta', { price: 1200, stock: 10 }))
    await agent.post('/api/cart/items').send({ productId: 's30-cod-kurta', qty: 2 })

    const res = await agent.post('/api/orders').send(orderBody(email))
    assert.equal(res.status, 201, res.text)
    const order = res.body.data.order
    assert.equal(order.paymentMethod, 'cod')
    assert.equal(order.paymentStatus, 'pending')
    assert.equal(order.paymentProvider, 'cod')
    assert.equal(order.subtotal, 2400)
    assert.equal(order.total, 2400)
    assert.ok(order.orderNumber)

    const cart = await agent.get('/api/cart')
    assert.equal(cart.body.data.count, 0)
  })

  it('DEMO_ONLINE order → 201, paid/demo with paidAt', async () => {
    const email = nextEmail('s30-demo')
    const agent = await registerAgent(email)
    await Product.create(productDoc('s30-demo-kurta', { price: 1500, stock: 10 }))
    await agent.post('/api/cart/items').send({ productId: 's30-demo-kurta', qty: 1 })

    const res = await agent.post('/api/orders').send(orderBody(email, { paymentMethod: 'DEMO_ONLINE' }))
    assert.equal(res.status, 201, res.text)
    const order = res.body.data.order
    assert.equal(order.paymentMethod, 'demo_online')
    assert.equal(order.paymentStatus, 'paid')
    assert.equal(order.paymentProvider, 'demo')
    assert.equal(order.isDemoPayment, true)
    assert.ok(order.paidAt)
  })
})

describe('4–5. server is authoritative for money', () => {
  it('price change in MongoDB wins over the cart snapshot', async () => {
    const email = nextEmail('s30-price')
    const agent = await registerAgent(email)
    await Product.create(productDoc('s30-price-kurta', { price: 1000, stock: 10 }))
    await agent.post('/api/cart/items').send({ productId: 's30-price-kurta', qty: 2 })
    await Product.updateOne({ slug: 's30-price-kurta' }, { $set: { price: 1500 } })

    const res = await agent.post('/api/orders').send(orderBody(email))
    assert.equal(res.status, 201, res.text)
    assert.equal(res.body.data.order.subtotal, 3000)
    assert.equal(res.body.data.order.total, 3000)
  })

  it('browser-sent totals/status/prices are ignored', async () => {
    const email = nextEmail('s30-tamper')
    const agent = await registerAgent(email)
    await Product.create(productDoc('s30-tamper-kurta', { price: 2000, stock: 10 }))
    await agent.post('/api/cart/items').send({ productId: 's30-tamper-kurta', qty: 1 })

    const res = await agent.post('/api/orders').send({
      ...orderBody(email),
      subtotal: 1,
      total: 1,
      discount: 999,
      paymentStatus: 'paid',
      shippingCost: 0,
    })
    assert.equal(res.status, 201, res.text)
    const order = res.body.data.order
    assert.equal(order.subtotal, 2000)
    assert.equal(order.total, 2000)
    assert.equal(order.paymentStatus, 'pending')
  })
})

describe('6–7. quantity and stock validation', () => {
  it('invalid (zero) quantity is rejected', async () => {
    const email = nextEmail('s30-qty')
    const agent = await registerAgent(email)
    await Product.create(productDoc('s30-qty-kurta', { price: 500, stock: 10 }))
    await agent.post('/api/cart/items').send({ productId: 's30-qty-kurta', qty: 1 })
    const me = await User.findOne({ email }).lean()
    await Cart.updateOne(
      { user: me._id, 'items.productId': 's30-qty-kurta' },
      { $set: { 'items.$.qty': 0 } },
    )
    const res = await agent.post('/api/orders').send(orderBody(email))
    assert.equal(res.status, 400)
    assert.equal(res.body.success, false)
  })

  it('out-of-stock and over-quantity orders are rejected safely', async () => {
    const email = nextEmail('s30-oos')
    const agent = await registerAgent(email)
    await Product.create(productDoc('s30-oos-kurta', { price: 500, stock: 0 }))
    await Product.create(productDoc('s30-low-kurta', { price: 500, stock: 1 }))
    await agent.post('/api/cart/items').send({ productId: 's30-oos-kurta', qty: 1 })
    const oos = await agent.post('/api/orders').send(orderBody(email))
    assert.equal(oos.status, 400)
    assert.match(oos.body.message, /out of stock/i)

    await agent.delete('/api/cart')
    await agent.post('/api/cart/items').send({ productId: 's30-low-kurta', qty: 2 })
    // Cart clamps to available stock, so force the over-quantity line directly.
    const me = await User.findOne({ email }).lean()
    await Cart.updateOne(
      { user: me._id, 'items.productId': 's30-low-kurta' },
      { $set: { 'items.$.qty': 5 } },
    )
    const over = await agent.post('/api/orders').send(orderBody(email))
    assert.equal(over.status, 400)
    assert.match(over.body.message, /only 1 unit/i)
  })
})

describe('8–10. inventory exactness + cart semantics', () => {
  it('stock decreases exactly once even on duplicate submission', async () => {
    const email = nextEmail('s30-once')
    const agent = await registerAgent(email)
    await Product.create(productDoc('s30-once-kurta', { price: 800, stock: 10 }))
    await agent.post('/api/cart/items').send({ productId: 's30-once-kurta', qty: 3 })
    const key = `s30-once-${Date.now()}`

    const first = await agent.post('/api/orders').send(orderBody(email, { idempotencyKey: key }))
    assert.equal(first.status, 201, first.text)
    const second = await agent.post('/api/orders').send(orderBody(email, { idempotencyKey: key }))
    assert.equal(second.status, 200)
    assert.equal(second.body.data.replay, true)
    assert.equal(second.body.data.order.orderNumber, first.body.data.order.orderNumber)

    assert.equal(await stockOf('s30-once-kurta'), 7)
    assert.equal(
      await Order.countDocuments({ orderNumber: first.body.data.order.orderNumber }),
      1,
    )
  })

  it('failed order preserves the cart', async () => {
    const email = nextEmail('s30-keep')
    const agent = await registerAgent(email)
    await Product.create(productDoc('s30-keep-kurta', { price: 700, stock: 0 }))
    await agent.post('/api/cart/items').send({ productId: 's30-keep-kurta', qty: 1 })
    const res = await agent.post('/api/orders').send(orderBody(email))
    assert.equal(res.status, 400)
    const cart = await agent.get('/api/cart')
    assert.equal(cart.body.data.count, 1)
  })

  it('empty cart cannot check out; invalid address is rejected', async () => {
    const agent = await registerAgent(nextEmail('s30-empty'))
    const empty = await agent.post('/api/orders').send(orderBody('s30-empty@example.com'))
    assert.equal(empty.status, 400)

    await Product.create(productDoc('s30-addr-kurta', { price: 400, stock: 5 }))
    await agent.post('/api/cart/items').send({ productId: 's30-addr-kurta', qty: 1 })
    const badPin = await agent.post('/api/orders').send(
      orderBody('s30-empty@example.com', { shipping: { ...SHIPPING, pin: '12' } }),
    )
    assert.equal(badPin.status, 400)
  })
})

describe('11–12. customers see only their own orders', () => {
  it('list + detail show the owner’s order; strangers get 404', async () => {
    const email = nextEmail('s30-mine')
    const agent = await registerAgent(email)
    await Product.create(productDoc('s30-mine-kurta', { price: 900, stock: 5 }))
    await agent.post('/api/cart/items').send({ productId: 's30-mine-kurta', qty: 1 })
    const created = await agent.post('/api/orders').send(orderBody(email))
    assert.equal(created.status, 201, created.text)
    const num = created.body.data.order.orderNumber

    const mine = await agent.get('/api/orders')
    assert.equal(mine.status, 200)
    const found = mine.body.data.orders.find((o) => o.orderNumber === num)
    assert.ok(found)
    assert.equal(found.paymentMethod, 'cod')
    assert.equal(typeof found.total, 'number')

    const detail = await agent.get(`/api/orders/${num}`)
    assert.equal(detail.status, 200)
    assert.equal(detail.body.data.order.items.length, 1)

    const stranger = await registerAgent(nextEmail('s30-stranger'))
    assert.equal((await stranger.get(`/api/orders/${num}`)).status, 404)
  })
})

describe('13–15. admin visibility + status propagation', () => {
  it('admin lists/searches the order, updates status, customer sees it', async () => {
    const email = nextEmail('s30-adminflow')
    const shopper = await registerAgent(email)
    const admin = await makeAdmin(nextEmail('s30-admin'))
    await Product.create(productDoc('s30-adminflow-kurta', { price: 1100, stock: 8 }))
    await shopper.post('/api/cart/items').send({ productId: 's30-adminflow-kurta', qty: 1 })
    const created = await shopper.post('/api/orders').send(orderBody(email))
    assert.equal(created.status, 201, created.text)
    const num = created.body.data.order.orderNumber

    const list = await admin.get('/api/admin/orders')
    assert.equal(list.status, 200)
    assert.ok(list.body.data.orders.some((o) => o.orderNumber === num))

    const search = await admin.get(`/api/admin/orders?q=${encodeURIComponent(num)}`)
    assert.equal(search.status, 200)
    assert.ok(search.body.data.orders.some((o) => o.orderNumber === num))

    const filtered = await admin.get('/api/admin/orders?status=pending')
    assert.equal(filtered.status, 200)
    assert.ok(filtered.body.data.orders.some((o) => o.orderNumber === num))

    const detail = await admin.get(`/api/admin/orders/${num}`)
    assert.equal(detail.status, 200)
    assert.equal(detail.body.data.order.paymentMethod, 'cod')
    assert.equal(detail.body.data.order.paymentStatus, 'pending')

    const updated = await admin.patch(`/api/admin/orders/${num}/status`).send({ status: 'confirmed' })
    assert.equal(updated.status, 200)
    assert.equal(updated.body.data.order.orderStatus, 'confirmed')

    const seen = await shopper.get(`/api/orders/${num}`)
    assert.equal(seen.status, 200)
    assert.equal(seen.body.data.order.orderStatus, 'confirmed')

    // Non-admin cannot use the admin endpoint; invalid jumps are rejected.
    assert.equal((await shopper.patch(`/api/admin/orders/${num}/status`).send({ status: 'shipped' })).status, 403)
    assert.equal((await admin.patch(`/api/admin/orders/${num}/status`).send({ status: 'delivered' })).status, 409)
  })
})

describe('16. demo quote → confirm flow (simulated, server-secured)', () => {
  it('quote uses server totals; confirm mints one paid order; replay is safe', async () => {
    const email = nextEmail('s30-demoflow')
    const agent = await registerAgent(email)
    await Product.create(productDoc('s30-demoflow-kurta', { price: 1300, stock: 6 }))
    await agent.post('/api/cart/items').send({ productId: 's30-demoflow-kurta', qty: 2 })

    const quote = await agent.post('/api/payments/demo/order').send({
      deliveryMethod: 'standard',
      customer: { ...CUSTOMER, email },
      shipping: SHIPPING,
    })
    assert.equal(quote.status, 201, quote.text)
    assert.equal(quote.body.data.demo, true)
    assert.equal(quote.body.data.total, 2600)
    assert.ok(quote.body.data.demoSessionId)

    const confirmBody = {
      demoSessionId: quote.body.data.demoSessionId,
      customer: { ...CUSTOMER, email },
      shipping: SHIPPING,
      idempotencyKey: `s30-demoflow-${Date.now()}`,
    }
    const first = await agent.post('/api/payments/demo/confirm').send(confirmBody)
    assert.equal(first.status, 201, first.text)
    assert.equal(first.body.data.order.paymentMethod, 'demo_online')
    assert.equal(first.body.data.order.paymentStatus, 'paid')

    const replay = await agent.post('/api/payments/demo/confirm').send(confirmBody)
    assert.equal(replay.status, 200)
    assert.equal(replay.body.data.replay, true)
    assert.equal(replay.body.data.order.orderNumber, first.body.data.order.orderNumber)

    assert.equal(await stockOf('s30-demoflow-kurta'), 4)
    const cart = await agent.get('/api/cart')
    assert.equal(cart.body.data.count, 0)
  })

  it('changed bag after quote is rejected; failed demo keeps the cart', async () => {
    const email = nextEmail('s30-demochg')
    const agent = await registerAgent(email)
    await Product.create(productDoc('s30-demochg-a', { price: 500, stock: 5 }))
    await Product.create(productDoc('s30-demochg-b', { price: 600, stock: 5 }))
    await agent.post('/api/cart/items').send({ productId: 's30-demochg-a', qty: 1 })
    const quote = await agent.post('/api/payments/demo/order').send({ deliveryMethod: 'standard' })
    assert.equal(quote.status, 201, quote.text)

    await agent.post('/api/cart/items').send({ productId: 's30-demochg-b', qty: 1 })
    const stale = await agent.post('/api/payments/demo/confirm').send({
      demoSessionId: quote.body.data.demoSessionId,
      customer: { ...CUSTOMER, email },
      shipping: SHIPPING,
    })
    assert.equal(stale.status, 400)
    assert.match(stale.body.message, /bag changed/i)

    const quote2 = await agent.post('/api/payments/demo/order').send({ deliveryMethod: 'standard' })
    const failed = await agent.post('/api/payments/demo/fail').send({
      demoSessionId: quote2.body.data.demoSessionId,
    })
    assert.equal(failed.status, 200)
    assert.equal(failed.body.data.status, 'failed')
    const cart = await agent.get('/api/cart')
    assert.equal(cart.body.data.count, 2)
  })
})

describe('17. cancellation rules + admin-cancel stock restore', () => {
  it('customer cancel restores stock; repeats + post-final moves fail', async () => {
    const email = nextEmail('s30-cancel')
    const shopper = await registerAgent(email)
    const admin = await makeAdmin(nextEmail('s30-canceladmin'))
    await Product.create(productDoc('s30-cancel-kurta', { price: 950, stock: 5 }))
    await shopper.post('/api/cart/items').send({ productId: 's30-cancel-kurta', qty: 2 })
    const created = await shopper.post('/api/orders').send(orderBody(email))
    assert.equal(created.status, 201, created.text)
    const num = created.body.data.order.orderNumber
    assert.equal(await stockOf('s30-cancel-kurta'), 3)

    const cancelled = await shopper.patch(`/api/orders/${num}/cancel`).send({})
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.body.data.order.orderStatus, 'cancelled')
    assert.equal(await stockOf('s30-cancel-kurta'), 5)

    assert.equal((await shopper.patch(`/api/orders/${num}/cancel`).send({})).status, 409)
    assert.equal((await admin.patch(`/api/admin/orders/${num}/status`).send({ status: 'processing' })).status, 409)
  })

  it('admin cancellation restores stock too', async () => {
    const email = nextEmail('s30-admincancel')
    const shopper = await registerAgent(email)
    const admin = await makeAdmin(nextEmail('s30-admincanceladmin'))
    await Product.create(productDoc('s30-admincancel-kurta', { price: 650, stock: 4 }))
    await shopper.post('/api/cart/items').send({ productId: 's30-admincancel-kurta', qty: 1 })
    const created = await shopper.post('/api/orders').send(orderBody(email))
    assert.equal(created.status, 201, created.text)
    const num = created.body.data.order.orderNumber

    const res = await admin.patch(`/api/admin/orders/${num}/status`).send({ status: 'cancelled' })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.order.orderStatus, 'cancelled')
    assert.equal(await stockOf('s30-admincancel-kurta'), 4)

    const seen = await shopper.get(`/api/orders/${num}`)
    assert.equal(seen.body.data.order.orderStatus, 'cancelled')
  })
})
