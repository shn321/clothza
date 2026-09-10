/* CLOTHZA Step 19 tests — notifications & transactional email + full
   regression. Runs against an isolated in-memory MongoDB.
   Email uses EMAIL_PROVIDER=test (in-memory outbox, no network) or is
   left unconfigured (safe skip). Razorpay success paths are exercised
   offline: attempts are seeded directly and responses are signed with
   the test HMAC secrets — the gateway network is never touched. */

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.JWT_SECRET = 'test-jwt-secret-for-notification-suite'
process.env.JWT_EXPIRES_IN = '7d'
process.env.RAZORPAY_KEY_ID = 'test_key'
process.env.RAZORPAY_KEY_SECRET = 'test_secret'
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret'
delete process.env.EMAIL_PROVIDER
delete process.env.SMTP_PASSWORD

const { createApp } = await import('../src/app.js')
const User = (await import('../src/models/User.js')).default
const Product = (await import('../src/models/Product.js')).default
const Order = (await import('../src/models/Order.js')).default
const Coupon = (await import('../src/models/Coupon.js')).default
const Review = (await import('../src/models/Review.js')).default
const Notification = (await import('../src/models/Notification.js')).default
const PaymentAttempt = (await import('../src/models/PaymentAttempt.js')).default
const { createNotification } = await import('../src/services/notificationService.js')
const { sendEmail, getTestOutbox, clearTestOutbox } = await import('../src/services/emailService.js')
const { orderPlacedEmail } = await import('../src/services/emailTemplates.js')

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

function nextId(prefix) {
  seq += 1
  return `${prefix}-${seq}`
}

function productDoc(overrides = {}) {
  const slug = nextId('notif-kurta')
  return {
    slug,
    name: `Notif Kurta ${seq}`,
    description: 'A kurta for notification tests.',
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

async function shopperWithProduct(email, productOverrides = {}, qty = 1) {
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

function signPayment(orderId, paymentId) {
  return crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')
}

/* Seed a pending gateway attempt directly (no gateway network). */
async function seedAttempt(email, slug, { total = 1000, withContact = true } = {}) {
  const user = await User.findOne({ email })
  assert.ok(user, `no user ${email}`)
  return PaymentAttempt.create({
    user: user._id,
    razorpayOrderId: `order_${nextId('rzp')}`,
    receipt: `clz-test-${seq}`,
    amountPaise: total * 100,
    currency: 'INR',
    items: [{ productId: slug, size: 'M', colour: null, qty: 1 }],
    subtotal: total,
    shippingCost: 0,
    total,
    deliveryMethod: 'standard',
    paymentMethod: 'card',
    customer: withContact ? { ...CUSTOMER, email } : { firstName: '', lastName: '', email: '', phone: '' },
    shippingAddress: withContact ? SHIPPING : { address: '', apartment: '', city: '', state: '', pin: '', country: '' },
    status: 'pending',
  })
}

/* Capture console output during fn (for secret-leak assertions). */
async function captureConsole(fn) {
  const out = []
  const methods = ['log', 'error', 'warn', 'info', 'debug']
  const originals = methods.map((m) => console[m])
  methods.forEach((m) => {
    console[m] = (...args) => {
      out.push(args.map((a) => { try { return String(a) } catch { return '' } }).join(' '))
    }
  })
  try {
    const result = await fn()
    return { out: out.join('\n'), result }
  } finally {
    methods.forEach((m, i) => {
      console[m] = originals[i]
    })
  }
}

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri('clothza-notification-test')
  process.env.MONGODB_URI = uri
  await mongoose.connect(uri)
  app = createApp()
})

after(async () => {
  await mongoose.disconnect().catch(() => {})
  await mongod?.stop()
})

describe('notification API authorization + ownership', () => {
  it('unauthenticated → 401 on every endpoint', async () => {
    const anon = request(app)
    const id = new mongoose.Types.ObjectId()
    assert.equal((await anon.get('/api/notifications')).status, 401)
    assert.equal((await anon.patch(`/api/notifications/${id}/read`)).status, 401)
    assert.equal((await anon.patch('/api/notifications/read-all')).status, 401)
    assert.equal((await anon.delete(`/api/notifications/${id}`)).status, 401)
    assert.equal((await anon.delete('/api/notifications')).status, 401)
  })

  it('cross-user access → 404 (no leak, no mutation)', async () => {
    const alice = await registerAgent('notif-alice@example.com', 'Alice')
    const bob = await registerAgent('notif-bob@example.com', 'Bob')
    const aliceUser = await User.findOne({ email: 'notif-alice@example.com' })
    const note = await createNotification({
      userId: aliceUser._id,
      type: 'SYSTEM',
      title: 'Private',
      message: 'For Alice only.',
    })
    assert.equal((await bob.get('/api/notifications')).status, 200)
    const list = await bob.get('/api/notifications')
    assert.ok(!list.body.data.notifications.some((n) => n.id === String(note._id)))
    assert.equal((await bob.patch(`/api/notifications/${note._id}/read`)).status, 404)
    assert.equal((await bob.delete(`/api/notifications/${note._id}`)).status, 404)
    const stillThere = await Notification.findById(note._id).lean()
    assert.ok(stillThere, 'bob must not delete alice notification')
    assert.equal(stillThere.isRead, false, 'bob must not mark alice notification read')
  })

  it('malformed id → 404', async () => {
    const agent = await registerAgent('notif-badid@example.com')
    assert.equal((await agent.patch('/api/notifications/nope/read')).status, 404)
    assert.equal((await agent.delete('/api/notifications/nope')).status, 404)
  })
})

describe('notification shelf behavior', () => {
  it('list newest-first + unreadCount + unread filter + pagination', async () => {
    const email = 'notif-shelf@example.com'
    await registerAgent(email, 'Shelf')
    const user = await User.findOne({ email })
    for (let i = 1; i <= 25; i += 1) {
      await createNotification({
        userId: user._id,
        type: 'SYSTEM',
        title: `Note ${String(i).padStart(2, '0')}`,
        message: `Message ${i}`,
      })
    }
    const agent = request.agent(app)
    await agent.post('/api/auth/login').send({ email, password: 'password123' })

    const page1 = await agent.get('/api/notifications?limit=10')
    assert.equal(page1.status, 200)
    assert.equal(page1.body.data.notifications.length, 10)
    assert.equal(page1.body.data.unreadCount, 25)
    assert.equal(page1.body.data.pagination.total, 25)
    assert.equal(page1.body.data.pagination.pages, 3)
    assert.equal(page1.body.data.notifications[0].title, 'Note 25')

    const page3 = await agent.get('/api/notifications?page=3&limit=10')
    assert.equal(page3.body.data.notifications.length, 5)

    const unread = await agent.get('/api/notifications?unread=true&limit=50')
    assert.equal(unread.body.data.notifications.length, 25)

    await agent.patch('/api/notifications/read-all')
    const none = await agent.get('/api/notifications?unread=true&limit=50')
    assert.equal(none.body.data.notifications.length, 0)
    assert.equal(none.body.data.unreadCount, 0)
  })

  it('mark one read → unreadCount drops; delete → gone; clear → empty', async () => {
    const email = 'notif-mutate@example.com'
    await registerAgent(email, 'Mutate')
    const user = await User.findOne({ email })
    const a = await createNotification({ userId: user._id, type: 'SYSTEM', title: 'A', message: 'a' })
    await createNotification({ userId: user._id, type: 'SYSTEM', title: 'B', message: 'b' })
    const agent = request.agent(app)
    await agent.post('/api/auth/login').send({ email, password: 'password123' })

    const read = await agent.patch(`/api/notifications/${a._id}/read`)
    assert.equal(read.status, 200)
    assert.equal(read.body.data.notification.isRead, true)
    const afterRead = await agent.get('/api/notifications')
    assert.equal(afterRead.body.data.unreadCount, 1)

    const del = await agent.delete(`/api/notifications/${a._id}`)
    assert.equal(del.status, 200)
    assert.equal((await Notification.findById(a._id).lean()), null)

    const clear = await agent.delete('/api/notifications')
    assert.equal(clear.status, 200)
    assert.equal(clear.body.data.deleted, 1)
    const empty = await agent.get('/api/notifications')
    assert.equal(empty.body.data.pagination.total, 0)
    assert.equal(empty.body.data.unreadCount, 0)
  })
})

describe('order lifecycle notifications', () => {
  it('COD order → ORDER_PLACED notification for the owner', async () => {
    const email = 'notif-placed@example.com'
    const { agent } = await shopperWithProduct(email, { price: 1200 })
    const res = await placeCodOrder(agent, email)
    assert.equal(res.status, 201, res.text)
    const notes = await Notification.find({ user: (await User.findOne({ email }))._id }).lean()
    assert.equal(notes.length, 1)
    assert.equal(notes[0].type, 'ORDER_PLACED')
    assert.equal(notes[0].orderNumber, res.body.data.order.orderNumber)
    assert.equal(notes[0].isRead, false)
    const list = await agent.get('/api/notifications')
    assert.equal(list.body.data.unreadCount, 1)
  })

  it('verified Razorpay payment → ORDER_PLACED + PAYMENT_SUCCESS (replay silent)', async () => {
    process.env.EMAIL_PROVIDER = 'test'
    clearTestOutbox()
    try {
      const email = 'notif-paysuccess@example.com'
      const { agent, product } = await shopperWithProduct(email, { price: 1500 })
      const attempt = await seedAttempt(email, product.slug, { total: 1500 })
      const paymentId = `pay_${nextId('p')}`
      const res = await agent.post('/api/payments/razorpay/verify').send({
        razorpay_order_id: attempt.razorpayOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signPayment(attempt.razorpayOrderId, paymentId),
        customer: { ...CUSTOMER, email },
        shipping: SHIPPING,
      })
      assert.equal(res.status, 201, res.text)
      const user = await User.findOne({ email })
      const types = (await Notification.find({ user: user._id }).lean()).map((n) => n.type).sort()
      assert.deepEqual(types, ['ORDER_PLACED', 'PAYMENT_SUCCESS'])
      const subjects = getTestOutbox().map((m) => m.subject)
      assert.ok(subjects.some((s) => s.includes(res.body.data.order.orderNumber)))
      assert.ok(subjects.some((s) => /payment received/i.test(s)))

      // Replay with the same signed response → existing order, no new notifications.
      const replay = await agent.post('/api/payments/razorpay/verify').send({
        razorpay_order_id: attempt.razorpayOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signPayment(attempt.razorpayOrderId, paymentId),
        customer: { ...CUSTOMER, email },
        shipping: SHIPPING,
      })
      assert.equal(replay.status, 200)
      assert.equal(replay.body.data.replay, true)
      assert.equal(await Notification.countDocuments({ user: user._id }), 2)
    } finally {
      delete process.env.EMAIL_PROVIDER
      clearTestOutbox()
    }
  })

  it('dismissed payment (fail endpoint) → PAYMENT_FAILED once; retry silent', async () => {
    process.env.EMAIL_PROVIDER = 'test'
    clearTestOutbox()
    try {
      const email = 'notif-payfail@example.com'
      const { agent, product } = await shopperWithProduct(email, { price: 900 })
      const attempt = await seedAttempt(email, product.slug, { total: 900 })
      const first = await agent.post('/api/payments/razorpay/fail').send({
        razorpay_order_id: attempt.razorpayOrderId,
      })
      assert.equal(first.status, 200)
      assert.equal(first.body.data.status, 'failed')
      const user = await User.findOne({ email })
      assert.equal(await Notification.countDocuments({ user: user._id, type: 'PAYMENT_FAILED' }), 1)
      assert.equal(getTestOutbox().length, 1)
      assert.match(getTestOutbox()[0].subject, /did not go through/i)

      const second = await agent.post('/api/payments/razorpay/fail').send({
        razorpay_order_id: attempt.razorpayOrderId,
      })
      assert.equal(second.status, 200)
      assert.equal(await Notification.countDocuments({ user: user._id }), 1, 'retry must not duplicate')
      assert.equal(getTestOutbox().length, 1)
    } finally {
      delete process.env.EMAIL_PROVIDER
      clearTestOutbox()
    }
  })

  it('webhook payment.failed → transitions + notifies; replay silent', async () => {
    process.env.EMAIL_PROVIDER = 'test'
    clearTestOutbox()
    try {
      const email = 'notif-hookfail@example.com'
      const { product } = await shopperWithProduct(email, { price: 700 })
      const attempt = await seedAttempt(email, product.slug, { total: 700 })
      const payload = JSON.stringify({
        event: 'payment.failed',
        payload: { payment: { entity: { order_id: attempt.razorpayOrderId, id: 'pay_x' } } },
      })
      const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(payload).digest('hex')
      const send = () => request(app)
        .post('/api/payments/razorpay/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', sig)
        .send(payload)
      assert.equal((await send()).status, 200)
      const user = await User.findOne({ email })
      assert.equal(await Notification.countDocuments({ user: user._id, type: 'PAYMENT_FAILED' }), 1)
      assert.equal((await send()).status, 200)
      assert.equal(await Notification.countDocuments({ user: user._id }), 1, 'webhook replay must stay silent')
    } finally {
      delete process.env.EMAIL_PROVIDER
      clearTestOutbox()
    }
  })

  it('webhook payment.captured → paid order + ORDER_PLACED + PAYMENT_SUCCESS', async () => {
    const email = 'notif-hookpaid@example.com'
    const { product } = await shopperWithProduct(email, { price: 1100 })
    const attempt = await seedAttempt(email, product.slug, { total: 1100 })
    const payload = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: attempt.razorpayOrderId, id: `pay_${nextId('w')}` } } },
    })
    const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(payload).digest('hex')
    const res = await request(app)
      .post('/api/payments/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sig)
      .send(payload)
    assert.equal(res.status, 200)
    const user = await User.findOne({ email })
    const notes = await Notification.find({ user: user._id }).lean()
    assert.ok(notes.some((n) => n.type === 'ORDER_PLACED'))
    assert.ok(notes.some((n) => n.type === 'PAYMENT_SUCCESS'))
    assert.ok(await Order.findOne({ user: user._id, paymentStatus: 'paid' }).lean())
  })

  it('user cancel → ORDER_CANCELLED; admin walk → one notification per real change, no dup on repeat', async () => {
    process.env.EMAIL_PROVIDER = 'test'
    clearTestOutbox()
    try {
      const email = 'notif-status@example.com'
      const { agent, product } = await shopperWithProduct(email, { price: 1300 })
      void product
      const created = await placeCodOrder(agent, email)
      assert.equal(created.status, 201, created.text)
      const orderNumber = created.body.data.order.orderNumber
      const admin = await makeAdmin('notif-status-admin@example.com')
      const user = await User.findOne({ email })
      const count = () => Notification.countDocuments({ user: user._id })

      for (const status of ['confirmed', 'processing', 'shipped', 'delivered']) {
        const res = await admin.patch(`/api/admin/orders/${orderNumber}/status`).send({ status })
        assert.equal(res.status, 200, `${status}: ${res.text}`)
      }
      // Repeat the terminal state — accepted but must not duplicate.
      const repeat = await admin.patch(`/api/admin/orders/${orderNumber}/status`).send({ status: 'delivered' })
      assert.equal(repeat.status, 200)
      const notes = await Notification.find({ user: user._id }).lean()
      const types = notes.map((n) => n.type).sort()
      assert.deepEqual(types, ['ORDER_CONFIRMED', 'ORDER_DELIVERED', 'ORDER_PLACED', 'ORDER_PROCESSING', 'ORDER_SHIPPED'])
      assert.equal(await count(), 5)

      // Shipped + delivered + cancelled emails captured; confirmed/processing notify only.
      const subjects = getTestOutbox().map((m) => m.subject).join('\n')
      assert.match(subjects, /shipped/i)
      assert.match(subjects, /delivered/i)

      // Separate order cancelled by the shopper.
      await agent.post('/api/cart/items').send({ productId: created.body.data.order.items[0].productId, size: 'M', qty: 1 })
      const second = await placeCodOrder(agent, email)
      assert.equal(second.status, 201, second.text)
      const cancelled = await agent.patch(`/api/orders/${second.body.data.order.orderNumber}/cancel`)
      assert.equal(cancelled.status, 200)
      assert.ok(await Notification.findOne({ user: user._id, type: 'ORDER_CANCELLED' }).lean())
      assert.match(getTestOutbox().map((m) => m.subject).join('\n'), /cancelled/i)
    } finally {
      delete process.env.EMAIL_PROVIDER
      clearTestOutbox()
    }
  })
})

describe('email service safety', () => {
  it('unconfigured → skipped, never throws, order still succeeds with notification', async () => {
    delete process.env.EMAIL_PROVIDER
    const direct = await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' })
    assert.equal(direct.sent, false)
    assert.equal(direct.skipped, true)

    const email = 'notif-nomail@example.com'
    const { agent } = await shopperWithProduct(email, { price: 1000 })
    const res = await placeCodOrder(agent, email)
    assert.equal(res.status, 201, res.text)
    const user = await User.findOne({ email })
    assert.equal(await Notification.countDocuments({ user: user._id, type: 'ORDER_PLACED' }), 1)
  })

  it('SMTP failure (refused connection) does not break the order', async () => {
    process.env.EMAIL_PROVIDER = 'smtp'
    process.env.EMAIL_FROM = 'CLOTHZA <no-reply@clothza.test>'
    process.env.SMTP_HOST = '127.0.0.1'
    process.env.SMTP_PORT = '1'
    process.env.SMTP_USER = 'clothza-smtp-user'
    process.env.SMTP_PASSWORD = 'sentinel-smtp-secret-xyz'
    try {
      const direct = await sendEmail({ to: 'b@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' })
      assert.equal(direct.sent, false)
      assert.ok(direct.error)

      const email = 'notif-smtpfail@example.com'
      const { agent } = await shopperWithProduct(email, { price: 1000 })
      const { out, result } = await captureConsole(() => placeCodOrder(agent, email))
      assert.equal(result.status, 201, result.text)
      assert.ok(!out.includes('sentinel-smtp-secret-xyz'), 'logs must not contain SMTP secret')
      assert.ok(!JSON.stringify(result.body).includes('sentinel-smtp-secret-xyz'))
      const user = await User.findOne({ email })
      assert.equal(await Notification.countDocuments({ user: user._id }), 1)
    } finally {
      delete process.env.EMAIL_PROVIDER
      delete process.env.EMAIL_FROM
      delete process.env.SMTP_HOST
      delete process.env.SMTP_PORT
      delete process.env.SMTP_USER
      delete process.env.SMTP_PASSWORD
    }
  })

  it('test provider captures branded email; no card/CVV secrets; responses never leak credentials', async () => {
    process.env.EMAIL_PROVIDER = 'test'
    process.env.EMAIL_FROM = 'CLOTHZA <no-reply@clothza.test>'
    process.env.SMTP_PASSWORD = 'sentinel-smtp-secret-xyz'
    clearTestOutbox()
    try {
      const email = 'notif-branded@example.com'
      const { agent } = await shopperWithProduct(email, { price: 2000 })
      const res = await placeCodOrder(agent, email)
      assert.equal(res.status, 201, res.text)
      assert.equal(getTestOutbox().length, 1)
      const mail = getTestOutbox()[0]
      assert.equal(mail.to, email)
      assert.ok(mail.subject.includes(res.body.data.order.orderNumber))
      assert.match(mail.html, /CLOTHZA/)
      assert.match(mail.html, /2,000/)
      assert.ok(mail.text.length > 50, 'plain-text fallback required')
      const blob = `${mail.subject}\n${mail.html}\n${mail.text}`.toLowerCase()
      assert.ok(!blob.includes('cvv') && !blob.includes('card number') && !blob.includes('sentinel-smtp-secret'))
      assert.ok(!JSON.stringify(res.body).includes('sentinel-smtp-secret'))
      const tpl = orderPlacedEmail(res.body.data.order)
      assert.ok(tpl.subject && tpl.html.includes('CLOTHZA') && tpl.text.length > 50)
    } finally {
      delete process.env.EMAIL_PROVIDER
      delete process.env.EMAIL_FROM
      delete process.env.SMTP_PASSWORD
      clearTestOutbox()
    }
  })

  it('legacy users without the preference field are treated as opted-in', async () => {
    const bcrypt = (await import('bcryptjs')).default
    const email = 'notif-legacy@example.com'
    const passwordHash = await bcrypt.hash('password123', 10)
    /* Bypass Mongoose defaults to mimic a pre-Step-19 document. */
    await User.collection.insertOne({
      name: 'Legacy User',
      email,
      passwordHash,
      role: 'user',
      avatar: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const stored = await User.findOne({ email }).lean()
    assert.equal(stored.emailNotifications, undefined)
    const agent = request.agent(app)
    const login = await agent.post('/api/auth/login').send({ email, password: 'password123' })
    assert.equal(login.status, 200)
    process.env.EMAIL_PROVIDER = 'test'
    clearTestOutbox()
    try {
      const product = await Product.create(productDoc({ price: 800 }))
      await agent.post('/api/cart/items').send({ productId: product.slug, size: 'M', qty: 1 })
      const res = await placeCodOrder(agent, email)
      assert.equal(res.status, 201, res.text)
      assert.equal(getTestOutbox().length, 1, 'transactional mail must still send')
    } finally {
      delete process.env.EMAIL_PROVIDER
      clearTestOutbox()
    }
  })
})

describe('regressions (everything else untouched)', () => {
  it('auth regression: register → login → me (safe shape carries preference)', async () => {
    const agent = request.agent(app)
    const reg = await agent
      .post('/api/auth/register')
      .send({ name: 'Reg Test', email: 'notif-regtest@example.com', password: 'password123' })
    assert.equal(reg.status, 201)
    assert.equal(reg.body.data.user.emailNotifications, true)
    assert.ok(!JSON.stringify(reg.body).includes('passwordHash'))
    assert.equal((await agent.post('/api/auth/login').send({ email: 'notif-regtest@example.com', password: 'password123' })).status, 200)
    assert.equal((await agent.get('/api/auth/me')).status, 200)
  })

  it('product regression: list + detail + 404', async () => {
    await Product.create(productDoc({ slug: 'notif-shop-kurta', name: 'Notif Shop Kurta' }))
    assert.equal((await request(app).get('/api/products?limit=5')).status, 200)
    assert.equal((await request(app).get('/api/products/notif-shop-kurta')).status, 200)
    assert.equal((await request(app).get('/api/products/no-such-slug-xyz')).status, 404)
  })

  it('cart regression: add → get', async () => {
    const agent = await registerAgent('notif-cartreg@example.com', 'Cart Reg')
    await Product.create(productDoc({ slug: 'notif-cart-kurta', name: 'Notif Cart Kurta', stock: 20 }))
    assert.equal((await agent.post('/api/cart/items').send({ productId: 'notif-cart-kurta', size: 'M', qty: 1 })).status, 200)
    const get = await agent.get('/api/cart')
    assert.equal(get.status, 200)
    assert.ok(get.body.data.items.length >= 1)
  })

  it('wishlist regression: add → get', async () => {
    const agent = await registerAgent('notif-wishreg@example.com', 'Wish Reg')
    await Product.create(productDoc({ slug: 'notif-wish-kurta', name: 'Notif Wish Kurta' }))
    assert.equal((await agent.post('/api/wishlist/items/notif-wish-kurta')).status, 200)
    const get = await agent.get('/api/wishlist')
    assert.equal(get.status, 200)
    assert.ok(get.body.data.ids.includes('notif-wish-kurta'))
  })

  it('COD regression: plain order totals intact + notification created', async () => {
    const agent = await registerAgent('notif-codreg@example.com', 'COD Reg')
    await Product.create(productDoc({ slug: 'notif-cod-kurta', name: 'Notif COD Kurta', price: 1499, stock: 10 }))
    await agent.post('/api/cart/items').send({ productId: 'notif-cod-kurta', size: 'M', qty: 1 })
    const created = await placeCodOrder(agent, 'notif-codreg@example.com')
    assert.equal(created.status, 201, created.text)
    assert.equal(created.body.data.order.discount, 0)
    assert.equal(created.body.data.order.total, 1499)
    const user = await User.findOne({ email: 'notif-codreg@example.com' })
    assert.equal(await Notification.countDocuments({ user: user._id, type: 'ORDER_PLACED' }), 1)
    const num = created.body.data.order.orderNumber
    assert.equal((await agent.get('/api/orders')).status, 200)
    assert.equal((await agent.get(`/api/orders/${num}`)).status, 200)
  })

  it('coupon regression: validate → discounted order → notification, usage intact', async () => {
    const admin = await makeAdmin('notif-coupon-admin@example.com')
    const code = nextId('NTFCPN').toUpperCase()
    const day = 24 * 60 * 60 * 1000
    const created = await admin.post('/api/admin/coupons').send({
      code,
      description: 'notif test',
      discountType: 'percentage',
      discountValue: 10,
      startDate: new Date(Date.now() - day).toISOString(),
      expiryDate: new Date(Date.now() + day).toISOString(),
      perUserLimit: 5,
    })
    assert.equal(created.status, 201, created.text)
    const email = 'notif-couponshop@example.com'
    const { agent } = await shopperWithProduct(email, { price: 2000 })
    const v = await agent.post('/api/coupons/validate').send({ code })
    assert.equal(v.status, 200)
    assert.equal(v.body.data.discountAmount, 200)
    const order = await placeCodOrder(agent, email, { couponCode: code })
    assert.equal(order.status, 201, order.text)
    assert.equal(order.body.data.order.discount, 200)
    assert.equal(order.body.data.order.coupon.code, code)
    const user = await User.findOne({ email })
    assert.equal(await Notification.countDocuments({ user: user._id, type: 'ORDER_PLACED' }), 1)
    assert.equal((await Coupon.findOne({ code }).lean()).usageCount, 1)
  })

  it('razorpay regression: 503 unconfigured / 401 bad signature / 400 bad webhook', async () => {
    const { agent } = await shopperWithProduct('notif-payreg@example.com', { price: 1200 })
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
      customer: { ...CUSTOMER, email: 'notif-payreg@example.com' },
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
    const product = await Product.create(productDoc({ slug: 'notif-review-kurta', name: 'Notif Review Kurta' }))
    const agent = await registerAgent('notif-buyer1@example.com', 'Buyer One')
    const user = await User.findOne({ email: 'notif-buyer1@example.com' })
    seq += 1
    const order = await Order.create({
      user: user._id,
      orderNumber: `CLZ-NT-${String(seq).padStart(4, '0')}`,
      items: [{
        product: product._id, productId: product.slug, slug: product.slug,
        name: product.name, image: '', price: product.price, size: 'M', colour: null, qty: 1,
      }],
      customer: { ...CUSTOMER, email: 'notif-buyer1@example.com' },
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
    assert.ok(await Review.findById(res.body.data.review.id).lean())
  })

  it('admin regression: dashboard + products + coupons + no private notification access', async () => {
    const admin = await makeAdmin('notif-dash-admin@example.com')
    assert.equal((await admin.get('/api/admin/dashboard')).status, 200)
    assert.equal((await admin.get('/api/admin/products')).status, 200)
    assert.equal((await admin.get('/api/admin/coupons')).status, 200)
    // No admin route exposes another user's notifications.
    assert.equal((await admin.get('/api/notifications')).status, 200)
    const shopperNotes = await Notification.countDocuments({})
    assert.ok(shopperNotes >= 0)
    const adminUser = await User.findOne({ email: 'notif-dash-admin@example.com' })
    const own = await admin.get('/api/notifications')
    assert.ok(own.body.data.notifications.every((n) => n && typeof n.id === 'string'))
    assert.equal(await Notification.countDocuments({ user: adminUser._id }), own.body.data.pagination.total)
  })
})
