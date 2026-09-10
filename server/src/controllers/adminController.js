import mongoose from 'mongoose'
import Order, { ORDER_STATUSES } from '../models/Order.js'
import Product from '../models/Product.js'
import Review, { REVIEW_STATUSES } from '../models/Review.js'
import User from '../models/User.js'
import { serializeOrder } from './orderController.js'
import { notifyOrderEvent } from '../services/notificationService.js'
import { recalcProductRating, serializeAdminReview } from './reviewController.js'

/* CLOTHZA admin API (Step 16) — every route sits behind requireAuth +
   requireAdmin. The acting user always comes from the JWT session
   (req.user); userId, role, revenue, ownership or totals supplied by
   the client are never trusted. All dashboard numbers are computed
   live from MongoDB — nothing is hard-coded. */

const ALLOWED_GENDERS = ['men', 'women', 'unisex']
const ALLOWED_SORTS = ['newest', 'price-low', 'price-high', 'rating', 'featured', 'name']
const LOW_STOCK_THRESHOLD = 5
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

const SORT_MAP = {
  newest: { createdAt: -1 },
  'price-low': { price: 1 },
  'price-high': { price: -1 },
  rating: { rating: -1, reviewCount: -1 },
  featured: { isFeatured: -1, isBestSeller: -1, rating: -1 },
  name: { name: 1 },
}

/* Final states — an order that is delivered or cancelled can never
   move again. All other transitions are allowed forward/sideways
   except re-opening a final state. */
const FINAL_STATUSES = ['delivered', 'cancelled']
const ADMIN_TRANSITIONS = {
  pending: ['confirmed', 'processing', 'shipped', 'cancelled'],
  confirmed: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parsePage(value) {
  const n = Number.parseInt(value, 10)
  return Number.isInteger(n) && n > 0 ? n : 1
}

function parseLimit(value, fallback = DEFAULT_LIMIT) {
  const n = Number.parseInt(value, 10)
  if (!Number.isInteger(n) || n <= 0) return fallback
  return Math.min(n, MAX_LIMIT)
}

function bad(res, status, message) {
  return res.status(status).json({ success: false, message })
}

/* ---------------- product validation (server-side, never trusts UI) ---------------- */

function toStr(v) {
  return String(v ?? '').trim()
}

function toStrArray(v) {
  if (v === undefined || v === null) return undefined
  const arr = Array.isArray(v) ? v : [v]
  return arr.map((x) => String(x).trim()).filter((x) => x.length > 0)
}

function isValidUrlOrPath(v) {
  const s = String(v).trim()
  if (!s || s.length > 2048) return false
  return /^(https?:\/\/|\/).+/i.test(s)
}

function pickFlag(body, camel, spec) {
  if (body?.[camel] !== undefined) return body[camel]
  if (body?.[spec] !== undefined) return body[spec]
  return undefined
}

/* Returns { value } on success or { error } on failure. partial=true
   (PATCH) allows a subset; otherwise name/slug/price/category are required. */
function validateProductInput(body, { partial = false } = {}) {
  const src = body && typeof body === 'object' ? body : {}
  const out = {}
  const fail = (message) => ({ error: message })

  if (src.name !== undefined || !partial) {
    const name = toStr(src.name)
    if (!name) return fail('Product name is required.')
    if (name.length > 160) return fail('Product name is too long.')
    out.name = name
  }
  if (src.slug !== undefined || !partial) {
    const slug = toStr(src.slug).toLowerCase()
    if (!slug) return fail('Product slug is required.')
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return fail('Slug must be lowercase letters, numbers and hyphens only.')
    }
    out.slug = slug
  }
  if (src.description !== undefined) out.description = toStr(src.description).slice(0, 5000)
  if (src.price !== undefined || !partial) {
    const price = Number(src.price)
    if (!Number.isFinite(price) || price < 0) return fail('Price must be a non-negative number.')
    if (price > 10000000) return fail('Price is unrealistically large.')
    out.price = price
  }
  if (src.originalPrice !== undefined) {
    if (src.originalPrice === null || src.originalPrice === '') {
      out.originalPrice = null
    } else {
      const v = Number(src.originalPrice)
      if (!Number.isFinite(v) || v < 0) return fail('Original price must be a non-negative number.')
      out.originalPrice = v
    }
  }
  if (src.category !== undefined || !partial) {
    const category = toStr(src.category).toLowerCase()
    if (!category) return fail('Category is required.')
    if (category.length > 60) return fail('Category is too long.')
    out.category = category
  }
  if (src.subcategory !== undefined) out.subcategory = toStr(src.subcategory).slice(0, 60)
  if (src.gender !== undefined) {
    const gender = toStr(src.gender).toLowerCase()
    if (!ALLOWED_GENDERS.includes(gender)) {
      return fail(`Invalid gender. Allowed: ${ALLOWED_GENDERS.join(', ')}.`)
    }
    out.gender = gender
  }
  if (src.images !== undefined) {
    const images = toStrArray(src.images) ?? []
    for (const img of images) {
      if (!isValidUrlOrPath(img)) return fail('Each image must be a valid http(s) URL or site path.')
    }
    if (images.length > 20) return fail('Too many images (max 20).')
    out.images = images
  }
  if (src.colors !== undefined) {
    const colors = toStrArray(src.colors) ?? []
    if (colors.length > 30) return fail('Too many colors (max 30).')
    out.colors = colors
  }
  if (src.sizes !== undefined) {
    const sizes = toStrArray(src.sizes) ?? []
    if (sizes.length > 30) return fail('Too many sizes (max 30).')
    out.sizes = sizes
  }
  if (src.stock !== undefined) {
    const stock = Number(src.stock)
    if (!Number.isInteger(stock) || stock < 0) return fail('Stock must be a non-negative integer.')
    if (stock > 1000000) return fail('Stock is unrealistically large.')
    out.stock = stock
  }
  if (src.rating !== undefined) {
    const rating = Number(src.rating)
    if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
      return fail('Rating must be between 0 and 5.')
    }
    out.rating = rating
  }
  if (src.reviewCount !== undefined) {
    const rc = Number(src.reviewCount)
    if (!Number.isInteger(rc) || rc < 0) return fail('Review count must be a non-negative integer.')
    out.reviewCount = rc
  }
  if (src.tags !== undefined) {
    const tags = toStrArray(src.tags) ?? []
    if (tags.length > 30) return fail('Too many tags (max 30).')
    out.tags = tags.map((t) => t.toLowerCase()).slice(0, 30)
  }
  for (const [camel, spec] of [['isFeatured', 'featured'], ['isBestSeller', 'bestseller'], ['isNewArrival', 'newArrival']]) {
    const raw = pickFlag(src, camel, spec)
    if (raw !== undefined) {
      if (typeof raw !== 'boolean') return fail(`"${spec}" must be true or false.`)
      out[camel] = raw
    }
  }
  return { value: out }
}

function serializeProduct(doc) {
  const o = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : doc
  return o
}

/* ---------------- dashboard ---------------- */

/* GET /api/admin/dashboard */
export async function getDashboard(req, res, next) {
  try {
    const [
      totalProducts,
      totalOrders,
      totalCustomers,
      paidAgg,
      pendingOrders,
      processingOrders,
      deliveredOrders,
      lowStockProducts,
      recentDocs,
    ] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      User.countDocuments({ role: 'user' }),
      /* Revenue counts ONLY paid orders — pending/failed are excluded. */
      Order.aggregate([
        { $match: { paymentStatus: 'paid' } },
        { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      Order.countDocuments({ orderStatus: 'pending' }),
      Order.countDocuments({ orderStatus: 'processing' }),
      Order.countDocuments({ orderStatus: 'delivered' }),
      Product.find({ stock: { $lte: LOW_STOCK_THRESHOLD } })
        .sort({ stock: 1, name: 1 })
        .limit(10)
        .lean({ virtuals: true }),
      Order.find().sort({ createdAt: -1 }).limit(8),
    ])

    const paid = paidAgg[0] || { revenue: 0, count: 0 }
    const [pendingPayments, failedPayments] = await Promise.all([
      Order.countDocuments({ paymentStatus: 'pending' }),
      Order.countDocuments({ paymentStatus: 'failed' }),
    ])

    return res.status(200).json({
      success: true,
      data: {
        totals: {
          products: totalProducts,
          orders: totalOrders,
          customers: totalCustomers,
          revenue: paid.revenue || 0,
          paidOrders: paid.count || 0,
          pendingPayments,
          failedPayments,
        },
        ordersByStatus: {
          pending: pendingOrders,
          processing: processingOrders,
          delivered: deliveredOrders,
        },
        lowStock: {
          threshold: LOW_STOCK_THRESHOLD,
          count: lowStockProducts.length,
          products: lowStockProducts,
        },
        recentOrders: recentDocs.map(serializeOrder),
      },
    })
  } catch (err) {
    return next(err)
  }
}

/* ---------------- products ---------------- */

/* GET /api/admin/products */
export async function listAdminProducts(req, res, next) {
  try {
    const filter = {}
    if (req.query.gender !== undefined && String(req.query.gender).trim() !== '') {
      const gender = String(req.query.gender).toLowerCase().trim()
      if (!ALLOWED_GENDERS.includes(gender)) {
        return bad(res, 400, `Invalid gender. Allowed: ${ALLOWED_GENDERS.join(', ')}.`)
      }
      filter.gender = gender
    }
    if (req.query.category !== undefined && String(req.query.category).trim() !== '') {
      filter.category = String(req.query.category).toLowerCase().trim().slice(0, 60)
    }
    if (req.query.q !== undefined && String(req.query.q).trim() !== '') {
      const rx = new RegExp(escapeRegExp(String(req.query.q).trim().slice(0, 100)), 'i')
      filter.$or = [{ name: rx }, { slug: rx }, { description: rx }, { category: rx }, { tags: rx }]
    }
    const sortKey = ALLOWED_SORTS.includes(req.query.sort) ? req.query.sort : 'newest'
    const page = parsePage(req.query.page)
    const limit = parseLimit(req.query.limit)
    const skip = (page - 1) * limit
    const [total, items] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter).sort(SORT_MAP[sortKey]).skip(skip).limit(limit).lean({ virtuals: true }),
    ])
    return res.status(200).json({
      success: true,
      data: items,
      pagination: { page, limit, total, pages: total === 0 ? 0 : Math.ceil(total / limit) },
    })
  } catch (err) {
    return next(err)
  }
}

async function findProductByIdParam(idParam) {
  const raw = String(idParam || '').trim()
  if (!raw) return null
  if (mongoose.isValidObjectId(raw)) {
    const byId = await Product.findById(raw)
    if (byId) return byId
  }
  return Product.findOne({ slug: raw.toLowerCase() })
}

/* GET /api/admin/products/:id */
export async function getAdminProduct(req, res, next) {
  try {
    const product = await findProductByIdParam(req.params.id)
    if (!product) return bad(res, 404, 'Product not found.')
    return res.status(200).json({ success: true, data: serializeProduct(product) })
  } catch (err) {
    return next(err)
  }
}

/* POST /api/admin/products */
export async function createAdminProduct(req, res, next) {
  try {
    const { value, error } = validateProductInput(req.body, { partial: false })
    if (error) return bad(res, 400, error)
    const existing = await Product.findOne({ slug: value.slug }).lean()
    if (existing) return bad(res, 409, 'A product with this slug already exists.')
    const created = await Product.create({
      description: '',
      gender: 'unisex',
      subcategory: '',
      images: [],
      colors: [],
      sizes: [],
      stock: 0,
      rating: 0,
      reviewCount: 0,
      tags: [],
      isFeatured: false,
      isBestSeller: false,
      isNewArrival: false,
      ...value,
    })
    return res.status(201).json({ success: true, data: serializeProduct(created) })
  } catch (err) {
    if (err && err.code === 11000) return bad(res, 409, 'A product with this slug already exists.')
    return next(err)
  }
}

/* PATCH /api/admin/products/:id */
export async function updateAdminProduct(req, res, next) {
  try {
    const product = await findProductByIdParam(req.params.id)
    if (!product) return bad(res, 404, 'Product not found.')
    const { value, error } = validateProductInput(req.body, { partial: true })
    if (error) return bad(res, 400, error)
    if (Object.keys(value).length === 0) return bad(res, 400, 'No valid fields to update.')
    if (value.slug && value.slug !== product.slug) {
      const clash = await Product.findOne({ slug: value.slug, _id: { $ne: product._id } }).lean()
      if (clash) return bad(res, 409, 'A product with this slug already exists.')
    }
    Object.assign(product, value)
    await product.save()
    return res.status(200).json({ success: true, data: serializeProduct(product) })
  } catch (err) {
    if (err && err.code === 11000) return bad(res, 409, 'A product with this slug already exists.')
    return next(err)
  }
}

/* DELETE /api/admin/products/:id — hard delete of the catalog document
   only. Order items keep full snapshots, so historic orders are
   unaffected. Cart/wishlist lines referencing the product resolve to
   null and are handled by those flows. */
export async function deleteAdminProduct(req, res, next) {
  try {
    const product = await findProductByIdParam(req.params.id)
    if (!product) return bad(res, 404, 'Product not found.')
    await Product.deleteOne({ _id: product._id })
    return res.status(200).json({ success: true, message: 'Product deleted.' })
  } catch (err) {
    return next(err)
  }
}

/* ---------------- orders ---------------- */

/* GET /api/admin/orders */
export async function listAdminOrders(req, res, next) {
  try {
    const filter = {}
    if (req.query.status !== undefined && String(req.query.status).trim() !== '') {
      const status = String(req.query.status).trim().toLowerCase()
      if (!ORDER_STATUSES.includes(status)) return bad(res, 400, 'Invalid order status.')
      filter.orderStatus = status
    }
    if (req.query.paymentStatus !== undefined && String(req.query.paymentStatus).trim() !== '') {
      const ps = String(req.query.paymentStatus).trim().toLowerCase()
      if (!['pending', 'paid', 'failed', 'refunded'].includes(ps)) {
        return bad(res, 400, 'Invalid payment status.')
      }
      filter.paymentStatus = ps
    }
    if (req.query.q !== undefined && String(req.query.q).trim() !== '') {
      const rx = new RegExp(escapeRegExp(String(req.query.q).trim().slice(0, 100)), 'i')
      filter.$or = [
        { orderNumber: rx },
        { 'customer.email': rx },
        { 'customer.firstName': rx },
        { 'customer.lastName': rx },
      ]
    }
    const page = parsePage(req.query.page)
    const limit = parseLimit(req.query.limit)
    const skip = (page - 1) * limit
    const [total, docs] = await Promise.all([
      Order.countDocuments(filter),
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ])
    return res.status(200).json({
      success: true,
      data: {
        orders: docs.map(serializeOrder),
        pagination: { page, limit, total, pages: total === 0 ? 0 : Math.ceil(total / limit) },
      },
    })
  } catch (err) {
    return next(err)
  }
}

/* GET /api/admin/orders/:orderNumber */
export async function getAdminOrder(req, res, next) {
  try {
    const orderNumber = String(req.params.orderNumber || '').trim()
    if (!orderNumber) return bad(res, 404, 'Order not found.')
    const order = await Order.findOne({ orderNumber }).populate('user', 'name email role createdAt')
    if (!order) return bad(res, 404, 'Order not found.')
    const data = serializeOrder(order)
    const u = order.user && typeof order.user === 'object' ? order.user : null
    return res.status(200).json({
      success: true,
      data: {
        order: data,
        account: u ? { id: String(u._id), name: u.name, email: u.email, role: u.role || 'user' } : null,
      },
    })
  } catch (err) {
    return next(err)
  }
}

/* Step 19 — status → customer notification mapping. Only real
   transitions notify: the unchanged-status early return above sends
   nothing, so `processing → processing` never duplicates. */
const STATUS_NOTIFICATIONS = {
  confirmed: 'ORDER_CONFIRMED',
  processing: 'ORDER_PROCESSING',
  shipped: 'ORDER_SHIPPED',
  delivered: 'ORDER_DELIVERED',
  cancelled: 'ORDER_CANCELLED',
}

/* PATCH /api/admin/orders/:orderNumber/status — { status } */
export async function updateAdminOrderStatus(req, res, next) {
  try {
    const orderNumber = String(req.params.orderNumber || '').trim()
    if (!orderNumber) return bad(res, 404, 'Order not found.')
    const nextStatus = String(req.body?.status || '').trim().toLowerCase()
    if (!ORDER_STATUSES.includes(nextStatus)) {
      return bad(res, 400, `Invalid status. Allowed: ${ORDER_STATUSES.join(', ')}.`)
    }
    const order = await Order.findOne({ orderNumber })
    if (!order) return bad(res, 404, 'Order not found.')
    if (order.orderStatus === nextStatus) {
      return res.status(200).json({ success: true, data: { order: serializeOrder(order) } })
    }
    const allowed = ADMIN_TRANSITIONS[order.orderStatus] || []
    if (!allowed.includes(nextStatus)) {
      return bad(res, 409, `Cannot move order from "${order.orderStatus}" to "${nextStatus}".`)
    }
    order.orderStatus = nextStatus
    if (nextStatus === 'cancelled') order.cancelledAt = new Date()
    await order.save()
    /* Step 19 — notify the order owner (+ transactional email where a
       template exists). Best-effort; never breaks the admin response. */
    if (STATUS_NOTIFICATIONS[nextStatus]) {
      await notifyOrderEvent(order, STATUS_NOTIFICATIONS[nextStatus])
    }
    return res.status(200).json({ success: true, data: { order: serializeOrder(order) } })
  } catch (err) {
    return next(err)
  }
}

/* ---------------- customers ---------------- */

const SAFE_CUSTOMER_PROJECTION = { name: 1, email: 1, role: 1, createdAt: 1 }

/* GET /api/admin/customers — safe shapes only. passwordHash, tokens,
   payment secrets and card data are never selected or returned. */
export async function listAdminCustomers(req, res, next) {
  try {
    const page = parsePage(req.query.page)
    const limit = parseLimit(req.query.limit, 20)
    const skip = (page - 1) * limit
    const search = String(req.query.q || '').trim().slice(0, 100)
    const filter = {}
    if (search) {
      const rx = new RegExp(escapeRegExp(search), 'i')
      filter.$or = [{ name: rx }, { email: rx }]
    }
    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter, SAFE_CUSTOMER_PROJECTION).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ])
    const userIds = users.map((u) => u._id)
    const stats = userIds.length
      ? await Order.aggregate([
        { $match: { user: { $in: userIds }, orderStatus: { $ne: 'cancelled' } } },
        {
          $group: {
            _id: '$user',
            orderCount: { $sum: 1 },
            /* Spending counts paid orders only. */
            totalSpent: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$total', 0] },
            },
          },
        },
      ])
      : []
    const byUser = new Map(stats.map((s) => [String(s._id), s]))
    const customers = users.map((u) => {
      const s = byUser.get(String(u._id))
      return {
        id: String(u._id),
        name: u.name,
        email: u.email,
        role: u.role || 'user',
        createdAt: u.createdAt,
        orderCount: s?.orderCount || 0,
        totalSpent: s?.totalSpent || 0,
      }
    })
    return res.status(200).json({
      success: true,
      data: {
        customers,
        pagination: { page, limit, total, pages: total === 0 ? 0 : Math.ceil(total / limit) },
      },
    })
  } catch (err) {
    return next(err)
  }
}

/* ---------------- reviews (Step 17 moderation) ---------------- */

/* GET /api/admin/reviews — filters: q (title/comment/order/reviewer),
   status, rating. Populated shapes never include passwordHash. */
export async function listAdminReviews(req, res, next) {
  try {
    const filter = {}
    if (req.query.status !== undefined && String(req.query.status).trim() !== '') {
      const status = String(req.query.status).trim().toLowerCase()
      if (!REVIEW_STATUSES.includes(status)) return bad(res, 400, 'Invalid review status.')
      filter.status = status
    }
    if (req.query.rating !== undefined && String(req.query.rating).trim() !== '') {
      const rating = Number(req.query.rating)
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return bad(res, 400, 'Rating filter must be a whole number from 1 to 5.')
      }
      filter.rating = rating
    }
    const search = String(req.query.q || '').trim().slice(0, 100)
    if (search) {
      const rx = new RegExp(escapeRegExp(search), 'i')
      const [users, orders] = await Promise.all([
        User.find({ $or: [{ name: rx }, { email: rx }] }, { _id: 1 }).limit(50).lean(),
        Order.find({ orderNumber: rx }, { _id: 1 }).limit(50).lean(),
      ])
      filter.$or = [
        { title: rx },
        { comment: rx },
        { user: { $in: users.map((u) => u._id) } },
        { order: { $in: orders.map((o) => o._id) } },
      ]
    }
    const page = parsePage(req.query.page)
    const limit = parseLimit(req.query.limit, 20)
    const skip = (page - 1) * limit
    const [total, docs] = await Promise.all([
      Review.countDocuments(filter),
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email')
        .populate('product', 'name slug')
        .populate('order', 'orderNumber'),
    ])
    return res.status(200).json({
      success: true,
      data: {
        reviews: docs.map(serializeAdminReview),
        pagination: { page, limit, total, pages: total === 0 ? 0 : Math.ceil(total / limit) },
      },
    })
  } catch (err) {
    return next(err)
  }
}

/* PATCH /api/admin/reviews/:id/status — { status: approved|rejected } */
export async function updateAdminReviewStatus(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    if (!mongoose.isValidObjectId(id)) return bad(res, 404, 'Review not found.')
    const status = String(req.body?.status || '').trim().toLowerCase()
    if (!REVIEW_STATUSES.includes(status) || status === 'pending') {
      return bad(res, 400, 'Status must be "approved" or "rejected".')
    }
    const review = await Review.findById(id)
    if (!review) return bad(res, 404, 'Review not found.')
    review.status = status
    await review.save()
    await recalcProductRating(review.product)
    await review.populate([
      { path: 'user', select: 'name email' },
      { path: 'product', select: 'name slug' },
      { path: 'order', select: 'orderNumber' },
    ])
    return res.status(200).json({ success: true, data: { review: serializeAdminReview(review) } })
  } catch (err) {
    return next(err)
  }
}

/* DELETE /api/admin/reviews/:id */
export async function deleteAdminReview(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    if (!mongoose.isValidObjectId(id)) return bad(res, 404, 'Review not found.')
    const review = await Review.findById(id)
    if (!review) return bad(res, 404, 'Review not found.')
    const wasApproved = review.status === 'approved'
    const productId = review.product
    await Review.deleteOne({ _id: review._id })
    if (wasApproved) await recalcProductRating(productId)
    return res.status(200).json({ success: true, message: 'Review deleted.' })
  } catch (err) {
    return next(err)
  }
}
