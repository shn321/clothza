import mongoose from 'mongoose'
import Coupon, { COUPON_GENDERS } from '../models/Coupon.js'
import Product from '../models/Product.js'
import { invalid, str } from '../utils/orderValidation.js'

/* CLOTHZA coupon service (Step 18) — the single backend authority for
   coupon validation, discount math and usage accounting.
   - Validation NEVER trusts frontend totals/prices: callers pass live
     cart lines resolved from MongoDB products.
   - Discount math NEVER exceeds the eligible subtotal and honours the
     maximumDiscount cap.
   - Usage is consumed ONLY through guarded atomic updates
     (claimCouponUsage) and rolled back if the order fails, so retries
     and double-submits can never corrupt usageCount. */

export function normalizeCouponCode(value) {
  return str(value).toUpperCase()
}

/* How many times this user has already consumed the coupon. */
export function userUsageCount(coupon, userId) {
  if (!coupon || !Array.isArray(coupon.usedBy)) return 0
  const needle = String(userId)
  const entry = coupon.usedBy.find((u) => String(u.user) === needle)
  return entry ? Number(entry.count) || 0 : 0
}

/* A line matches when NO restriction is set (applies to everything) or
   when it matches ANY set restriction (product OR category OR gender). */
export function lineMatchesCoupon(product, coupon) {
  const hasProducts = Array.isArray(coupon.applicableProducts) && coupon.applicableProducts.length > 0
  const hasCategories = Array.isArray(coupon.applicableCategories) && coupon.applicableCategories.length > 0
  const hasGender = Array.isArray(coupon.applicableGender) && coupon.applicableGender.length > 0
  if (!hasProducts && !hasCategories && !hasGender) return true
  if (hasProducts && coupon.applicableProducts.some((id) => String(id) === String(product._id))) return true
  if (hasCategories && coupon.applicableCategories.includes(String(product.category || '').toLowerCase())) return true
  if (hasGender && coupon.applicableGender.includes(String(product.gender || '').toLowerCase())) return true
  return false
}

/* Pure discount math over the eligible subtotal. Always an integer-safe
   non-negative number, never above the eligible subtotal. */
export function computeDiscount(coupon, eligibleSubtotal) {
  const eligible = Math.max(0, Number(eligibleSubtotal) || 0)
  if (eligible <= 0) return 0
  let discount = 0
  if (coupon.discountType === 'percentage') {
    discount = (eligible * Number(coupon.discountValue)) / 100
  } else {
    discount = Number(coupon.discountValue)
  }
  const cap = Number(coupon.maximumDiscount) || 0
  if (cap > 0) discount = Math.min(discount, cap)
  discount = Math.min(discount, eligible)
  return Math.max(0, Math.round(discount * 100) / 100)
}

/* Full validation against live cart lines.
   lines: [{ product, qty }] with product = MongoDB Product document.
   Returns { coupon, subtotal, eligibleSubtotal, discountAmount }.
   Throws customer-safe HTTP errors (invalid coupon / expired / ...). */
export function evaluateCoupon(coupon, userId, lines) {
  if (!coupon) throw invalid('Invalid coupon code.', 404)
  if (coupon.isActive !== true) throw invalid('This coupon is no longer active.', 400)
  const now = new Date()
  if (coupon.startDate && new Date(coupon.startDate) > now) {
    throw invalid('This coupon is not active yet.', 400)
  }
  if (coupon.expiryDate && new Date(coupon.expiryDate) < now) {
    throw invalid('This coupon has expired.', 400)
  }
  const usageLimit = Number(coupon.usageLimit) || 0
  if (usageLimit > 0 && Number(coupon.usageCount) >= usageLimit) {
    throw invalid('This coupon has reached its usage limit.', 400)
  }
  const perUserLimit = Number(coupon.perUserLimit) || 1
  if (userUsageCount(coupon, userId) >= perUserLimit) {
    throw invalid('You have already used this coupon the maximum number of times.', 400)
  }

  const safeLines = Array.isArray(lines) ? lines : []
  const subtotal = safeLines.reduce((n, { product, qty }) => n + Number(product.price) * Number(qty), 0)
  const minimum = Number(coupon.minimumOrderValue) || 0
  if (subtotal < minimum) {
    throw invalid(`This coupon needs a minimum order of ₹${minimum}.`, 400)
  }

  const eligibleSubtotal = safeLines.reduce((n, { product, qty }) => {
    if (!lineMatchesCoupon(product, coupon)) return n
    return n + Number(product.price) * Number(qty)
  }, 0)
  if (eligibleSubtotal <= 0) {
    throw invalid('This coupon is not applicable to your bag.', 400)
  }

  const discountAmount = computeDiscount(coupon, eligibleSubtotal)
  if (discountAmount <= 0) {
    throw invalid('This coupon is not applicable to your bag.', 400)
  }
  return { coupon, subtotal, eligibleSubtotal, discountAmount }
}

/* Atomically consume one redemption AFTER evaluateCoupon passed on a
   fresh read. Guarded $inc (date window + usage-limit predicate) so a
   concurrent race can never push usageCount past usageLimit. The
   per-user counter is updated in the same step; if the user already hit
   their personal limit the global increment is rolled back. */
export async function claimCouponUsage(couponId, userId) {
  const now = new Date()
  const userObjectId = new mongoose.Types.ObjectId(String(userId))

  const claimed = await Coupon.findOneAndUpdate(
    {
      _id: couponId,
      isActive: true,
      startDate: { $lte: now },
      expiryDate: { $gte: now },
      $or: [
        { usageLimit: { $exists: false } },
        { usageLimit: null },
        { usageLimit: 0 },
        { $expr: { $lt: ['$usageCount', '$usageLimit'] } },
      ],
    },
    { $inc: { usageCount: 1 } },
    { new: true },
  )
  if (!claimed) {
    /* Re-read to return the precise customer-safe reason. */
    const current = await Coupon.findById(couponId)
    if (!current) throw invalid('Invalid coupon code.', 404)
    if (current.isActive !== true) throw invalid('This coupon is no longer active.', 400)
    if (current.startDate && new Date(current.startDate) > new Date()) {
      throw invalid('This coupon is not active yet.', 400)
    }
    if (current.expiryDate && new Date(current.expiryDate) < new Date()) {
      throw invalid('This coupon has expired.', 400)
    }
    throw invalid('This coupon has reached its usage limit.', 400)
  }

  /* Per-user accounting on the freshly claimed document. */
  const perUserLimit = Number(claimed.perUserLimit) || 1
  const entry = (claimed.usedBy || []).find((u) => String(u.user) === String(userId))
  const alreadyUsed = entry ? Number(entry.count) || 0 : 0
  if (alreadyUsed >= perUserLimit) {
    /* Lost the per-user race — roll the global increment back. */
    await Coupon.updateOne({ _id: couponId }, { $inc: { usageCount: -1 } })
    throw invalid('You have already used this coupon the maximum number of times.', 400)
  }
  if (entry) {
    await Coupon.updateOne(
      { _id: couponId, 'usedBy.user': userObjectId },
      { $inc: { 'usedBy.$.count': 1 } },
    )
  } else {
    /* Guard against a duplicate-entry race: only push when absent. */
    await Coupon.updateOne(
      { _id: couponId, 'usedBy.user': { $ne: userObjectId } },
      { $push: { usedBy: { user: userObjectId, count: 1 } } },
    )
  }
  return Coupon.findById(couponId)
}

/* Compensation — release a previously claimed redemption (order
   creation failed after the claim). Never throws. */
export async function releaseCouponUsage(couponId, userId) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(String(userId))
    const doc = await Coupon.findById(couponId)
    if (!doc) return
    await Coupon.updateOne(
      { _id: couponId, usageCount: { $gt: 0 } },
      { $inc: { usageCount: -1 } },
    )
    const entry = (doc.usedBy || []).find((u) => String(u.user) === String(userId))
    if (!entry) return
    if (Number(entry.count) <= 1) {
      await Coupon.updateOne({ _id: couponId }, { $pull: { usedBy: { user: userObjectId } } })
    } else {
      await Coupon.updateOne(
        { _id: couponId, 'usedBy.user': userObjectId },
        { $inc: { 'usedBy.$.count': -1 } },
      )
    }
  } catch {
    // Compensation must never break the response path.
  }
}

/* ---------------- admin field validation (never trusts the UI) ---------------- */

function toStr(v) {
  return String(v ?? '').trim()
}

function toStrArray(v) {
  if (v === undefined || v === null) return undefined
  const arr = Array.isArray(v) ? v : [v]
  return arr.map((x) => String(x).trim()).filter((x) => x.length > 0)
}

/* Returns { value } or { error }. partial=true (PATCH) allows a subset. */
export function validateCouponInput(body, { partial = false } = {}) {
  const src = body && typeof body === 'object' ? body : {}
  const out = {}
  const fail = (message) => ({ error: message })

  if (src.code !== undefined || !partial) {
    const code = toStr(src.code).toUpperCase()
    if (!code) return fail('Coupon code is required.')
    if (code.length > 32) return fail('Coupon code must be at most 32 characters.')
    if (!/^[A-Z0-9_-]+$/.test(code)) {
      return fail('Coupon code may contain letters, numbers, hyphens and underscores only.')
    }
    out.code = code
  }
  if (src.description !== undefined) {
    const d = toStr(src.description)
    if (d.length > 500) return fail('Description is too long.')
    out.description = d
  }
  if (src.discountType !== undefined || !partial) {
    const t = toStr(src.discountType).toLowerCase()
    if (t !== 'percentage' && t !== 'fixed') return fail('Discount type must be "percentage" or "fixed".')
    out.discountType = t
  }
  const discountType = out.discountType ?? src.discountType
  if (src.discountValue !== undefined || !partial) {
    const v = Number(src.discountValue)
    if (!Number.isFinite(v)) return fail('Discount value must be a number.')
    const type = String(discountType || '').toLowerCase()
    if (type === 'percentage') {
      if (v < 1 || v > 100) return fail('Percentage discount must be between 1 and 100.')
    } else if (type === 'fixed') {
      if (v <= 0) return fail('Fixed discount must be a positive amount.')
      if (v > 10000000) return fail('Fixed discount is unrealistically large.')
    } else if (!partial) {
      return fail('Discount type must be "percentage" or "fixed".')
    }
    out.discountValue = v
  } else if (partial && src.discountType !== undefined && src.discountValue === undefined) {
    /* Changing type without value — re-validate is the caller's job via
       full read; reject ambiguous partial updates that only change type
       when the stored value would violate the new type. */
  }
  if (src.minimumOrderValue !== undefined) {
    const v = Number(src.minimumOrderValue)
    if (!Number.isFinite(v) || v < 0) return fail('Minimum order value cannot be negative.')
    out.minimumOrderValue = v
  }
  if (src.maximumDiscount !== undefined) {
    const v = Number(src.maximumDiscount)
    if (!Number.isFinite(v) || v < 0) return fail('Maximum discount cannot be negative.')
    out.maximumDiscount = v
  }
  let startDate
  let expiryDate
  if (src.startDate !== undefined) {
    startDate = new Date(src.startDate)
    if (Number.isNaN(startDate.getTime())) return fail('Start date is invalid.')
    out.startDate = startDate
  }
  if (src.expiryDate !== undefined) {
    expiryDate = new Date(src.expiryDate)
    if (Number.isNaN(expiryDate.getTime())) return fail('Expiry date is invalid.')
    out.expiryDate = expiryDate
  }
  if (out.startDate && out.expiryDate && out.expiryDate < out.startDate) {
    return fail('Expiry date cannot be before the start date.')
  }
  if (src.usageLimit !== undefined) {
    const v = Number(src.usageLimit)
    if (!Number.isInteger(v) || v < 0) return fail('Usage limit must be a non-negative integer.')
    out.usageLimit = v
  }
  if (src.perUserLimit !== undefined) {
    const v = Number(src.perUserLimit)
    if (!Number.isInteger(v) || v < 1) return fail('Per-user limit must be an integer of at least 1.')
    out.perUserLimit = v
  }
  if (src.applicableProducts !== undefined) {
    const raw = Array.isArray(src.applicableProducts) ? src.applicableProducts : [src.applicableProducts]
    const ids = raw.map((x) => String(x || '').trim()).filter(Boolean)
    for (const id of ids) {
      if (!mongoose.isValidObjectId(id)) return fail('Each applicable product must be a valid product id.')
    }
    out.applicableProducts = ids
  }
  if (src.applicableCategories !== undefined) {
    const cats = toStrArray(src.applicableCategories) ?? []
    if (cats.length > 30) return fail('Too many applicable categories (max 30).')
    out.applicableCategories = cats.map((c) => c.toLowerCase())
  }
  if (src.applicableGender !== undefined) {
    const raw = Array.isArray(src.applicableGender) ? src.applicableGender : [src.applicableGender]
    const genders = raw.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
    for (const g of genders) {
      if (!COUPON_GENDERS.includes(g)) {
        return fail(`Invalid gender. Allowed: ${COUPON_GENDERS.join(', ')}.`)
      }
    }
    out.applicableGender = genders
  }
  if (src.isActive !== undefined) {
    if (typeof src.isActive !== 'boolean') return fail('"isActive" must be true or false.')
    out.isActive = src.isActive
  }
  /* Server-owned accounting fields can never be set by the client. */
  for (const forbidden of ['usageCount', 'usedBy', '_id', 'createdAt', 'updatedAt']) {
    if (src[forbidden] !== undefined && !partial) {
      /* Silently ignored on create — never trusted, never stored. */
      delete out[forbidden]
    } else if (src[forbidden] !== undefined && partial) {
      return fail(`"${forbidden}" cannot be modified.`)
    }
  }
  return { value: out }
}

/* Cross-check product ids exist (create/edit). Returns error string or null. */
export async function checkCouponProducts(productIds) {
  if (!productIds || productIds.length === 0) return null
  const count = await Product.countDocuments({ _id: { $in: productIds } })
  if (count !== productIds.length) return 'One or more applicable products do not exist.'
  return null
}

/* When PATCH changes discountType alone, ensure the stored value stays
   valid under the new type. Returns error string or null. */
export function checkTypeValueMismatch(type, value) {
  if (type === 'percentage' && (value < 1 || value > 100)) {
    return 'Percentage discount must be between 1 and 100.'
  }
  if (type === 'fixed' && value <= 0) return 'Fixed discount must be a positive amount.'
  return null
}
