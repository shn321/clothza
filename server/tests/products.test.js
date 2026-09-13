/* CLOTHZA Step 29 tests — admin product management.
   Runs against an isolated in-memory MongoDB; no external services. */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.JWT_SECRET = 'test-jwt-secret-for-products-suite'
process.env.JWT_EXPIRES_IN = '7d'

const { createApp } = await import('../src/app.js')
const User = (await import('../src/models/User.js')).default
const Product = (await import('../src/models/Product.js')).default
const Order = (await import('../src/models/Order.js')).default
const Review = (await import('../src/models/Review.js')).default
const { PRODUCTS } = await import('../../client/src/data/products.js')

let mongod
let app

const CUSTOMER = {
  firstName: 'Asha',
  lastName: 'Sharma',
  email: 'prod.shopper@example.com',
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

function productPayload(overrides = {}) {
  return {
    slug: 'admin-widget',
    name: 'Admin Widget',
    description: 'Managed via /admin/products.',
    price: 1999,
    originalPrice: 2499,
    discountPercentage: 20,
    category: 'men',
    subcategory: 'shirts',
    gender: 'men',
    images: ['https://example.com/widget.jpg'],
    colors: ['ivory'],
    sizes: ['M', 'L'],
    stock: 12,
    rating: 0,
    reviewCount: 0,
    tags: ['widget'],
    isFeatured: false,
    isBestSeller: false,
    isNewArrival: true,
    isPublished: true,
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

before(async () => {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri('clothza-products-test')
  process.env.MONGODB_URI = uri
  await mongoose.connect(uri)
  app = createApp()
})

after(async () => {
  await mongoose.disconnect().catch(() => {})
  await mongod?.stop()
})

describe('catalog source data (existing 24 products intact)', () => {
  it('client catalog still has 24 products with unique slugs', () => {
    assert.equal(PRODUCTS.length, 24)
    assert.equal(new Set(PRODUCTS.map((p) => p.slug)).size, 24)
  })

  it('seed upserts are idempotent (slug-keyed, no duplicates)', async () => {
    const first = PRODUCTS[0]
    const slug = String(first.slug).toLowerCase()
    const doc = { slug, name: first.name, price: first.price, category: first.category }
    const totalBefore = await Product.countDocuments()
    for (let i = 0; i < 2; i++) {
      await Product.updateOne({ slug }, { $set: doc }, { upsert: true })
    }
    // Exactly one document carries the slug, and the collection grew by
    // at most one (zero when the slug already existed).
    assert.equal((await Product.find({ slug }).lean()).length, 1)
    const totalAfter = await Product.countDocuments()
    assert.ok(totalAfter - totalBefore <= 1)
  })
})

describe('public product API (MongoDB source of truth)', () => {
  let admin
  before(async () => {
    admin = await makeAdmin('pubprod.admin@example.com')
    await admin.post('/api/admin/products').send(productPayload({ slug: 'public-tee', name: 'Public Tee' }))
    const base = productPayload({ slug: 'hidden-tee', name: 'Hidden Tee' })
    const created = await admin.post('/api/admin/products').send(base)
    assert.equal(created.status, 201)
    const unpub = await admin
      .patch(`/api/admin/products/${created.body.data._id}`)
      .send({ isPublished: false })
    assert.equal(unpub.status, 200)
  })

  it('public list shows published, hides unpublished', async () => {
    const res = await request(app).get('/api/products?limit=100')
    assert.equal(res.status, 200)
    const slugs = res.body.data.map((p) => p.slug)
    assert.ok(slugs.includes('public-tee'))
    assert.ok(!slugs.includes('hidden-tee'))
  })

  it('public detail: published → 200, unpublished → 404', async () => {
    const ok = await request(app).get('/api/products/public-tee')
    assert.equal(ok.status, 200)
    const hidden = await request(app).get('/api/products/hidden-tee')
    assert.equal(hidden.status, 404)
  })

  it('search + category + gender filters work', async () => {
    const q = await request(app).get('/api/products?q=Public%20Tee')
    assert.equal(q.status, 200)
    assert.ok(q.body.data.some((p) => p.slug === 'public-tee'))
    const cat = await request(app).get('/api/products?category=men')
    assert.equal(cat.status, 200)
    assert.ok(cat.body.data.every((p) => p.category === 'men'))
    const gen = await request(app).get('/api/products?gender=women')
    assert.equal(gen.status, 200)
    assert.ok(gen.body.data.every((p) => p.gender === 'women'))
  })

  it('invalid gender → 400; unknown slug → 404', async () => {
    const bad = await request(app).get('/api/products?gender=alien')
    assert.equal(bad.status, 400)
    const missing = await request(app).get('/api/products/no-such-product-xyz')
    assert.equal(missing.status, 404)
  })
})

describe('admin product authorization', () => {
  it('anonymous create/patch/delete → 401', async () => {
    const anon = request(app)
    assert.equal((await anon.post('/api/admin/products').send(productPayload())).status, 401)
    assert.equal((await anon.patch('/api/admin/products/x').send({ price: 1 })).status, 401)
    assert.equal((await anon.delete('/api/admin/products/x')).status, 401)
  })

  it('non-admin create/patch/delete → 403', async () => {
    const user = await registerAgent('prod.user@example.com')
    assert.equal((await user.post('/api/admin/products').send(productPayload())).status, 403)
    assert.equal((await user.patch('/api/admin/products/x').send({ price: 1 })).status, 403)
    assert.equal((await user.delete('/api/admin/products/x')).status, 403)
  })
})

describe('admin product CRUD + publish lifecycle', () => {
  let admin
  before(async () => {
    admin = await makeAdmin('crud.admin@example.com')
  })

  it('create → 201 and visible on storefront', async () => {
    const res = await admin.post('/api/admin/products').send(productPayload({ slug: 'crud-kurta', name: 'Crud Kurta' }))
    assert.equal(res.status, 201)
    assert.equal(res.body.data.slug, 'crud-kurta')
    assert.equal(res.body.data.isPublished, true)
    const pub = await request(app).get('/api/products/crud-kurta')
    assert.equal(pub.status, 200)
    assert.equal(pub.body.data.price, 1999)
  })

  it('admin list sees all + published/stock filters', async () => {
    const all = await admin.get('/api/admin/products?limit=100')
    assert.equal(all.status, 200)
    assert.ok(all.body.data.some((p) => p.slug === 'crud-kurta'))
    const pub = await admin.get('/api/admin/products?published=true&limit=100')
    assert.ok(pub.body.data.every((p) => p.isPublished !== false))
    const out = await admin.get('/api/admin/products?stock=out&limit=100')
    assert.ok(out.body.data.every((p) => (p.stock ?? 0) === 0))
    const badPub = await admin.get('/api/admin/products?published=maybe')
    assert.equal(badPub.status, 400)
    const badStock = await admin.get('/api/admin/products?stock=tons')
    assert.equal(badStock.status, 400)
  })

  it('edit price/stock persists + storefront reflects', async () => {
    const created = await admin.post('/api/admin/products').send(productPayload({ slug: 'edit-widget', name: 'Edit Widget' }))
    const res = await admin.patch(`/api/admin/products/${created.body.data._id}`).send({ price: 2499, stock: 3 })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.price, 2499)
    const again = await admin.get(`/api/admin/products/${created.body.data._id}`)
    assert.equal(again.body.data.price, 2499)
    const pub = await request(app).get('/api/products/edit-widget')
    assert.equal(pub.body.data.price, 2499)
    assert.equal(pub.body.data.stock, 3)
  })

  it('unpublish hides from storefront; republish restores', async () => {
    const created = await admin.post('/api/admin/products').send(productPayload({ slug: 'flip-widget', name: 'Flip Widget' }))
    const id = created.body.data._id
    await admin.patch(`/api/admin/products/${id}`).send({ isPublished: false })
    assert.equal((await request(app).get('/api/products/flip-widget')).status, 404)
    assert.ok(!(await request(app).get('/api/products?limit=100')).body.data.some((p) => p.slug === 'flip-widget'))
    await admin.patch(`/api/admin/products/${id}`).send({ isPublished: true })
    assert.equal((await request(app).get('/api/products/flip-widget')).status, 200)
  })

  it('slug rename keeps old URL working', async () => {
    const created = await admin.post('/api/admin/products').send(productPayload({ slug: 'old-slug-widget', name: 'Rename Me' }))
    const id = created.body.data._id
    const renamed = await admin.patch(`/api/admin/products/${id}`).send({ slug: 'new-slug-widget' })
    assert.equal(renamed.status, 200)
    assert.ok((renamed.body.data.previousSlugs || []).includes('old-slug-widget'))
    assert.equal((await request(app).get('/api/products/new-slug-widget')).status, 200)
    const legacy = await request(app).get('/api/products/old-slug-widget')
    assert.equal(legacy.status, 200)
    assert.equal(legacy.body.data.name, 'Rename Me')
  })

  it('duplicate slug → 409; clash on rename → 409', async () => {
    const base = productPayload({ slug: 'dupe-widget', name: 'Dupe' })
    assert.equal((await admin.post('/api/admin/products').send(base)).status, 201)
    assert.equal((await admin.post('/api/admin/products').send(base)).status, 409)
    const other = await admin.post('/api/admin/products').send(productPayload({ slug: 'other-widget', name: 'Other' }))
    assert.equal((await admin.patch(`/api/admin/products/${other.body.data._id}`).send({ slug: 'dupe-widget' })).status, 409)
  })

  it('validation: missing name → 400, negative price → 400, bad stock → 400, bad discount → 400', async () => {
    const noName = await admin.post('/api/admin/products').send(productPayload({ name: '' }))
    assert.equal(noName.status, 400)
    const negPrice = await admin.post('/api/admin/products').send(productPayload({ slug: 'neg-price', price: -5 }))
    assert.equal(negPrice.status, 400)
    const badStock = await admin.post('/api/admin/products').send(productPayload({ slug: 'bad-stock', stock: -2 }))
    assert.equal(badStock.status, 400)
    const badDiscount = await admin.post('/api/admin/products').send(productPayload({ slug: 'bad-disc', discountPercentage: 150 }))
    assert.equal(badDiscount.status, 400)
    const badPublish = await admin.post('/api/admin/products').send(productPayload({ slug: 'bad-pub', isPublished: 'yes' }))
    assert.equal(badPublish.status, 400)
  })

  it('delete unreferenced → 200 then 404', async () => {
    const created = await admin.post('/api/admin/products').send(productPayload({ slug: 'gone-widget', name: 'Gone' }))
    const id = created.body.data._id
    assert.equal((await admin.delete(`/api/admin/products/${id}`)).status, 200)
    assert.equal((await admin.get(`/api/admin/products/${id}`)).status, 404)
  })
})

describe('safe delete with order/review references', () => {
  let admin
  let referencedId
  before(async () => {
    admin = await makeAdmin('safe.admin@example.com')
    const created = await admin.post('/api/admin/products').send(
      productPayload({ slug: 'referenced-widget', name: 'Referenced Widget', stock: 30 }),
    )
    referencedId = created.body.data._id
    const shopper = await registerAgent('ref.shopper@example.com', 'Ref Shopper')
    await shopper.post('/api/cart/items').send({ productId: 'referenced-widget', size: 'M', qty: 1 })
    const order = await shopper.post('/api/orders').send({
      customer: { ...CUSTOMER, email: 'ref.shopper@example.com' },
      shipping: SHIPPING,
      deliveryMethod: 'standard',
      paymentMethod: 'cod',
    })
    assert.equal(order.status, 201)
    // Attach a review row directly so both reference kinds are covered.
    const userDoc = await User.findOne({ email: 'ref.shopper@example.com' })
    const orderDoc = await Order.findOne({ orderNumber: order.body.data.order.orderNumber })
    await Review.create({
      user: userDoc._id,
      product: referencedId,
      order: orderDoc._id,
      rating: 5,
      title: 'Great',
      comment: 'A genuinely lovely product for testing.',
      status: 'approved',
    })
  })

  it('delete referenced product → 409 with counts', async () => {
    const res = await admin.delete(`/api/admin/products/${referencedId}`)
    assert.equal(res.status, 409)
    assert.equal(res.body.data.orderCount >= 1, true)
    assert.equal(res.body.data.reviewCount >= 1, true)
    // Still fully intact.
    assert.equal((await admin.get(`/api/admin/products/${referencedId}`)).status, 200)
  })

  it('unpublish instead works; force delete is the explicit escape hatch', async () => {
    const unpub = await admin.patch(`/api/admin/products/${referencedId}`).send({ isPublished: false })
    assert.equal(unpub.status, 200)
    assert.equal((await request(app).get('/api/products/referenced-widget')).status, 404)
    const forced = await admin.delete(`/api/admin/products/${referencedId}?force=true`)
    assert.equal(forced.status, 200)
  })
})
