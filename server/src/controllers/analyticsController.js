import {
  getCategories,
  getCoupons,
  getCustomers,
  getOverview,
  getSales,
  getTopProducts,
  parseRange,
} from '../services/analyticsService.js'

/* CLOTHZA analytics API (Step 20) — admin-only business intelligence.
   Routes sit behind requireAuth + requireAdmin; every number is
   computed live from MongoDB aggregations. Responses contain aggregate
   metrics only — no passwords, hashes, tokens, payment credentials or
   notification history. */

function rangePayload(range) {
  return {
    key: range.key,
    start: range.start ? range.start.toISOString() : null,
    end: range.end ? range.end.toISOString() : null,
    timezone: 'UTC',
  }
}

function rangeError(res, err) {
  if (err && Number.isInteger(err.status)) {
    return res.status(err.status).json({ success: false, message: err.message })
  }
  throw err
}

/* GET /api/admin/analytics/overview?range=30d */
export async function getAnalyticsOverview(req, res, next) {
  try {
    let range
    try {
      range = parseRange(req.query)
    } catch (err) {
      return rangeError(res, err)
    }
    const data = await getOverview(range)
    return res.status(200).json({ success: true, data: { range: rangePayload(range), ...data } })
  } catch (err) {
    return next(err)
  }
}

/* GET /api/admin/analytics/sales?range=30d */
export async function getAnalyticsSales(req, res, next) {
  try {
    let range
    try {
      range = parseRange(req.query)
    } catch (err) {
      return rangeError(res, err)
    }
    if (range.key === 'all') {
      return res.status(400).json({
        success: false,
        message: 'Sales over time requires a bounded range (today, 7d, 30d, 90d or custom).',
      })
    }
    const data = await getSales(range)
    return res.status(200).json({ success: true, data: { range: rangePayload(range), ...data } })
  } catch (err) {
    return next(err)
  }
}

/* GET /api/admin/analytics/products?range=30d&limit=10 */
export async function getAnalyticsProducts(req, res, next) {
  try {
    let range
    try {
      range = parseRange(req.query)
    } catch (err) {
      return rangeError(res, err)
    }
    const limit = [5, 10, 20].includes(Number(req.query.limit)) ? Number(req.query.limit) : 10
    const data = await getTopProducts({ ...range, limit })
    return res.status(200).json({ success: true, data: { range: rangePayload(range), limit, ...data } })
  } catch (err) {
    return next(err)
  }
}

/* GET /api/admin/analytics/categories?range=30d */
export async function getAnalyticsCategories(req, res, next) {
  try {
    let range
    try {
      range = parseRange(req.query)
    } catch (err) {
      return rangeError(res, err)
    }
    const data = await getCategories(range)
    return res.status(200).json({ success: true, data: { range: rangePayload(range), ...data } })
  } catch (err) {
    return next(err)
  }
}

/* GET /api/admin/analytics/customers?range=30d */
export async function getAnalyticsCustomers(req, res, next) {
  try {
    let range
    try {
      range = parseRange(req.query)
    } catch (err) {
      return rangeError(res, err)
    }
    const data = await getCustomers(range)
    return res.status(200).json({ success: true, data: { range: rangePayload(range), ...data } })
  } catch (err) {
    return next(err)
  }
}

/* GET /api/admin/analytics/coupons?range=30d */
export async function getAnalyticsCoupons(req, res, next) {
  try {
    let range
    try {
      range = parseRange(req.query)
    } catch (err) {
      return rangeError(res, err)
    }
    const data = await getCoupons(range)
    return res.status(200).json({ success: true, data: { range: rangePayload(range), ...data } })
  } catch (err) {
    return next(err)
  }
}
