/* CLOTHZA CMS tests — content + media library.
   Runs against an isolated in-memory MongoDB; no external services.
   Cloudinary is NOT configured in tests, so the URL-fallback path is
   exercised (no network). */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.JWT_SECRET = 'test-jwt-secret-for-cms-suite'
process.env.JWT_EXPIRES_IN = '7d'
delete process.env.CLOUDINARY_CLOUD_NAME
delete process.env.CLOUDINARY_API_KEY
delete process.env.CLOUDINARY_API_SECRET

const { createApp } = await import('../src/app.js')
const User = (await import('../src/models/User.js')).default

let mongod
let app

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
  const uri = mongod.getUri('clothza-cms-test')
  process.env.MONGODB_URI = uri
  await mongoose.connect(uri)
  app = createApp()
})

after(async () => {
  await mongoose.disconnect().catch(() => {})
  await mongod?.stop()
})

describe('cms public reads', () => {
  it('GET /api/content → all sections with defaults', async () => {
    const res = await request(app).get('/api/content')
    assert.equal(res.status, 200)
    assert.equal(res.body.success, true)
    assert.ok(res.body.data['homepage.hero'])
    assert.equal(res.body.data['homepage.hero'].heading, 'CLOTHZA')
  })

  it('GET /api/content/homepage.hero → hero defaults', async () => {
    const res = await request(app).get('/api/content/homepage.hero')
    assert.equal(res.status, 200)
    assert.equal(res.body.data.key, 'homepage.hero')
    assert.equal(res.body.data.content.primaryButtonText, 'Shop New Arrivals')
  })

  it('GET /api/content/unknown.key → 404', async () => {
    const res = await request(app).get('/api/content/nope.nope')
    assert.equal(res.status, 404)
  })

  it('public reads never leak secrets', async () => {
    const res = await request(app).get('/api/content')
    assert.doesNotMatch(JSON.stringify(res.body), /passwordHash|secret|jwt/i)
  })
})

describe('cms admin authorization', () => {
  it('anonymous PUT /api/admin/content/homepage.hero → 401', async () => {
    const res = await request(app).put('/api/admin/content/homepage.hero').send({ content: {} })
    assert.equal(res.status, 401)
  })

  it('anonymous media endpoints → 401', async () => {
    const get = await request(app).get('/api/admin/media')
    assert.equal(get.status, 401)
    const post = await request(app).post('/api/admin/media').send({ url: 'https://example.com/x.jpg' })
    assert.equal(post.status, 401)
  })

  it('non-admin PUT/POST/DELETE → 403', async () => {
    const user = await registerAgent('cmsuser@example.com')
    const put = await user.put('/api/admin/content/homepage.hero').send({ content: {} })
    assert.equal(put.status, 403)
    const post = await user.post('/api/admin/media').send({ url: 'https://example.com/x.jpg' })
    assert.equal(post.status, 403)
    const del = await user.delete('/api/admin/media/000000000000000000000000')
    assert.equal(del.status, 403)
    const reset = await user.post('/api/admin/content/homepage.hero/reset')
    assert.equal(reset.status, 403)
  })
})

describe('cms admin content management', () => {
  let admin
  before(async () => {
    admin = await makeAdmin('cmsadmin@example.com')
  })

  it('admin list → 200 with all keys', async () => {
    const res = await admin.get('/api/admin/content')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.data))
    assert.ok(res.body.data.length >= 9)
  })

  it('edit hero heading persists + public read reflects it', async () => {
    const current = await admin.get('/api/admin/content/homepage.hero')
    assert.equal(current.status, 200)
    const updated = { ...current.body.data.content, heading: 'CMS Test Heading' }
    const put = await admin.put('/api/admin/content/homepage.hero').send({ content: updated })
    assert.equal(put.status, 200)
    assert.equal(put.body.data.content.heading, 'CMS Test Heading')
    assert.equal(put.body.message, 'Changes saved successfully.')

    const pub = await request(app).get('/api/content/homepage.hero')
    assert.equal(pub.status, 200)
    assert.equal(pub.body.data.content.heading, 'CMS Test Heading')
  })

  it('edit hero image + buttons + toggles', async () => {
    const current = await admin.get('/api/admin/content/homepage.hero')
    const updated = {
      ...current.body.data.content,
      image: 'https://example.com/hero-new.jpg',
      imageAlt: 'New alt',
      mobileImage: 'https://example.com/hero-mobile.jpg',
      primaryButtonText: 'Shop Now',
      primaryButtonLink: '/shop',
      secondaryButtonEnabled: false,
      enabled: true,
    }
    const put = await admin.put('/api/admin/content/homepage.hero').send({ content: updated })
    assert.equal(put.status, 200)
    assert.equal(put.body.data.content.image, 'https://example.com/hero-new.jpg')
    assert.equal(put.body.data.content.secondaryButtonEnabled, false)
  })

  it('invalid content rejected → 400 (empty heading, bad URL, bad link)', async () => {
    const current = await admin.get('/api/admin/content/homepage.hero')
    const base = current.body.data.content
    const r1 = await admin.put('/api/admin/content/homepage.hero').send({ content: { ...base, heading: '' } })
    assert.equal(r1.status, 400)
    const r2 = await admin.put('/api/admin/content/homepage.hero').send({ content: { ...base, image: 'not-a-url' } })
    assert.equal(r2.status, 400)
    const r3 = await admin.put('/api/admin/content/homepage.hero').send({ content: { ...base, primaryButtonLink: 'javascript:alert(1)' } })
    assert.equal(r3.status, 400)
    const r4 = await admin.put('/api/admin/content/homepage.hero').send({ content: { ...base, count: 'x' } })
    // extra unknown field is dropped, valid save still succeeds
    assert.equal(r4.status, 200)
  })

  it('unknown key → 404', async () => {
    const res = await admin.put('/api/admin/content/nope.nope').send({ content: {} })
    assert.equal(res.status, 404)
  })

  it('reset restores defaults', async () => {
    const reset = await admin.post('/api/admin/content/homepage.hero/reset')
    assert.equal(reset.status, 200)
    assert.equal(reset.body.data.content.heading, 'CLOTHZA')
    const pub = await request(app).get('/api/content/homepage.hero')
    assert.equal(pub.body.data.content.heading, 'CLOTHZA')
  })

  it('unpublish hides draft on BOTH public endpoints; republish restores', async () => {
    const current = await admin.get('/api/admin/content/homepage.hero')
    const draft = { ...current.body.data.content, heading: 'Unpublished Draft' }
    const unpub = await admin
      .put('/api/admin/content/homepage.hero')
      .send({ content: draft, isPublished: false })
    assert.equal(unpub.status, 200)
    assert.equal(unpub.body.data.isPublished, false)

    // Single-key public read → safe defaults, draft never leaks.
    const single = await request(app).get('/api/content/homepage.hero')
    assert.equal(single.status, 200)
    assert.equal(single.body.data.isPublished, false)
    assert.equal(single.body.data.content.heading, 'CLOTHZA')
    assert.doesNotMatch(JSON.stringify(single.body), /Unpublished Draft/)

    // Bulk public read → defaults too (no draft leak via /api/content).
    const bulk = await request(app).get('/api/content')
    assert.equal(bulk.status, 200)
    assert.equal(bulk.body.data['homepage.hero'].heading, 'CLOTHZA')
    assert.doesNotMatch(JSON.stringify(bulk.body), /Unpublished Draft/)

    // Admin still sees the draft (persistence across "refresh").
    const again = await admin.get('/api/admin/content/homepage.hero')
    assert.equal(again.body.data.content.heading, 'Unpublished Draft')

    // Republish → draft goes live on both endpoints.
    const pub = await admin
      .put('/api/admin/content/homepage.hero')
      .send({ content: draft, isPublished: true })
    assert.equal(pub.body.data.isPublished, true)
    const live = await request(app).get('/api/content')
    assert.equal(live.body.data['homepage.hero'].heading, 'Unpublished Draft')

    await admin.post('/api/admin/content/homepage.hero/reset')
  })

  it('non-boolean isPublished rejected → 400', async () => {
    const current = await admin.get('/api/admin/content/site.newsletter')
    const res = await admin
      .put('/api/admin/content/site.newsletter')
      .send({ content: current.body.data.content, isPublished: 'yes' })
    assert.equal(res.status, 400)
  })

  it('footer + newsletter + pages editable', async () => {
    const f = await admin.get('/api/admin/content/site.footer')
    const fPut = await admin
      .put('/api/admin/content/site.footer')
      .send({ content: { ...f.body.data.content, copyrightText: '© 2026 Test.' } })
    assert.equal(fPut.status, 200)
    assert.equal(fPut.body.data.content.copyrightText, '© 2026 Test.')
    await admin.post('/api/admin/content/site.footer/reset')

    const n = await admin.get('/api/admin/content/site.newsletter')
    const nPut = await admin
      .put('/api/admin/content/site.newsletter')
      .send({ content: { ...n.body.data.content, heading: 'Hello.' } })
    assert.equal(nPut.status, 200)
    await admin.post('/api/admin/content/site.newsletter/reset')
  })

  it('info pages (site.pages) edit → public read → reset', async () => {
    const p = await admin.get('/api/admin/content/site.pages')
    assert.equal(p.status, 200)
    const pPut = await admin
      .put('/api/admin/content/site.pages')
      .send({ content: { ...p.body.data.content, aboutNote: 'Our story, edited in the CMS.' } })
    assert.equal(pPut.status, 200)
    // Admin "refresh" still shows the edit.
    const again = await admin.get('/api/admin/content/site.pages')
    assert.equal(again.body.data.content.aboutNote, 'Our story, edited in the CMS.')
    // Public storefront read shows the edit.
    const pub = await request(app).get('/api/content/site.pages')
    assert.equal(pub.body.data.content.aboutNote, 'Our story, edited in the CMS.')
    // Reset restores the original placeholder copy only for this key.
    const reset = await admin.post('/api/admin/content/site.pages/reset')
    assert.equal(reset.status, 200)
    assert.equal(reset.body.data.content.aboutNote, 'Minimal placeholder. About page comes later.')
    const live = await request(app).get('/api/content/site.pages')
    assert.equal(live.body.data.content.aboutNote, 'Minimal placeholder. About page comes later.')
  })
})

describe('cms media library', () => {
  let admin
  before(async () => {
    admin = await makeAdmin('cmsmedia@example.com')
  })

  it('upload URL → 201, list → 200, search works', async () => {
    const up = await admin.post('/api/admin/media').send({
      url: 'https://example.com/cms-unique-123.jpg',
      altText: 'CMS alt',
      filename: 'cms-unique-123.jpg',
    })
    assert.equal(up.status, 201)
    assert.ok(up.body.data.id)
    assert.equal(up.body.data.provider, 'url')

    const list = await admin.get('/api/admin/media')
    assert.equal(list.status, 200)
    assert.ok(list.body.data.items.length >= 1)

    const search = await admin.get('/api/admin/media?q=cms-unique-123')
    assert.equal(search.status, 200)
    assert.ok(search.body.data.items.length >= 1)
  })

  it('invalid upload rejected → 400', async () => {
    const r1 = await admin.post('/api/admin/media').send({ url: '' })
    assert.equal(r1.status, 400)
    const r2 = await admin.post('/api/admin/media').send({ url: 'not-a-url' })
    assert.equal(r2.status, 400)
  })

  it('delete unused → 200; delete missing → 404', async () => {
    const up = await admin.post('/api/admin/media').send({ url: 'https://example.com/cms-delete-me.jpg' })
    const del = await admin.delete(`/api/admin/media/${up.body.data.id}`)
    assert.equal(del.status, 200)
    const missing = await admin.delete('/api/admin/media/000000000000000000000000')
    assert.equal(missing.status, 404)
  })

  it('delete protection: referenced image → 409 with usedIn', async () => {
    const up = await admin.post('/api/admin/media').send({ url: 'https://example.com/cms-protected.jpg' })
    assert.equal(up.status, 201)
    // Point hero at this image
    const hero = await admin.get('/api/admin/content/homepage.hero')
    await admin.put('/api/admin/content/homepage.hero').send({
      content: { ...hero.body.data.content, image: 'https://example.com/cms-protected.jpg' },
    })
    const blocked = await admin.delete(`/api/admin/media/${up.body.data.id}`)
    assert.equal(blocked.status, 409)
    assert.ok(blocked.body.data.usedIn.includes('homepage.hero'))
    // Force delete after warning succeeds
    const forced = await admin.delete(`/api/admin/media/${up.body.data.id}?force=true`)
    assert.equal(forced.status, 200)
    await admin.post('/api/admin/content/homepage.hero/reset')
  })
})
