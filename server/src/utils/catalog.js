import Product from '../models/Product.js'

/* Shared product-resolution helpers for cart/wishlist (Step 13).
   Frontend code identifies products by `legacyId` (preferred) with `slug`
   as fallback (`normalizeProduct`: id = legacyId || slug). The server
   resolves either form back to the Product document so price, name,
   image, sizes, colors and stock are ALWAYS read from MongoDB —
   frontend-provided product fields are never trusted. */

/* The id the frontend uses for this product document. */
export function frontendProductId(doc) {
  if (!doc || typeof doc !== 'object') return null
  return doc.legacyId || doc.slug || null
}

/* Find a product by frontend id (legacyId or slug). Returns null when
   the reference is missing or unknown — callers map that to 404. */
export async function findProductByRef(ref) {
  const raw = String(ref || '').trim()
  if (!raw) return null
  const doc = await Product.findOne({
    $or: [{ legacyId: raw }, { slug: raw.toLowerCase() }],
  })
  return doc || null
}
