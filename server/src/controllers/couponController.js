import mongoose from 'mongoose'
import Cart from '../models/Cart.js'
import Coupon from '../models/Coupon.js'
import { findProductByRef } from '../utils/catalog.js'
import { invalid, str } from '../utils/orderValidation.js'
import {
  checkCouponProducts,
  checkTypeValueMismatch,
  evaluateCoupon,
  normalizeCouponCode,
  validateCouponInput,
} from '../services/couponService.js'

/* CLOTHZA coupons (Step 18).
   - POST /api/coupons/validate (auth): validates against the live
     database cart + MongoDB prices and returns the server-computed
     discount. Never consumes usage; never trusts frontend totals.
   - /api/admin/coupons (admin): full CRUD with server-side validation.
     usageCount / usedBy are server-owned and can never be written. */

function bad(res, status, message) {
  return res.status(status).json({ success: false, message })
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parsePage(value) {
  const n = Number.parseInt(value, 10)
  return Number.isInteger(n) && n > 0 ? n : 1
}

function parseLimit(value, fallback = 20) {
  const n = Number.parseInt(value, 10)
  if (!Number.isInteger(n) || n <= 0) return fallback
  return Math.min(n, 100)
}

export function serializeCoupon(doc) {
  if (!doc || typeof doc !== 'object') return null
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc
  const now = new Date()
  const expired = Boolean(o.expiryDate && new Date(o.expiryDate) < now)
  const notStarted = Boolean(o.startDate && new Date(o.startDate) > now)
  return {
    id: String(o._id),
    code: o.code,
    description: o.description || '',
    discountType: o.discountType,
    discountValue: o.discountValue,
    minimumOrderValue: o.minimumOrderValue ?? 0,
    maximumDiscount: o.maximumDiscount ?? 0,
    startDate: o.startDate,
    expiryDate: o.expiryDate,
    usageLimit: o.usageLimit ?? 0,
    usageCount: o.usageCount ?? 0,
    perUserLimit: o.perUserLimit ?? 1,
    applicableProducts: (o.applicableProducts || []).map(String),
    applicableCategories: o.applicableCategories || [],
    applicableGender: o.applicableGender || [],
    isActive: Boolean(o.isActive),
    expired,
    notStarted,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  }
}

/* Resolve the caller's live cart lines against MongoDB products. */
async function resolveUserCartLines(userId) {
  const cart = await Cart.findOne({ user: userId })
  if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
    throw invalid('Your bag is empty.', 400)
  }
  const lines = []
  for (const line of cart.items) {
    const product = await findProductByRef(line.productId)
    if (!product) {
      throw invalid(`“${line.name || 'An item'}” in your bag is no longer available.`, 404)
    }
    const qty = line.qty
    if (!Number.isInteger(qty) || qty < 1) {
      throw invalid(`Invalid quantity for “${product.name}”.`, 400)
    }
    lines.push({ product, qty })
  }
  return lines
}

/* POST /api/coupons/validate — { code }. Auth required. */
export async function validateCoupon(req, res, next) {
  try {
    const code = normalizeCouponCode(req.body?.code)
    if (!code) return bad(res, 400, 'Coupon code is required.')
    let lines
    try {
      lines = await resolveUserCartLines(req.user._id)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message })
    }
    const coupon = await Coupon.findOne({ code })
    let result
    try {
      result = evaluateCoupon(coupon, req.user._id, lines)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message })
    }
    return res.status(200).json({
      success: true,
      data: {
        coupon: {
          code: result.coupon.code,
          discountType: result.coupon.discountType,
          discountValue: result.coupon.discountValue,
        },
        subtotal: result.subtotal,
        eligibleSubtotal: result.eligibleSubtotal,
        discountAmount: result.discountAmount,
        subtotalAfterDiscount: Math.max(0, result.subtotal - result.discountAmount),
      },
    })
  } catch (err) {
    return next(err)
  }
}

/* ---------------- admin ---------------- */

/* GET /api/admin/coupons — q, active (true/false), expired (true/false). */
export async function listAdminCoupons(req, res, next) {
  try {
    const filter = {}
    if (req.query.q !== undefined && str(req.query.q) !== '') {
      const rx = new RegExp(escapeRegExp(str(req.query.q).slice(0, 32)), 'i')
      filter.$or = [{ code: rx }, { description: rx }]
    }
    if (req.query.active !== undefined && str(req.query.active) !== '') {
      const v = str(req.query.active).toLowerCase()
      if (v !== 'true' && v !== 'false') return bad(res, 400, 'Invalid "active" filter.')
      filter.isActive = v === 'true'
    }
    if (req.query.expired !== undefined && str(req.query.expired) !== '') {
      const v = str(req.query.expired).toLowerCase()
      if (v !== 'true' && v !== 'false') return bad(res, 400, 'Invalid "expired" filter.')
      filter.expiryDate = v === 'true' ? { $lt: new Date() } : { $gte: new Date() }
    }
    const page = parsePage(req.query.page)
    const limit = parseLimit(req.query.limit)
    const skip = (page - 1) * limit
    const [total, docs] = await Promise.all([
      Coupon.countDocuments(filter),
      Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ])
    return res.status(200).json({
      success: true,
      data: {
        coupons: docs.map(serializeCoupon),
        pagination: { page, limit, total, pages: total === 0 ? 0 : Math.ceil(total / limit) },
      },
    })
  } catch (err) {
    return next(err)
  }
}

/* GET /api/admin/coupons/:id */
export async function getAdminCoupon(req, res, next) {
  try {
    const id = str(req.params.id)
    if (!mongoose.isValidObjectId(id)) return bad(res, 404, 'Coupon not found.')
    const coupon = await Coupon.findById(id)
    if (!coupon) return bad(res, 404, 'Coupon not found.')
    return res.status(200).json({ success: true, data: { coupon: serializeCoupon(coupon) } })
  } catch (err) {
    return next(err)
  }
}

/* POST /api/admin/coupons */
export async function createAdminCoupon(req, res, next) {
  try {
    const { value, error } = validateCouponInput(req.body, { partial: false })
    if (error) return bad(res, 400, error)
    if (value.expiryDate < value.startDate) return bad(res, 400, 'Expiry date cannot be before the start date.')
    if (value.applicableProducts?.length) {
      const productError = await checkCouponProducts(value.applicableProducts)
      if (productError) return bad(res, 400, productError)
    }
    const existing = await Coupon.findOne({ code: value.code }).lean()
    if (existing) return bad(res, 409, 'A coupon with this code already exists.')
    let created
    try {
      created = await Coupon.create(value)
    } catch (err) {
      if (err && err.code === 11000) return bad(res, 409, 'A coupon with this code already exists.')
      throw err
    }
    return res.status(201).json({ success: true, data: { coupon: serializeCoupon(created) } })
  } catch (err) {
    return next(err)
  }
}

/* PATCH /api/admin/coupons/:id */
export async function updateAdminCoupon(req, res, next) {
  try {
    const id = str(req.params.id)
    if (!mongoose.isValidObjectId(id)) return bad(res, 404, 'Coupon not found.')
    const coupon = await Coupon.findById(id)
    if (!coupon) return bad(res, 404, 'Coupon not found.')
    const { value, error } = validateCouponInput(req.body, { partial: true })
    if (error) return bad(res, 400, error)
    if (Object.keys(value).length === 0) return bad(res, 400, 'No valid fields to update.')
    if (value.code && value.code !== coupon.code) {
      const clash = await Coupon.findOne({ code: value.code, _id: { $ne: coupon._id } }).lean()
      if (clash) return bad(res, 409, 'A coupon with this code already exists.')
    }
    const nextType = value.discountType || coupon.discountType
    const nextValue = value.discountValue !== undefined ? value.discountValue : coupon.discountValue
    const mismatch = checkTypeValueMismatch(nextType, nextValue)
    if (mismatch) return bad(res, 400, mismatch)
    const nextStart = value.startDate || coupon.startDate
    const nextExpiry = value.expiryDate || coupon.expiryDate
    if (nextStart && nextExpiry && new Date(nextExpiry) < new Date(nextStart)) {
      return bad(res, 400, 'Expiry date cannot be before the start date.')
    }
    if (value.applicableProducts?.length) {
      const productError = await checkCouponProducts(value.applicableProducts)
      if (productError) return bad(res, 400, productError)
    }
    Object.assign(coupon, value)
    await coupon.save()
    return res.status(200).json({ success: true, data: { coupon: serializeCoupon(coupon) } })
  } catch (err) {
    if (err && err.code === 11000) return bad(res, 409, 'A coupon with this code already exists.')
    return next(err)
  }
}

/* DELETE /api/admin/coupons/:id */
export async function deleteAdminCoupon(req, res, next) {
  try {
    const id = str(req.params.id)
    if (!mongoose.isValidObjectId(id)) return bad(res, 404, 'Coupon not found.')
    const coupon = await Coupon.findById(id)
    if (!coupon) return bad(res, 404, 'Coupon not found.')
    await Coupon.deleteOne({ _id: coupon._id })
    return res.status(200).json({ success: true, message: 'Coupon deleted.' })
  } catch (err) {
    return next(err)
  }
}
