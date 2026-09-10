import Wishlist from '../models/Wishlist.js'
import { findProductByRef, frontendProductId } from '../utils/catalog.js'

/* CLOTHZA database wishlist (Step 13) — authenticated users only.
   The user ALWAYS comes from the JWT session (req.user); a userId from
   the request is never accepted. Products resolve by frontend id
   (legacyId || slug) and are stored as references; the API returns
   frontend ids so the existing catalog-resolving UI works unchanged. */

function toIds(wishlist) {
  const ids = []
  for (const p of wishlist?.products || []) {
    // Populated docs carry legacyId/slug; plain ObjectIds are skipped
    // (stale refs resolve to nothing and are pruned on next write).
    if (p && typeof p === 'object' && (p.legacyId || p.slug)) {
      const id = frontendProductId(p)
      if (id && !ids.includes(id)) ids.push(id)
    }
  }
  return ids
}

async function wishlistPayload(userId) {
  const wishlist = await Wishlist.findOne({ user: userId }).populate('products', 'legacyId slug')
  const ids = toIds(wishlist)
  return { ids, count: ids.length }
}

async function getOrCreateWishlist(userId) {
  let wishlist = await Wishlist.findOne({ user: userId })
  if (!wishlist) wishlist = await Wishlist.create({ user: userId, products: [] })
  return wishlist
}

/* GET /api/wishlist */
export async function getWishlist(req, res, next) {
  try {
    return res.status(200).json({ success: true, data: await wishlistPayload(req.user._id) })
  } catch (err) {
    return next(err)
  }
}

/* POST /api/wishlist/items/:productId — idempotent add. */
export async function addWishlistItem(req, res, next) {
  try {
    const product = await findProductByRef(req.params.productId)
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' })
    }
    const wishlist = await getOrCreateWishlist(req.user._id)
    if (!wishlist.products.some((id) => String(id) === String(product._id))) {
      wishlist.products.push(product._id)
      await wishlist.save()
    }
    return res.status(200).json({ success: true, data: await wishlistPayload(req.user._id) })
  } catch (err) {
    return next(err)
  }
}

/* DELETE /api/wishlist/items/:productId — idempotent remove.
   Unknown product refs still succeed (nothing to remove) unless the ref
   is empty; this keeps toggle-off robust against catalog changes. */
export async function removeWishlistItem(req, res, next) {
  try {
    const raw = String(req.params.productId || '').trim()
    if (!raw) {
      return res.status(400).json({ success: false, message: 'Product id is required' })
    }
    const product = await findProductByRef(raw)
    const wishlist = await Wishlist.findOne({ user: req.user._id })
    if (wishlist && product) {
      const before = wishlist.products.length
      wishlist.products = wishlist.products.filter((id) => String(id) !== String(product._id))
      if (wishlist.products.length !== before) await wishlist.save()
    }
    return res.status(200).json({ success: true, data: await wishlistPayload(req.user._id) })
  } catch (err) {
    return next(err)
  }
}

/* DELETE /api/wishlist — clear the authenticated user's wishlist. */
export async function clearWishlist(req, res, next) {
  try {
    await Wishlist.findOneAndDelete({ user: req.user._id })
    return res.status(200).json({ success: true, data: { ids: [], count: 0 } })
  } catch (err) {
    return next(err)
  }
}

/* POST /api/wishlist/merge — { productIds: [] }.
   Guest-local wishlist unioned into the database wishlist on login.
   Unknown ids are skipped and reported, never fatal. */
export async function mergeWishlist(req, res, next) {
  try {
    const incoming = Array.isArray(req.body?.productIds) ? req.body.productIds : null
    if (!incoming) {
      return res.status(400).json({ success: false, message: 'Product ids array is required' })
    }
    const wishlist = await getOrCreateWishlist(req.user._id)
    let merged = 0
    let skipped = 0
    for (const ref of incoming.slice(0, 500)) {
      const product = await findProductByRef(ref)
      if (!product) {
        skipped += 1
        continue
      }
      if (!wishlist.products.some((id) => String(id) === String(product._id))) {
        wishlist.products.push(product._id)
        merged += 1
      }
    }
    await wishlist.save()
    const data = await wishlistPayload(req.user._id)
    return res.status(200).json({ success: true, data: { ...data, merged, skipped } })
  } catch (err) {
    return next(err)
  }
}
