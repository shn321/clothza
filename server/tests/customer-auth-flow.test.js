/* CLOTHZA customer authentication flow tests — guest browsing stays
   open, checkout/order placement requires authentication, the guest
   cart merges on sign-in, and admin protection is unchanged.
   Runs against an isolated in-memory MongoDB; no external services. */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.JWT_SECRET = 'test-jwt-secret-for-customer-flow-suite'
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
let product

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

async function registerAgent(email, name = 'Test User') {
  const agent = request.agent(app)
  const res = await agent
    .post('/api/auth/register')
    .send({ name, email, password: 'password123' })
  assert.equal(res.status, 201, `register failed for ${email}: ${res.text}`)
  return agent
}

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri('clothza-customer-flow-test')
  process.env.MONGODB_URI = uri
  await mongoose.connect(uri)
  app = createApp()
  product = await Product.create({
    slug: 'flow-kurta',
    name: 'Flow Kurta',
    description: 'A kurta for the customer auth flow tests.',
    price: 1200,
    category: 'kurtas',
    subcategory: 'casual',
    gender: 'men',
    images: ['https://example.com/kurta.jpg'],
    colors: ['ivory'],
    sizes: ['M', 'L'],
    stock: 30,
    tags: ['kurta'],
  })
})

after(async () => {
  await mongoose.disconnect().catch(() => {})
  await mongod?.stop()
})

describe('guest browsing stays open (no login required)', () => {
  it('product list, detail, search and filters work without auth', async () => {
    const anon = request(app)
    const list = await anon.get('/api/products?limit=5')
    assert.equal(list.status, 200)
    const detail = await anon.get('/api/products/flow-kurta')
    assert.equal(detail.status, 200)
    assert.equal(detail.body.data.slug, 'flow-kurta')
    const search = await anon.get('/api/products?q=kurta')
    assert.equal(search.status, 200)
    const men = await anon.get('/api/products?gender=men')
    assert.equal(men.status, 200)
    const newest = await anon.get('/api/products?sort=newest')
    assert.equal(newest.status, 200)
  })

  it('public reviews read works without auth; unknown slug stays a graceful 404', async () => {
    const anon = request(app)
    const reviews = await anon.get('/api/products/flow-kurta/reviews')
    assert.equal(reviews.status, 200)
    const missing = await anon.get('/api/products/no-such-product-xyz')
    assert.equal(missing.status, 404)
    assert.equal(missing.body.success, false)
  })
})

describe('guests can never place orders (API enforced)', () => {
  it('POST /api/orders without a session returns 401', async () => {
    const res = await request(app).post('/api/orders').send({
      customer: { ...CUSTOMER, email: 'guest@example.com' },
      shipping: SHIPPING,
      deliveryMethod: 'standard',
      paymentMethod: 'cod',
    })
    assert.equal(res.status, 401)
    assert.equal(res.body.success, false)
    assert.equal(await Order.countDocuments(), 0)
  })

  it('guest order reads, server cart and server wishlist all require auth', async () => {
    const anon = request(app)
    assert.equal((await anon.get('/api/orders')).status, 401)
    assert.equal((await anon.get('/api/cart')).status, 401)
    assert.equal((await anon.post('/api/cart/items').send({ productId: 'flow-kurta', qty: 1 })).status, 401)
    assert.equal((await anon.get('/api/wishlist')).status, 401)
  })

  it('forged userId in the order body cannot place an order as someone else', async () => {
    const victim = await registerAgent('flow-victim@example.com', 'Victim')
    await victim.post('/api/cart/items').send({ productId: 'flow-kurta', size: 'M', qty: 1 })
    const res = await request(app).post('/api/orders').send({
      userId: String((await User.findOne({ email: 'flow-victim@example.com' }))._id),
      customer: { ...CUSTOMER, email: 'flow-victim@example.com' },
      shipping: SHIPPING,
      deliveryMethod: 'standard',
      paymentMethod: 'cod',
    })
    assert.equal(res.status, 401)
    assert.equal(await Order.countDocuments({}), 0)
  })
})

describe('cart survives the login redirect (guest lines merge on sign-in)', () => {
  it('POST /api/cart/merge imports guest-local lines, then checkout works', async () => {
    const agent = await registerAgent('flow-merge@example.com', 'Merger')
    // Guest-local cart shape as persisted by the frontend localStorage key.
    const merge = await agent.post('/api/cart/merge').send({
      items: [{ productId: 'flow-kurta', size: 'M', colour: null, qty: 2 }],
    })
    assert.equal(merge.status, 200)
    assert.equal(merge.body.data.items.length, 1)
    assert.equal(merge.body.data.items[0].qty, 2)
    const cart = await agent.get('/api/cart')
    assert.equal(cart.status, 200)
    assert.equal(cart.body.data.count, 2)

    const order = await agent.post('/api/orders').send({
      customer: { ...CUSTOMER, email: 'flow-merge@example.com' },
      shipping: SHIPPING,
      deliveryMethod: 'standard',
      paymentMethod: 'cod',
    })
    assert.equal(order.status, 201, order.text)
    assert.equal(order.body.data.order.items[0].qty, 2)
  })
})

describe('logged-in checkout and My Orders', () => {
  it('authenticated user completes COD checkout; order saved under their id', async () => {
    const agent = await registerAgent('flow-shopper@example.com', 'Shopper')
    await agent.post('/api/cart/items').send({ productId: 'flow-kurta', size: 'M', qty: 1 })
    const res = await agent.post('/api/orders').send({
      customer: { ...CUSTOMER, email: 'flow-shopper@example.com' },
      shipping: SHIPPING,
      deliveryMethod: 'standard',
      paymentMethod: 'cod',
    })
    assert.equal(res.status, 201, res.text)
    const orderNumber = res.body.data.order.orderNumber
    const me = await User.findOne({ email: 'flow-shopper@example.com' })
    const stored = await Order.findOne({ orderNumber }).lean()
    assert.ok(stored)
    assert.equal(String(stored.user), String(me._id))
    assert.equal(stored.paymentStatus, 'pending')

    const mine = await agent.get('/api/orders')
    assert.equal(mine.status, 200)
    assert.ok(mine.body.data.orders.some((o) => o.orderNumber === orderNumber))
    const detail = await agent.get(`/api/orders/${orderNumber}`)
    assert.equal(detail.status, 200)
  })

  it('users cannot see each other’s orders', async () => {
    const other = await registerAgent('flow-other@example.com', 'Other')
    const shopperOrder = await Order.findOne().lean()
    const res = await other.get(`/api/orders/${shopperOrder.orderNumber}`)
    assert.equal(res.status, 404)
  })
})

describe('admin protection unchanged', () => {
  it('non-admin gets 403, promoted admin reaches the dashboard', async () => {
    const agent = await registerAgent('flow-admin@example.com', 'Admin User')
    assert.equal((await agent.get('/api/admin/dashboard')).status, 403)
    await User.updateOne({ email: 'flow-admin@example.com' }, { $set: { role: 'admin' } })
    const dash = await agent.get('/api/admin/dashboard')
    assert.equal(dash.status, 200)
    assert.equal(dash.body.success, true)
  })
})
