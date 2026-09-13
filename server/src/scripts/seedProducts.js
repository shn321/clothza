/* CLOTHZA product seed — transfers the ACTUAL frontend catalog
   (client/src/data/products.js) into MongoDB.
   IDEMPOTENT: upserts on the unique `slug`, so re-running never creates
   duplicates. Only touches the Product collection — nothing else. */

import 'dotenv/config'
import { PRODUCTS } from '../../../client/src/data/products.js'
import { connectDB, disconnectDB, redactCredentials } from '../config/db.js'
import Product from '../models/Product.js'

const GENDER_BY_CATEGORY = { men: 'men', women: 'women', accessories: 'unisex' }

function toDocument(p) {
  return {
    legacyId: p.id,
    slug: String(p.slug).toLowerCase().trim(),
    name: p.name,
    description: p.description || '',
    price: p.price,
    originalPrice: p.originalPrice ?? null,
    discountPercentage: p.discountPercentage ?? null,
    gender: GENDER_BY_CATEGORY[p.category] || 'unisex',
    category: p.category,
    subcategory: p.subcategory || '',
    images: p.images || [],
    colors: p.colors || [],
    sizes: p.sizes || [],
    rating: p.rating ?? 0,
    reviewCount: p.reviewCount ?? 0,
    tags: p.tags || [],
    stock: p.stock ?? 0,
    isFeatured: Boolean(p.isFeatured),
    isNewArrival: Boolean(p.isNewArrival),
    isBestSeller: Boolean(p.isBestSeller),
  }
  /* NOTE: isPublished is intentionally NOT in $set — it uses
     $setOnInsert below so re-running the seed never overrides an
     admin's publish/unpublish choice. Admin-created products (slugs
     outside the catalog) are never touched by slug-keyed upserts. */
}

function validate(p) {
  const problems = []
  if (!p.slug) problems.push('missing slug')
  if (!p.name) problems.push('missing name')
  if (typeof p.price !== 'number' || p.price < 0) problems.push('invalid price')
  if (!Array.isArray(p.images) || p.images.length === 0) problems.push('missing images')
  if (!p.category) problems.push('missing category')
  return problems
}

async function seed() {
  if (!process.env.MONGODB_URI) {
    console.error('[seed] MONGODB_URI is not set. Aborting.')
    process.exit(1)
  }

  const slugs = new Set()
  const dupes = []
  for (const p of PRODUCTS) {
    if (slugs.has(p.slug)) dupes.push(p.slug)
    slugs.add(p.slug)
  }
  if (dupes.length > 0) {
    console.error(`[seed] Duplicate slugs in source catalog: ${dupes.join(', ')}. Aborting.`)
    process.exit(1)
  }

  const invalid = []
  for (const p of PRODUCTS) {
    const problems = validate(p)
    if (problems.length > 0) invalid.push(`${p.slug || p.id}: ${problems.join(', ')}`)
  }
  if (invalid.length > 0) {
    console.error(`[seed] Invalid products:\n - ${invalid.join('\n - ')}`)
    process.exit(1)
  }

  console.log(`[seed] Source catalog: ${PRODUCTS.length} products, ${slugs.size} unique slugs.`)

  await connectDB()
  // Ensure indexes (unique slug) exist before upserting.
  await Product.syncIndexes()

  const ops = PRODUCTS.map((p) => ({
    updateOne: {
      filter: { slug: String(p.slug).toLowerCase().trim() },
      update: { $set: toDocument(p), $setOnInsert: { isPublished: true } },
      upsert: true,
    },
  }))
  const result = await Product.bulkWrite(ops, { ordered: false })
  console.log(
    `[seed] Upserted: ${result.upsertedCount}, modified: ${result.modifiedCount}, matched: ${result.matchedCount}.`,
  )

  const total = await Product.countDocuments()
  const dupGroups = await Product.aggregate([
    { $group: { _id: '$slug', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ])
  console.log(`[seed] Products in MongoDB: ${total}. Duplicate slugs: ${dupGroups.length}.`)

  await disconnectDB()
}

seed().catch(async (err) => {
  console.error(`[seed] Failed: ${redactCredentials(err.message)}`)
  try {
    await disconnectDB()
  } catch {
    // Ignore disconnect errors during failure shutdown.
  }
  process.exit(1)
})
