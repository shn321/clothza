import Order, { ORDER_STATUSES } from '../models/Order.js'
import Product from '../models/Product.js'
import User from '../models/User.js'

/* CLOTHZA analytics service (Step 20) — business intelligence computed
   LIVE from MongoDB via aggregation pipelines. Nothing is hard-coded
   and no frontend-supplied totals are ever trusted.
   Revenue rule (matches the existing dashboard): an order counts as
   revenue ONLY when paymentStatus is 'paid' AND orderStatus is not
   'cancelled'. Cancelled / failed / pending-payment orders never count.
   TIMEZONE: all day boundaries and daily buckets use UTC. The API
   returns ISO date strings (YYYY-MM-DD, UTC); the admin UI renders them
   as-is so server and client always agree regardless of the viewer's
   local timezone. */

export const ANALYTICS_RANGES = ['today', '7d', '30d', '90d', 'custom', 'all']
const MAX_CUSTOM_DAYS = 366
const DAY_MS = 24 * 60 * 60 * 1000

function startOfUtcDay(date) {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function toUtcDateString(date) {
  return new Date(date).toISOString().slice(0, 10)
}

/* Parse & validate the range query. Throws { status, message } on bad
   input — the controller maps these to 400 responses. */
export function parseRange(query = {}) {
  const raw = String(query.range || '30d').trim().toLowerCase()
  if (!ANALYTICS_RANGES.includes(raw)) {
    throw {
      status: 400,
      message: `Invalid range. Allowed: ${ANALYTICS_RANGES.join(', ')}.`,
    }
  }
  const now = new Date()
  if (raw === 'all') {
    return { key: 'all', start: null, end: null }
  }
  if (raw === 'today') {
    const start = startOfUtcDay(now)
    return { key: 'today', start, end: now }
  }
  const presetDays = { '7d': 7, '30d': 30, '90d': 90 }
  if (presetDays[raw]) {
    const start = new Date(now.getTime() - (presetDays[raw] - 1) * DAY_MS)
    return { key: raw, start: startOfUtcDay(start), end: now }
  }
  // custom: ?range=custom&start=ISO&end=ISO
  const start = new Date(String(query.start || ''))
  const end = new Date(String(query.end || ''))
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw { status: 400, message: 'Custom range requires valid ISO start and end dates.' }
  }
  if (start > end) {
    throw { status: 400, message: 'Range start must not be after range end.' }
  }
  if (end.getTime() - start.getTime() > MAX_CUSTOM_DAYS * DAY_MS) {
    throw { status: 400, message: `Custom range must not exceed ${MAX_CUSTOM_DAYS} days.` }
  }
  return { key: 'custom', start, end }
}

function createdBetween(start, end) {
  if (!start && !end) return {}
  const createdAt = {}
  if (start) createdAt.$gte = start
  if (end) createdAt.$lte = end
  return { createdAt }
}

/* Match stage for orders that count toward revenue. */
function revenueMatch(extra = {}) {
  return { paymentStatus: 'paid', orderStatus: { $ne: 'cancelled' }, ...extra }
}

/* Match stage for orders that count as "real" orders (not cancelled). */
function validOrderMatch(extra = {}) {
  return { orderStatus: { $ne: 'cancelled' }, ...extra }
}

/* ---------------- overview ---------------- */

export async function getOverview({ start, end } = {}) {
  const dateFilter = createdBetween(start, end)
  const [
    revenueAgg,
    ordersInRange,
    totalOrders,
    totalCustomers,
    totalProducts,
    statusAgg,
    paidAgg,
    unpaidAgg,
  ] = await Promise.all([
    Order.aggregate([
      { $match: revenueMatch(dateFilter) },
      { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
    ]),
    Order.countDocuments(validOrderMatch(dateFilter)),
    Order.countDocuments(),
    User.countDocuments({ role: 'user' }),
    Product.countDocuments(),
    Order.aggregate([{ $group: { _id: '$orderStatus', count: { $sum: 1 } } }]),
    Order.aggregate([
      { $match: revenueMatch() },
      { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
    ]),
    Order.countDocuments({ paymentStatus: { $ne: 'paid' } }),
  ])

  const periodRevenue = revenueAgg[0]?.revenue || 0
  const periodOrders = ordersInRange
  const lifetime = paidAgg[0] || { revenue: 0, count: 0 }

  const ordersByStatus = {}
  for (const s of ORDER_STATUSES) ordersByStatus[s] = 0
  for (const row of statusAgg) {
    if (row._id in ordersByStatus) ordersByStatus[row._id] = row.count
  }

  return {
    totals: {
      revenue: lifetime.revenue || 0,
      orders: totalOrders,
      customers: totalCustomers,
      products: totalProducts,
      paidOrders: lifetime.count || 0,
      unpaidOrders: unpaidAgg,
      averageOrderValue: lifetime.count > 0 ? lifetime.revenue / lifetime.count : 0,
    },
    period: {
      revenue: periodRevenue,
      orders: periodOrders,
      averageOrderValue: periodOrders > 0 ? periodRevenue / periodOrders : 0,
    },
    ordersByStatus,
  }
}

/* ---------------- sales over time ---------------- */

export async function getSales({ start, end }) {
  // Bucket every valid order per UTC day; revenue only from paid rows.
  const rows = await Order.aggregate([
    { $match: validOrderMatch(createdBetween(start, end)) },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
        orders: { $sum: 1 },
        revenue: {
          $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$total', 0] },
        },
      },
    },
    { $sort: { _id: 1 } },
  ])
  const byDay = new Map(rows.map((r) => [r._id, { orders: r.orders, revenue: r.revenue }]))

  // Zero-fill every day in the range so charts never show gaps.
  const days = []
  const cursor = startOfUtcDay(start)
  const last = startOfUtcDay(end)
  while (cursor <= last) {
    const key = toUtcDateString(cursor)
    const hit = byDay.get(key) || { orders: 0, revenue: 0 }
    days.push({ date: key, orders: hit.orders, revenue: hit.revenue })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  const totals = days.reduce(
    (acc, d) => ({ orders: acc.orders + d.orders, revenue: acc.revenue + d.revenue }),
    { orders: 0, revenue: 0 },
  )
  return { days, totals }
}

/* ---------------- top products (from order snapshots) ---------------- */

export async function getTopProducts({ start, end, limit = 10 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 20)
  const items = await Order.aggregate([
    { $match: validOrderMatch(createdBetween(start, end)) },
    { $unwind: '$items' },
    {
      $group: {
        /* Snapshot identity: slug + name as sold. Historical revenue
           uses the SNAPSHOT price (price at purchase), never the
           product's current price. */
        _id: { slug: '$items.slug', name: '$items.name' },
        quantity: { $sum: '$items.qty' },
        revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } },
        orderIds: { $addToSet: '$_id' },
      },
    },
    {
      $project: {
        _id: 0,
        slug: '$_id.slug',
        name: '$_id.name',
        quantity: 1,
        revenue: 1,
        orders: { $size: '$orderIds' },
      },
    },
    { $sort: { revenue: -1, quantity: -1 } },
    { $limit: safeLimit },
  ])
  return { items }
}

/* ---------------- category performance ---------------- */

export async function getCategories({ start, end }) {
  /* Order item snapshots carry no category, so join the live Product
     via items.product. Products deleted since purchase miss the join
     and are bucketed as 'uncategorized' — never dropped, never faked. */
  const items = await Order.aggregate([
    { $match: validOrderMatch(createdBetween(start, end)) },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'product',
      },
    },
    {
      $group: {
        _id: {
          $ifNull: [{ $arrayElemAt: ['$product.category', 0] }, 'uncategorized'],
        },
        quantity: { $sum: '$items.qty' },
        revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } },
        orderIds: { $addToSet: '$_id' },
      },
    },
    {
      $project: {
        _id: 0,
        category: '$_id',
        quantity: 1,
        revenue: 1,
        orders: { $size: '$orderIds' },
      },
    },
    { $sort: { revenue: -1, quantity: -1 } },
  ])
  return { items }
}

/* ---------------- customer analytics (aggregated, no PII) ---------------- */

export async function getCustomers({ start, end }) {
  const dateFilter = createdBetween(start, end)
  const [
    totalCustomers,
    newCustomers,
    perCustomer,
    withOrdersAgg,
  ] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'user', ...dateFilter }),
    Order.aggregate([
      { $match: validOrderMatch(dateFilter) },
      { $group: { _id: '$user', orders: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: validOrderMatch() },
      { $group: { _id: '$user' } },
      { $count: 'customers' },
    ]),
  ])
  const inPeriod = perCustomer.length
  const repeatInPeriod = perCustomer.filter((r) => r.orders > 1).length
  const periodOrders = perCustomer.reduce((n, r) => n + r.orders, 0)
  return {
    totalCustomers,
    newCustomers,
    customersWithOrders: withOrdersAgg[0]?.customers || 0,
    customersWithOrdersInPeriod: inPeriod,
    repeatCustomers: repeatInPeriod,
    averageOrdersPerCustomer: inPeriod > 0 ? periodOrders / inPeriod : 0,
  }
}

/* ---------------- coupon analytics (read-only over snapshots) ---------------- */

export async function getCoupons({ start, end }) {
  /* Uses ONLY the coupon snapshot stored on each order at purchase
     time (code + discountAmount). The coupon calculation engine is
     never touched or re-implemented here. */
  const dateFilter = createdBetween(start, end)
  const [overall, top] = await Promise.all([
    Order.aggregate([
      { $match: validOrderMatch({ ...dateFilter, 'coupon.code': { $exists: true } }) },
      {
        $group: {
          _id: null,
          uses: { $sum: 1 },
          discount: { $sum: '$coupon.discountAmount' },
        },
      },
    ]),
    Order.aggregate([
      { $match: validOrderMatch({ ...dateFilter, 'coupon.code': { $exists: true } }) },
      {
        $group: {
          _id: '$coupon.code',
          uses: { $sum: 1 },
          discount: { $sum: '$coupon.discountAmount' },
        },
      },
      {
        $project: { _id: 0, code: '$_id', uses: 1, discount: 1 },
      },
      { $sort: { uses: -1, discount: -1 } },
      { $limit: 10 },
    ]),
  ])
  return {
    totalUses: overall[0]?.uses || 0,
    totalDiscount: overall[0]?.discount || 0,
    top,
  }
}
