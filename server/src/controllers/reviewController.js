import mongoose from 'mongoose'
import Order from '../models/Order.js'
import Product from '../models/Product.js'
import Review, { REVIEW_STATUSES } from '../models/Review.js'
import { findProductByRef } from '../utils/catalog.js'

/* CLOTHZA product reviews (Step 17) — verified-purchase only.
   The reviewer ALWAYS comes from the JWT session (req.user); user,
   verifiedPurchase, status and rating averages from the client are
   never trusted. Only `delivered` orders prove a purchase. Only
   `approved` reviews are public and feed the product aggregation. */

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50
const MAX_TITLE = 120
const MIN_COMMENT = 10
const MAX_COMMENT = 2000

function bad(res, status, message) {
  return res.status(status).json({ success: false, message })
}

function parsePage(value) {
  const n = Number.parseInt(value, 10)
  return Number.isInteger(n) && n > 0 ? n : 1
}

function parseLimit(value) {
  const n = Number.parseInt(value, 10)
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}

/* Resolve :productId as ObjectId, legacyId or slug. Null when the
   reference is missing or unknown — callers map that to 404. */
export async function findProductByParam(param) {
  const raw = String(param || '').trim()
  if (!raw) return null
  if (mongoose.isValidObjectId(raw)) {
    const byId = await Product.findById(raw)
    if (byId) return byId
  }
  return findProductByRef(raw)
}

/* "Asha Sharma" → "Asha S." — public lists never expose emails. */
function displayName(userDoc) {
  const full = String(userDoc?.name || '').trim().replace(/\s+/g, ' ')
  if (!full) return 'CLOTHZA customer'
  const parts = full.split(' ')
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function validateReviewContent({ rating, title, comment }) {
  if (rating === undefined || rating === null || rating === '') {
    return { error: 'Rating is required.' }
  }
  const n = typeof rating === 'number' ? rating : Number(rating)
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    return { error: 'Rating must be a whole number from 1 to 5.' }
  }
  const cleanTitle = normalizeText(title)
  if (cleanTitle.length > MAX_TITLE) {
    return { error: `Title must be at most ${MAX_TITLE} characters.` }
  }
  const cleanComment = normalizeText(comment)
  if (!cleanComment) return { error: 'Review comment is required.' }
  if (cleanComment.length < MIN_COMMENT) {
    return { error: `Review must be at least ${MIN_COMMENT} characters.` }
  }
  if (cleanComment.length > MAX_COMMENT) {
    return { error: `Review must be at most ${MAX_COMMENT} characters.` }
  }
  return { value: { rating: n, title: cleanTitle, comment: cleanComment } }
}

/* Recompute Product.rating / Product.reviewCount from APPROVED reviews
   only. Counts can never go negative; an unreviewed product is 0/0. */
export async function recalcProductRating(productId) {
  const agg = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId), status: 'approved' } },
    { $group: { _id: null, count: { $sum: 1 }, avg: { $avg: '$rating' } } },
  ])
  const count = agg[0]?.count || 0
  const average = count === 0 ? 0 : Math.round((agg[0].avg || 0) * 10) / 10
  await Product.updateOne(
    { _id: productId },
    { $set: { rating: Math.min(5, Math.max(0, average)), reviewCount: Math.max(0, count) } },
  )
  return { average, count }
}

async function ratingSummary(productId) {
  const rows = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId), status: 'approved' } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
  ])
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let count = 0
  let sum = 0
  for (const r of rows) {
    if (r._id >= 1 && r._id <= 5) breakdown[r._id] = r.count
    count += r.count
    sum += r._id * r.count
  }
  return {
    average: count === 0 ? 0 : Math.round((sum / count) * 10) / 10,
    count,
    breakdown,
  }
}

function serializePublicReview(doc, viewerId) {
  return {
    id: String(doc._id),
    rating: doc.rating,
    title: doc.title || '',
    comment: doc.comment,
    verifiedPurchase: Boolean(doc.verifiedPurchase),
    createdAt: doc.createdAt,
    reviewer: displayName(doc.user),
    ...(viewerId && doc.user && String(doc.user._id || doc.user) === String(viewerId)
      ? { isMine: true }
      : {}),
  }
}

export function serializeAdminReview(doc) {
  const u = doc.user && typeof doc.user === 'object' ? doc.user : null
  const p = doc.product && typeof doc.product === 'object' ? doc.product : null
  const o = doc.order && typeof doc.order === 'object' ? doc.order : null
  return {
    id: String(doc._id),
    rating: doc.rating,
    title: doc.title || '',
    comment: doc.comment,
    verifiedPurchase: Boolean(doc.verifiedPurchase),
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    reviewer: displayName(u),
    user: u ? { id: String(u._id), name: u.name, email: u.email } : null,
    product: p ? { id: String(p._id), name: p.name, slug: p.slug } : null,
    orderNumber: o?.orderNumber || null,
  }
}

function orderContainsProduct(order, productId) {
  const target = String(productId)
  return (order.items || []).some((l) => String(l.product) === target)
}

/* ---------------- public ---------------- */

/* GET /api/products/:productId/reviews — approved only, newest first. */
export async function listProductReviews(req, res, next) {
  try {
    const product = await findProductByParam(req.params.productId)
    if (!product) return bad(res, 404, 'Product not found.')
    const page = parsePage(req.query.page)
    const limit = parseLimit(req.query.limit)
    const skip = (page - 1) * limit
    const filter = { product: product._id, status: 'approved' }
    const [total, docs, summary] = await Promise.all([
      Review.countDocuments(filter),
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name'),
      ratingSummary(product._id),
    ])
    const viewerId = req.user ? String(req.user._id) : null
    return res.status(200).json({
      success: true,
      data: {
        reviews: docs.map((d) => serializePublicReview(d, viewerId)),
        summary,
        pagination: { page, limit, total, pages: total === 0 ? 0 : Math.ceil(total / limit) },
      },
    })
  } catch (err) {
    return next(err)
  }
}

/* GET /api/products/:productId/reviews/eligibility — what the Write a
   Review UI needs: eligible orders, or a machine-readable reason. */
export async function getReviewEligibility(req, res, next) {
  try {
    const product = await findProductByParam(req.params.productId)
    if (!product) return bad(res, 404, 'Product not found.')
    const [orders, mine] = await Promise.all([
      Order.find({ user: req.user._id }).sort({ createdAt: -1 }),
      Review.find({ user: req.user._id, product: product._id }).sort({ createdAt: -1 }),
    ])
    const containing = orders.filter((o) => orderContainsProduct(o, product._id))
    const reviewedOrderIds = new Set(mine.map((r) => String(r.order)))
    const deliveredUnused = containing.filter(
      (o) => o.orderStatus === 'delivered' && !reviewedOrderIds.has(String(o._id)),
    )
    let eligible = deliveredUnused.length > 0
    let reason = null
    if (!eligible) {
      if (mine.length > 0 && containing.length > 0) reason = 'already-reviewed'
      else if (containing.length > 0) reason = 'not-delivered'
      else reason = 'not-purchased'
    }
    return res.status(200).json({
      success: true,
      data: {
        eligible,
        reason,
        eligibleOrders: deliveredUnused.map((o) => ({
          orderNumber: o.orderNumber,
          createdAt: o.createdAt,
        })),
        userReview: mine[0]
          ? {
            id: String(mine[0]._id),
            rating: mine[0].rating,
            title: mine[0].title || '',
            comment: mine[0].comment,
            status: mine[0].status,
          }
          : null,
      },
    })
  } catch (err) {
    return next(err)
  }
}

/* POST /api/products/:productId/reviews — verified purchase only.
   Body: { rating, title?, comment, orderNumber }. user,
   verifiedPurchase and status are server-set; client values ignored. */
export async function createProductReview(req, res, next) {
  try {
    const product = await findProductByParam(req.params.productId)
    if (!product) return bad(res, 404, 'Product not found.')
    const { value, error } = validateReviewContent(req.body || {})
    if (error) return bad(res, 400, error)
    const orderNumber = String(req.body?.orderNumber || '').trim()
    if (!orderNumber) return bad(res, 400, 'Order reference is required.')

    /* Owner-scoped lookup: a stranger's order reads as "not found". */
    const order = await Order.findOne({ orderNumber, user: req.user._id })
    if (!order) return bad(res, 404, 'Order not found.')
    if (!orderContainsProduct(order, product._id)) {
      return bad(res, 403, 'This product is not part of that order.')
    }
    if (order.orderStatus !== 'delivered') {
      return bad(res, 403, 'You can review this product once your order is delivered.')
    }

    const dupe = await Review.findOne({
      user: req.user._id,
      product: product._id,
      order: order._id,
    }).lean()
    if (dupe) {
      return bad(res, 409, 'You have already reviewed this product from this order.')
    }

    let review
    try {
      review = await Review.create({
        user: req.user._id,
        product: product._id,
        order: order._id,
        rating: value.rating,
        title: value.title,
        comment: value.comment,
        verifiedPurchase: true,
        status: 'pending',
      })
    } catch (err) {
      if (err && err.code === 11000) {
        return bad(res, 409, 'You have already reviewed this product from this order.')
      }
      throw err
    }
    await review.populate('user', 'name')
    return res.status(201).json({
      success: true,
      message: 'Review submitted. It will appear once approved.',
      data: { review: serializePublicReview(review, String(req.user._id)) },
    })
  } catch (err) {
    return next(err)
  }
}

/* PATCH /api/reviews/:id — owner edits content only. Editing an
   approved review sends it back to `pending` for re-moderation. */
export async function updateReview(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    if (!mongoose.isValidObjectId(id)) return bad(res, 404, 'Review not found.')
    const review = await Review.findById(id)
    if (!review) return bad(res, 404, 'Review not found.')
    if (String(review.user) !== String(req.user._id)) {
      return bad(res, 403, 'You can only edit your own reviews.')
    }
    const { value, error } = validateReviewContent({
      rating: req.body?.rating ?? review.rating,
      title: req.body?.title ?? review.title,
      comment: req.body?.comment ?? review.comment,
    })
    if (error) return bad(res, 400, error)
    const wasApproved = review.status === 'approved'
    review.rating = value.rating
    review.title = value.title
    review.comment = value.comment
    if (wasApproved) review.status = 'pending'
    await review.save()
    if (wasApproved) await recalcProductRating(review.product)
    await review.populate('user', 'name')
    return res.status(200).json({
      success: true,
      ...(wasApproved ? { message: 'Review updated. It will reappear once re-approved.' } : {}),
      data: { review: serializePublicReview(review, String(req.user._id)) },
    })
  } catch (err) {
    return next(err)
  }
}

/* DELETE /api/reviews/:id — owner or admin. */
export async function deleteReview(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    if (!mongoose.isValidObjectId(id)) return bad(res, 404, 'Review not found.')
    const review = await Review.findById(id)
    if (!review) return bad(res, 404, 'Review not found.')
    const isOwner = String(review.user) === String(req.user._id)
    const isAdmin = req.user.role === 'admin'
    if (!isOwner && !isAdmin) {
      return bad(res, 403, 'You can only delete your own reviews.')
    }
    const wasApproved = review.status === 'approved'
    const productId = review.product
    await Review.deleteOne({ _id: review._id })
    if (wasApproved) await recalcProductRating(productId)
    return res.status(200).json({ success: true, message: 'Review deleted.' })
  } catch (err) {
    return next(err)
  }
}
