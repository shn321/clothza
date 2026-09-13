/* CLOTHZA Step 31 — customer notifications + order status updates.
   Covers: owner-scoped fetch/read/read-all, guest rejection, cross-user
   isolation, COD + demo copy, the full admin status walk with spec
   wording, same-status/retried-request dedup, order linkage, unread
   counts and payload safety.
   Runs against an isolated in-memory MongoDB; no external services. */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.JWT_SECRET = 'test-jwt-secret-for-step31-suite'
process.env.JWT_EXPIRES_IN = '7d'
process.env.RAZORPAY_KEY_ID = 'test_key'
process.env.RAZORPAY_KEY_SECRET = 'test_secret'
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret'

const { createApp } = await import('../src/app.js')
const User = (await import('../src/models/User.js')).default
const Product = (await import('../src/models/Product.js')).default
const Notification = (await import('../src/models/Notification.js')).default

let mongod
let app
let seq = 0

const CUSTOMER = {
  firstName: 'Kabir',
  lastName: 'Menon',
  email: 'kabir.menon@example.com',
  phone: '+919876543210',
}
const SHIPPING = {
  address: '9 Palm Grove',
  apartment: '',
  city: 'Kochi',
  state: 'Kerala',
  pin: '682001',
  country: 'India',
}

function nextEmail(prefix) {
  seq += 1
  return `${prefix}-${seq}@example.com`
}

async function registerAgent(email, name = 'Step31 User') {
  const agent = request.agent(app)
  const res = await agent
    .post('/api/auth/register')
    .send({ name, email, password: 'password123' })
  assert.equal(res.status, 201, `register failed for ${email}: ${res.text}`)
  return agent
}

async function makeAdmin(email) {
  const agent = await registerAgent(email, 'Step31 Admin')
  await User.updateOne({ email }, { $set: { role: 'admin' } })
  return agent
}

async function placeCodOrder(agent, email, slug) {
  await agent.post('/api/cart/items').send({ productId: slug, qty: 1 })
  const res = await agent.post('/api/orders').send({
    customer: { ...CUSTOMER, email },
    shipping: SHIPPING,
    deliveryMethod: 'standard',
    paymentMethod: 'cod',
  })
  assert.equal(res.status, 201, res.text)
  return res.body.data.order
}

async function notificationsOf(agent) {
  const res = await agent.get('/api/notifications')
  assert.equal(res.status, 200, res.text)
  return res.body.data
}

async function countType(userEmail, type, orderNumber) {
  const user = await User.findOne({ email: userEmail }).lean()
  return Notification.countDocuments({ user: user._id, type, orderNumber })
}

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri('clothza-step31-test')
  process.env.MONGODB_URI = uri
  await mongoose.connect(uri)
  app = createApp()
  await Product.create({
    slug: 's31-kurta',
    name: 'Step31 Kurta',
    description: 'Step-31 notification test product.',
    price: 1000,
    category: 'kurtas',
    gender: 'men',
    images: [],
    colors: [],
    sizes: [],
    stock: 100,
    tags: [],
  })
})

after(async () => {
  await mongoose.disconnect().catch(() => {})
  await mongod?.stop()
})

describe('1–2. fetch own notifications; guests rejected', () => {
  it('authenticated user fetches own notifications, newest first', async () => {
    const agent = await registerAgent(nextEmail('s31-fetch'))
    const data = await notificationsOf(agent)
    assert.ok(Array.isArray(data.notifications))
    assert.equal(typeof data.unreadCount, 'number')
    assert.ok(data.pagination)
  })

  it('guest cannot list, read or mark-all → 401', async () => {
    const anon = request(app)
    assert.equal((await anon.get('/api/notifications')).status, 401)
    assert.equal((await anon.patch('/api/notifications/read-all')).status, 401)
    assert.equal(
      (await anon.patch('/api/notifications/000000000000000000000001/read')).status,
      401,
    )
  })
})

describe('3–6. ownership, read, read-all', () => {
  it('users never see each other’s notifications; foreign reads → 404', async () => {
    const emailA = nextEmail('s31-ownerA')
    const agentA = await registerAgent(emailA)
    await placeCodOrder(agentA, emailA, 's31-kurta')
    const mineA = await notificationsOf(agentA)
    assert.ok(mineA.notifications.length > 0)
    const foreignId = mineA.notifications[0].id

    const agentB = await registerAgent(nextEmail('s31-ownerB'))
    const mineB = await notificationsOf(agentB)
    assert.ok(!mineB.notifications.some((n) => n.id === foreignId))
    // 5. marking another user's notification is rejected (same 404, no leak).
    assert.equal((await agentB.patch(`/api/notifications/${foreignId}/read`)).status, 404)
    assert.equal(
      (await agentB.delete(`/api/notifications/${foreignId}`)).status,
      404,
    )
  })

  it('4. mark own notification as read works', async () => {
    const email = nextEmail('s31-read')
    const agent = await registerAgent(email)
    await placeCodOrder(agent, email, 's31-kurta')
    const before = await notificationsOf(agent)
    assert.ok(before.unreadCount >= 1)
    const target = before.notifications.find((n) => !n.isRead)
    const res = await agent.patch(`/api/notifications/${target.id}/read`)
    assert.equal(res.status, 200)
    assert.equal(res.body.data.notification.isRead, true)
    const after = await notificationsOf(agent)
    assert.equal(after.unreadCount, before.unreadCount - 1)
  })

  it('6. mark all as read works', async () => {
    const email = nextEmail('s31-readall')
    const agent = await registerAgent(email)
    await placeCodOrder(agent, email, 's31-kurta')
    const before = await notificationsOf(agent)
    assert.ok(before.unreadCount >= 1)
    const res = await agent.patch('/api/notifications/read-all')
    assert.equal(res.status, 200)
    assert.equal(res.body.data.unreadCount, 0)
    const after = await notificationsOf(agent)
    assert.equal(after.unreadCount, 0)
    assert.ok(after.notifications.every((n) => n.isRead))
  })
})

describe('7+15. COD order creates the COD notification', () => {
  it('ORDER_PLACED carries Cash on Delivery copy + correct order link', async () => {
    const email = nextEmail('s31-codcopy')
    const agent = await registerAgent(email)
    const order = await placeCodOrder(agent, email, 's31-kurta')
    const data = await notificationsOf(agent)
    const placed = data.notifications.find((n) => n.type === 'ORDER_PLACED')
    assert.ok(placed, 'expected ORDER_PLACED notification')
    assert.match(placed.message, /Cash on Delivery/i)
    assert.match(placed.message, /placed successfully/i)
    // 17. notification links to the correct order.
    assert.equal(placed.orderNumber, order.orderNumber)
    assert.ok(placed.title)
    assert.ok(placed.createdAt)
  })
})

describe('8–14. admin status walk creates each notification; no duplicates', () => {
  it('Confirmed → Processing → Shipped → Delivered with spec wording', async () => {
    const email = nextEmail('s31-walk')
    const shopper = await registerAgent(email)
    const admin = await makeAdmin(nextEmail('s31-walkadmin'))
    const order = await placeCodOrder(shopper, email, 's31-kurta')
    const num = order.orderNumber

    const expectations = [
      ['confirmed', 'ORDER_CONFIRMED', 'Order Confirmed', /has been confirmed/i],
      ['processing', 'ORDER_PROCESSING', 'Order Processing', /being prepared/i],
      ['shipped', 'ORDER_SHIPPED', 'Order Shipped', /has been shipped/i],
      ['delivered', 'ORDER_DELIVERED', 'Order Delivered', /has been delivered/i],
    ]
    for (const [status, type, title, messageRe] of expectations) {
      const res = await admin.patch(`/api/admin/orders/${num}/status`).send({ status })
      assert.equal(res.status, 200, res.text)
      assert.equal(await countType(email, type, num), 1)
      const data = await notificationsOf(shopper)
      const note = data.notifications.find((n) => n.type === type && n.orderNumber === num)
      assert.ok(note, `expected ${type} notification`)
      assert.equal(note.title, title)
      assert.match(note.message, messageRe)
      assert.match(note.message, new RegExp(num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }

    // 9. re-saving the final status changes nothing and notifies nothing.
    const before = await countType(email, 'ORDER_DELIVERED', num)
    const repeat = await admin.patch(`/api/admin/orders/${num}/status`).send({ status: 'delivered' })
    assert.equal(repeat.status, 200)
    assert.equal(await countType(email, 'ORDER_DELIVERED', num), before)

    // 18. unread count reflects every lifecycle notification.
    const data = await notificationsOf(shopper)
    assert.ok(data.unreadCount >= 5)
  })

  it('13. cancelled notification on customer cancel', async () => {
    const email = nextEmail('s31-cancelcopy')
    const shopper = await registerAgent(email)
    const order = await placeCodOrder(shopper, email, 's31-kurta')
    const res = await shopper.patch(`/api/orders/${order.orderNumber}/cancel`).send({})
    assert.equal(res.status, 200)
    assert.equal(await countType(email, 'ORDER_CANCELLED', order.orderNumber), 1)
    const data = await notificationsOf(shopper)
    const note = data.notifications.find((n) => n.type === 'ORDER_CANCELLED')
    assert.ok(note)
    assert.equal(note.title, 'Order Cancelled')
    assert.match(note.message, /has been cancelled/i)
  })
})

describe('16. demo payment success notification', () => {
  it('PAYMENT_SUCCESS carries demo copy for simulated payments', async () => {
    const email = nextEmail('s31-democopy')
    const agent = await registerAgent(email)
    await agent.post('/api/cart/items').send({ productId: 's31-kurta', qty: 1 })
    const quote = await agent.post('/api/payments/demo/order').send({ deliveryMethod: 'standard' })
    assert.equal(quote.status, 201, quote.text)
    const confirm = await agent.post('/api/payments/demo/confirm').send({
      demoSessionId: quote.body.data.demoSessionId,
      customer: { ...CUSTOMER, email },
      shipping: SHIPPING,
    })
    assert.equal(confirm.status, 201, confirm.text)
    const num = confirm.body.data.order.orderNumber

    const data = await notificationsOf(agent)
    const paid = data.notifications.find((n) => n.type === 'PAYMENT_SUCCESS' && n.orderNumber === num)
    assert.ok(paid, 'expected demo PAYMENT_SUCCESS notification')
    assert.equal(paid.title, 'Demo payment successful')
    assert.match(paid.message, /demo payment/i)
    assert.match(paid.message, new RegExp(num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })
})

describe('security + payload safety', () => {
  it('notifications expose no secrets and order links stay owner-scoped', async () => {
    const email = nextEmail('s31-safe')
    const agent = await registerAgent(email)
    const order = await placeCodOrder(agent, email, 's31-kurta')
    const data = await notificationsOf(agent)
    assert.ok(data.notifications.length > 0)
    const blob = JSON.stringify(data)
    assert.doesNotMatch(blob, /passwordHash/i)
    assert.doesNotMatch(blob, /razorpay.*secret|jwt.*secret/i)
    // The linked order resolves for the owner…
    assert.equal((await agent.get(`/api/orders/${order.orderNumber}`)).status, 200)
    // …but not for a stranger (order IDs cannot leak across accounts).
    const stranger = await registerAgent(nextEmail('s31-safestranger'))
    assert.equal((await stranger.get(`/api/orders/${order.orderNumber}`)).status, 404)
  })
})
