/* CLOTHZA Step 17 tests — product reviews & ratings + full regression.
   Runs against an isolated in-memory MongoDB; no external services. */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.JWT_SECRET = 'test-jwt-secret-for-review-suite'
process.env.JWT_EXPIRES_IN = '7d'
process.env.RAZORPAY_KEY_ID = 'test_key'
process.env.RAZORPAY_KEY_SECRET = 'test_secret'
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret'

const { createApp } = await import('../src/app.js')
const User = (await import('../src/models/User.js')).default
const Product = (await import('../src/models/Product.js')).default
const Order = (await import('../src/models/Order.js')).default
const Review = (await import('../src/models/Review.js')).default

let mongod
let app
let orderSeq = 0

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
    slug: 'review-kurta',
    name: 'Review Kurta',
    description: 'A kurta worth reviewing.',
    price: 1499,
    originalPrice: 1999,
    category: 'men',
    subcategory: 'kurtas',
    gender: 'men',
    images: ['https://example.com/kurta.jpg'],
    colors: ['ivory'],
    sizes: ['M', 'L'],
    stock: 50,
    tags: ['kurta'],
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

/* Direct delivered-order fixture (verified-purchase proof). */
async function deliveredOrder(email, product, { orderStatus = 'delivered' } = {}) {
  const user = await User.findOne({ email })
  assert.ok(user, `no user ${email}`)
  orderSeq += 1
  const n = `CLZ-RV-${String(orderSeq).padStart(4, '0')}`
  return Order.create({
    user: user._id,
    orderNumber: n,
    items: [{
      product: product._id, productId: product.slug, slug: product.slug,
      name: product.name, image: '', price: product.price, size: 'M', colour: null, qty: 1,
    }],
    customer: { ...CUSTOMER, email },
    shippingAddress: SHIPPING,
    deliveryMethod: { id: 'standard', label: 'Standard', charge: 0, eta: '' },
    subtotal: product.price, shippingCost: 0, tax: 0, discount: 0, total: product.price,
    paymentMethod: 'cod', paymentStatus: 'pending',
    orderStatus,
  })
}

const GOOD_REVIEW = {
  rating: 5,
  title: 'Excellent kurta',
  comment: 'The fabric feels premium and the fit is exactly as described.',
}

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri('clothza-review-test')
  process.env.MONGODB_URI = uri
  await mongoose.connect(uri)
  app = createApp()
})

after(async () => {
  await mongoose.disconnect().catch(() => {})
  await mongod?.stop()
})

describe('review creation + verified purchase', () => {
  let product
  before(async () => {
    product = await Product.create(productDoc({ slug: 'buy-kurta', name: 'Buy Kurta' }))
  })

  it('anonymous review creation → 401', async () => {
    const res = await request(app)
      .post('/api/products/buy-kurta/reviews')
      .send({ ...GOOD_REVIEW, orderNumber: 'CLZ-NOPE' })
    assert.equal(res.status, 401)
  })

  it('eligible customer → 201, pending, verifiedPurchase true', async () => {
    const agent = await registerAgent('buyer1@example.com', 'Buyer One')
    const order = await deliveredOrder('buyer1@example.com', product)
    const res = await agent
      .post('/api/products/buy-kurta/reviews')
      .send({ ...GOOD_REVIEW, orderNumber: order.orderNumber })
    assert.equal(res.status, 201)
    assert.equal(res.body.data.review.verifiedPurchase, true)
    assert.equal(res.body.data.review.rating, 5)
    const stored = await Review.findById(res.body.data.review.id).lean()
    assert.equal(stored.status, 'pending')
  })

  it('invalid ratings → 400', async () => {
    const agent = await registerAgent('buyer2@example.com', 'Buyer Two')
    const order = await deliveredOrder('buyer2@example.com', product)
    for (const rating of [0, 6, 2.5, 'great']) {
      const res = await agent
        .post('/api/products/buy-kurta/reviews')
        .send({ ...GOOD_REVIEW, rating, orderNumber: order.orderNumber })
      assert.equal(res.status, 400, `rating ${rating} should 400`)
    }
    const missing = await agent
      .post('/api/products/buy-kurta/reviews')
      .send({ title: 'x', comment: 'This comment is long enough to pass.', orderNumber: order.orderNumber })
    assert.equal(missing.status, 400)
  })

  it('bad title/comment lengths → 400', async () => {
    const agent = await registerAgent('buyer3@example.com', 'Buyer Three')
    const order = await deliveredOrder('buyer3@example.com', product)
    const longTitle = await agent.post('/api/products/buy-kurta/reviews').send({
      ...GOOD_REVIEW, title: 't'.repeat(121), orderNumber: order.orderNumber,
    })
    assert.equal(longTitle.status, 400)
    const shortComment = await agent.post('/api/products/buy-kurta/reviews').send({
      ...GOOD_REVIEW, comment: 'Too short', orderNumber: order.orderNumber,
    })
    assert.equal(shortComment.status, 400)
    const longComment = await agent.post('/api/products/buy-kurta/reviews').send({
      ...GOOD_REVIEW, comment: 'c'.repeat(2001), orderNumber: order.orderNumber,
    })
    assert.equal(longComment.status, 400)
  })

  it('invalid product → 404; missing/unknown order → 400/404', async () => {
    const agent = await registerAgent('buyer4@example.com', 'Buyer Four')
    const badProduct = await agent
      .post('/api/products/no-such-product-xyz/reviews')
      .send({ ...GOOD_REVIEW, orderNumber: 'CLZ-X' })
    assert.equal(badProduct.status, 404)
    const noOrder = await agent
      .post('/api/products/buy-kurta/reviews')
      .send({ ...GOOD_REVIEW })
    assert.equal(noOrder.status, 400)
    const unknownOrder = await agent
      .post('/api/products/buy-kurta/reviews')
      .send({ ...GOOD_REVIEW, orderNumber: 'CLZ-DOES-NOT-EXIST' })
    assert.equal(unknownOrder.status, 404)
  })

  it('product not in that order → 403', async () => {
    const other = await Product.create(productDoc({ slug: 'other-kurta', name: 'Other Kurta' }))
    const agent = await registerAgent('buyer5@example.com', 'Buyer Five')
    const order = await deliveredOrder('buyer5@example.com', other)
    const res = await agent
      .post('/api/products/buy-kurta/reviews')
      .send({ ...GOOD_REVIEW, orderNumber: order.orderNumber })
    assert.equal(res.status, 403)
  })

  it("another user's order → 404 (no leak)", async () => {
    const agentA = await registerAgent('buyer6a@example.com', 'Buyer Six A')
    await registerAgent('buyer6b@example.com', 'Buyer Six B')
    const orderA = await deliveredOrder('buyer6a@example.com', product)
    const res = await agentA
      .post('/api/products/buy-kurta/reviews')
      .send({ ...GOOD_REVIEW, orderNumber: orderA.orderNumber })
    assert.equal(res.status, 201)
    // buyer6b tries to reuse buyer6a's order number for the same product.
    const agentB = request.agent(app)
    await agentB.post('/api/auth/login').send({ email: 'buyer6b@example.com', password: 'password123' })
    const reuse = await agentB
      .post('/api/products/buy-kurta/reviews')
      .send({ ...GOOD_REVIEW, orderNumber: orderA.orderNumber })
    assert.equal(reuse.status, 404)
  })

  it('not-delivered order (shipped) → 403', async () => {
    const agent = await registerAgent('buyer7@example.com', 'Buyer Seven')
    const order = await deliveredOrder('buyer7@example.com', product, { orderStatus: 'shipped' })
    const res = await agent
      .post('/api/products/buy-kurta/reviews')
      .send({ ...GOOD_REVIEW, orderNumber: order.orderNumber })
    assert.equal(res.status, 403)
  })

  it('duplicate review from same order → 409', async () => {
    const agent = await registerAgent('buyer8@example.com', 'Buyer Eight')
    const order = await deliveredOrder('buyer8@example.com', product)
    const first = await agent
      .post('/api/products/buy-kurta/reviews')
      .send({ ...GOOD_REVIEW, orderNumber: order.orderNumber })
    assert.equal(first.status, 201)
    const second = await agent
      .post('/api/products/buy-kurta/reviews')
      .send({ ...GOOD_REVIEW, orderNumber: order.orderNumber })
    assert.equal(second.status, 409)
  })

  it('forged verifiedPurchase/status are ignored', async () => {
    const agent = await registerAgent('buyer9@example.com', 'Buyer Nine')
    const order = await deliveredOrder('buyer9@example.com', product)
    const res = await agent.post('/api/products/buy-kurta/reviews').send({
      ...GOOD_REVIEW, orderNumber: order.orderNumber, verifiedPurchase: false, status: 'approved',
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.data.review.verifiedPurchase, true)
    const stored = await Review.findById(res.body.data.review.id).lean()
    assert.equal(stored.status, 'pending')
    assert.equal(stored.verifiedPurchase, true)
  })
})

describe('review ownership', () => {
  let product
  let owner
  let stranger
  let reviewId
  before(async () => {
    product = await Product.create(productDoc({ slug: 'own-kurta', name: 'Own Kurta' }))
    owner = await registerAgent('owner@example.com', 'Owner User')
    stranger = await registerAgent('stranger17@example.com', 'Stranger User')
    const order = await deliveredOrder('owner@example.com', product)
    const created = await owner
      .post('/api/products/own-kurta/reviews')
      .send({ ...GOOD_REVIEW, orderNumber: order.orderNumber })
    assert.equal(created.status, 201)
    reviewId = created.body.data.review.id
  })

  it('user can edit own review → 200', async () => {
    const res = await owner.patch(`/api/reviews/${reviewId}`).send({
      rating: 4, title: 'Updated title', comment: 'Updated comment with enough length here.',
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.review.rating, 4)
  })

  it('status cannot be self-approved via PATCH', async () => {
    const res = await owner.patch(`/api/reviews/${reviewId}`).send({ status: 'approved' })
    assert.equal(res.status, 200)
    const stored = await Review.findById(reviewId).lean()
    assert.equal(stored.status, 'pending')
  })

  it("user cannot edit another user's review → 403", async () => {
    const res = await stranger.patch(`/api/reviews/${reviewId}`).send({ rating: 1, comment: 'Hijacked comment here.' })
    assert.equal(res.status, 403)
  })

  it('editing an approved review sends it back to pending + recalcs', async () => {
    const admin = await makeAdmin('ownmod@example.com')
    const ok = await admin.patch(`/api/admin/reviews/${reviewId}/status`).send({ status: 'approved' })
    assert.equal(ok.status, 200)
    let prod = await Product.findOne({ slug: 'own-kurta' }).lean()
    assert.equal(prod.reviewCount, 1)
    const edit = await owner.patch(`/api/reviews/${reviewId}`).send({
      rating: 4, comment: 'Edited after approval, needs re-moderation now.',
    })
    assert.equal(edit.status, 200)
    const stored = await Review.findById(reviewId).lean()
    assert.equal(stored.status, 'pending')
    prod = await Product.findOne({ slug: 'own-kurta' }).lean()
    assert.equal(prod.reviewCount, 0)
    assert.equal(prod.rating, 0)
  })

  it("user cannot delete another user's review → 403", async () => {
    const res = await stranger.delete(`/api/reviews/${reviewId}`)
    assert.equal(res.status, 403)
  })

  it('user can delete own review → 200', async () => {
    const res = await owner.delete(`/api/reviews/${reviewId}`)
    assert.equal(res.status, 200)
    const stored = await Review.findById(reviewId).lean()
    assert.equal(stored, null)
  })

  it('malformed review id → 404', async () => {
    assert.equal((await owner.patch('/api/reviews/not-an-id').send({ rating: 3 })).status, 404)
    assert.equal((await owner.delete('/api/reviews/not-an-id')).status, 404)
  })
})

describe('visibility + admin moderation', () => {
  let product
  let admin
  let ids = {}
  before(async () => {
    product = await Product.create(productDoc({ slug: 'mod-kurta', name: 'Mod Kurta' }))
    admin = await makeAdmin('modadmin@example.com')
    for (const [email, name] of [['mod1@example.com', 'Mod One'], ['mod2@example.com', 'Mod Two'], ['mod3@example.com', 'Mod Three']]) {
      const agent = await registerAgent(email, name)
      const order = await deliveredOrder(email, product)
      const created = await agent.post('/api/products/mod-kurta/reviews').send({
        rating: 5, title: `Title by ${name}`, comment: `A thoughtful review written by ${name} here.`, orderNumber: order.orderNumber,
      })
      assert.equal(created.status, 201)
      ids[email] = created.body.data.review.id
    }
    assert.equal((await admin.patch(`/api/admin/reviews/${ids['mod1@example.com']}/status`).send({ status: 'approved' })).status, 200)
    assert.equal((await admin.patch(`/api/admin/reviews/${ids['mod2@example.com']}/status`).send({ status: 'rejected' })).status, 200)
  })

  it('public list shows approved only', async () => {
    const res = await request(app).get('/api/products/mod-kurta/reviews')
    assert.equal(res.status, 200)
    assert.equal(res.body.data.reviews.length, 1)
    assert.equal(res.body.data.reviews[0].title, 'Title by Mod One')
    assert.equal(res.body.data.summary.count, 1)
    assert.ok(res.body.data.summary.breakdown)
  })

  it('public reviews never leak emails or hashes', async () => {
    const res = await request(app).get('/api/products/mod-kurta/reviews')
    const blob = JSON.stringify(res.body)
    assert.doesNotMatch(blob, /mod1@example\.com/)
    assert.doesNotMatch(blob, /passwordHash/)
  })

  it('admin approve updates product rating', async () => {
    const beforeProd = await Product.findOne({ slug: 'mod-kurta' }).lean()
    assert.equal(beforeProd.reviewCount, 1)
    const res = await admin.patch(`/api/admin/reviews/${ids['mod3@example.com']}/status`).send({ status: 'approved' })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.review.status, 'approved')
    const afterProd = await Product.findOne({ slug: 'mod-kurta' }).lean()
    assert.equal(afterProd.reviewCount, 2)
    assert.equal(afterProd.rating, 5)
  })

  it('admin invalid status → 400; missing review → 404', async () => {
    const badStatus = await admin.patch(`/api/admin/reviews/${ids['mod1@example.com']}/status`).send({ status: 'pending' })
    assert.equal(badStatus.status, 400)
    const missing = await admin.patch('/api/admin/reviews/000000000000000000000000/status').send({ status: 'approved' })
    assert.equal(missing.status, 404)
  })

  it('admin delete removes review + updates aggregation', async () => {
    const res = await admin.delete(`/api/admin/reviews/${ids['mod1@example.com']}`)
    assert.equal(res.status, 200)
    const prod = await Product.findOne({ slug: 'mod-kurta' }).lean()
    assert.equal(prod.reviewCount, 1)
    const pub = await request(app).get('/api/products/mod-kurta/reviews')
    assert.ok(!pub.body.data.reviews.some((r) => r.id === ids['mod1@example.com']))
  })

  it('admin list with status/rating/search filters → 200', async () => {
    const all = await admin.get('/api/admin/reviews')
    assert.equal(all.status, 200)
    assert.ok(Array.isArray(all.body.data.reviews))
    const pending = await admin.get('/api/admin/reviews?status=pending')
    assert.equal(pending.status, 200)
    assert.ok(pending.body.data.reviews.every((r) => r.status === 'pending'))
    const five = await admin.get('/api/admin/reviews?rating=5')
    assert.equal(five.status, 200)
    assert.ok(five.body.data.reviews.every((r) => r.rating === 5))
    const badStatus = await admin.get('/api/admin/reviews?status=bogus')
    assert.equal(badStatus.status, 400)
    const badRating = await admin.get('/api/admin/reviews?rating=9')
    assert.equal(badRating.status, 400)
  })

  it('normal user → 403 on admin review endpoints; anonymous → 401', async () => {
    const user = await registerAgent('plainuser17@example.com', 'Plain User')
    assert.equal((await user.get('/api/admin/reviews')).status, 403)
    assert.equal((await user.patch(`/api/admin/reviews/${ids['mod3@example.com']}/status`).send({ status: 'rejected' })).status, 403)
    assert.equal((await user.delete(`/api/admin/reviews/${ids['mod3@example.com']}`)).status, 403)
    assert.equal((await request(app).get('/api/admin/reviews')).status, 401)
  })
})

describe('rating aggregation', () => {
  it('average across approvals; deletion updates; count never negative', async () => {
    const product = await Product.create(productDoc({ slug: 'agg-kurta', name: 'Agg Kurta' }))
    const admin = await makeAdmin('aggadmin@example.com')
    const agents = []
    for (const [email, name, rating] of [['agg1@example.com', 'Agg One', 5], ['agg2@example.com', 'Agg Two', 3]]) {
      const agent = await registerAgent(email, name)
      const order = await deliveredOrder(email, product)
      const created = await agent.post('/api/products/agg-kurta/reviews').send({
        rating, title: `Agg ${rating}`, comment: `Aggregation review with rating ${rating} here.`, orderNumber: order.orderNumber,
      })
      assert.equal(created.status, 201)
      agents.push({ agent, id: created.body.data.review.id })
    }
    // Still pending → product untouched.
    let prod = await Product.findOne({ slug: 'agg-kurta' }).lean()
    assert.equal(prod.reviewCount, 0)
    assert.equal(prod.rating, 0)

    await admin.patch(`/api/admin/reviews/${agents[0].id}/status`).send({ status: 'approved' })
    await admin.patch(`/api/admin/reviews/${agents[1].id}/status`).send({ status: 'approved' })
    prod = await Product.findOne({ slug: 'agg-kurta' }).lean()
    assert.equal(prod.reviewCount, 2)
    assert.equal(prod.rating, 4)

    // Owner deletes one approved review → stats drop.
    assert.equal((await agents[0].agent.delete(`/api/reviews/${agents[0].id}`)).status, 200)
    prod = await Product.findOne({ slug: 'agg-kurta' }).lean()
    assert.equal(prod.reviewCount, 1)
    assert.equal(prod.rating, 3)

    // Admin deletes the last approved review → 0/0, never negative.
    assert.equal((await admin.delete(`/api/admin/reviews/${agents[1].id}`)).status, 200)
    prod = await Product.findOne({ slug: 'agg-kurta' }).lean()
    assert.equal(prod.reviewCount, 0)
    assert.equal(prod.rating, 0)
    const pub = await request(app).get('/api/products/agg-kurta/reviews')
    assert.equal(pub.body.data.summary.count, 0)
  })
})

describe('regressions (storefront + admin untouched)', () => {
  it('product API: list + detail shape with rating/reviewCount', async () => {
    const list = await request(app).get('/api/products?limit=5')
    assert.equal(list.status, 200)
    assert.ok(Array.isArray(list.body.data))
    const detail = await request(app).get('/api/products/buy-kurta')
    assert.equal(detail.status, 200)
    assert.equal(typeof detail.body.data.rating, 'number')
    assert.equal(typeof detail.body.data.reviewCount, 'number')
    assert.equal(detail.body.data.name, 'Buy Kurta')
  })

  it('auth regression: register → login → me', async () => {
    const agent = request.agent(app)
    const reg = await agent.post('/api/auth/register').send({ name: 'Reg Test', email: 'regtest17@example.com', password: 'password123' })
    assert.equal(reg.status, 201)
    assert.equal((await agent.post('/api/auth/login').send({ email: 'regtest17@example.com', password: 'password123' })).status, 200)
    assert.equal((await agent.get('/api/auth/me')).status, 200)
  })

  it('cart regression: add → get', async () => {
    const agent = await registerAgent('cartreg17@example.com', 'Cart Reg')
    assert.equal((await agent.post('/api/cart/items').send({ productId: 'buy-kurta', size: 'M', qty: 1 })).status, 200)
    const get = await agent.get('/api/cart')
    assert.equal(get.status, 200)
    assert.ok(get.body.data.items.length >= 1)
  })

  it('wishlist regression: add → get', async () => {
    const agent = await registerAgent('wishreg17@example.com', 'Wish Reg')
    assert.equal((await agent.post('/api/wishlist/items/buy-kurta')).status, 200)
    const get = await agent.get('/api/wishlist')
    assert.equal(get.status, 200)
    assert.ok(get.body.data.ids.includes('buy-kurta'))
  })

  it('checkout → delivered (admin) → review works end-to-end', async () => {
    const agent = await registerAgent('e2e17@example.com', 'E2E User')
    await agent.post('/api/cart/items').send({ productId: 'buy-kurta', size: 'M', qty: 1 })
    const created = await agent.post('/api/orders').send({
      customer: { ...CUSTOMER, email: 'e2e17@example.com' },
      shipping: SHIPPING,
      deliveryMethod: 'standard',
      paymentMethod: 'cod',
    })
    assert.equal(created.status, 201)
    const num = created.body.data.order.orderNumber
    // Not delivered yet → review rejected.
    assert.equal(
      (await agent.post('/api/products/buy-kurta/reviews').send({ ...GOOD_REVIEW, orderNumber: num })).status,
      403,
    )
    const admin = await makeAdmin('e2eadmin17@example.com')
    for (const s of ['processing', 'shipped', 'delivered']) {
      const r = await admin.patch(`/api/admin/orders/${num}/status`).send({ status: s })
      assert.equal(r.status, 200)
    }
    const review = await agent
      .post('/api/products/buy-kurta/reviews')
      .send({ ...GOOD_REVIEW, orderNumber: num })
    assert.equal(review.status, 201)
  })

  it('razorpay regression: 503 unconfigured / 401 bad signature / 400 bad webhook', async () => {
    const agent = await registerAgent('payreg17@example.com', 'Pay Reg')
    await agent.post('/api/cart/items').send({ productId: 'buy-kurta', size: 'M', qty: 1 })
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
      customer: { ...CUSTOMER, email: 'payreg17@example.com' },
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

  it('admin regression: dashboard + products + customers', async () => {
    const admin = await makeAdmin('regadmin17@example.com')
    assert.equal((await admin.get('/api/admin/dashboard')).status, 200)
    assert.equal((await admin.get('/api/admin/products')).status, 200)
    assert.equal((await admin.get('/api/admin/customers')).status, 200)
    assert.equal((await admin.get('/api/admin/reviews')).status, 200)
  })
})
