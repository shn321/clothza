/* CLOTHZA frontend API layer — single place that talks to the backend.
   Base URL comes from VITE_API_URL (see client/.env.example) with a local
   fallback. No database credentials ever live here. */

export function getApiBase() {
  const fromEnv =
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_URL : undefined
  if (typeof import.meta !== 'undefined' && import.meta.env?.PROD && !fromEnv) {
    // Production build without VITE_API_URL — localhost fallback is
    // development-only; warn once so misconfiguration is obvious.
    console.warn('[clothza] VITE_API_URL is not set; falling back to localhost (development only).')
  }
  // Trim accidental whitespace; accept a bare origin (…:5000) by appending
  // the /api path so VITE_API_URL works with or without it.
  let base = String(fromEnv || 'http://localhost:5000/api').trim().replace(/\/+$/, '')
  if (!/\/api$/i.test(base)) base += '/api'
  return base
}

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request(path, { signal, method = 'GET', body, auth = false } = {}) {
  const url = `${getApiBase()}${path}`
  // Session routes (auth + database cart/wishlist/orders) use the
  // HTTP-only cookie, so credentials must be included. Product routes
  // are public and stay credential-free, exactly as before — except
  // review writes/eligibility, which opt in via `auth: true`.
  const needsCredentials =
    auth ||
    path.startsWith('/auth') ||
    path.startsWith('/cart') ||
    path.startsWith('/coupons') ||
    path.startsWith('/notifications') ||
    path.startsWith('/wishlist') ||
    path.startsWith('/orders') ||
    path.startsWith('/payments') ||
    path.startsWith('/admin') ||
    path.startsWith('/reviews')
  let res
  try {
    res = await fetch(url, {
      signal,
      method,
      // Auth routes use an HTTP-only cookie session, so credentials must
      // be included. Product routes are public and stay credential-free.
      ...(needsCredentials ? { credentials: 'include' } : {}),
      ...(body !== undefined
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    // Safe diagnostic for DevTools (URL + reachability only, no secrets).
    console.error(`[clothza] API request failed: ${method} ${url} — server unreachable.`)
    throw new ApiError('Could not reach the CLOTHZA server.', 0)
  }
  let responseBody = null
  try {
    responseBody = await res.json()
  } catch {
    responseBody = null
  }
  if (!res.ok) {
    console.error(`[clothza] API request failed: ${method} ${url} — status ${res.status}.`)
    throw new ApiError(
      (responseBody && responseBody.message) || `Request failed (${res.status}).`,
      res.status,
    )
  }
  return responseBody
}

/* Normalize a MongoDB-backed product document into the shape the existing
   React components already consume (same fields as the legacy catalog).
   Extra API fields (_id, __v, virtuals, timestamps) are dropped. */
export function normalizeProduct(doc) {
  if (!doc || typeof doc !== 'object') return null
  return {
    id: doc.legacyId || doc.slug || doc._id,
    slug: doc.slug,
    name: doc.name,
    description: doc.description || '',
    category: doc.category,
    subcategory: doc.subcategory || '',
    price: doc.price,
    originalPrice: doc.originalPrice ?? null,
    discountPercentage: doc.discountPercentage ?? null,
    images: Array.isArray(doc.images) ? doc.images : [],
    colors: Array.isArray(doc.colors) ? doc.colors : [],
    sizes: Array.isArray(doc.sizes) ? doc.sizes : [],
    stock: doc.stock ?? 0,
    rating: doc.rating ?? 0,
    reviewCount: doc.reviewCount ?? 0,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    isNewArrival: Boolean(doc.isNewArrival),
    isFeatured: Boolean(doc.isFeatured),
    isBestSeller: Boolean(doc.isBestSeller),
    gender: doc.gender,
  }
}

const ALLOWED_PARAMS = ['gender', 'category', 'subcategory', 'q', 'sort', 'page', 'limit']

/* GET /api/products — returns { items, pagination }. */
export async function fetchProducts(params = {}, { signal } = {}) {
  const query = new URLSearchParams()
  for (const key of ALLOWED_PARAMS) {
    const value = params[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      query.set(key, String(value))
    }
  }
  const suffix = query.toString()
  const body = await request(`/products${suffix ? `?${suffix}` : ''}`, { signal })
  const data = Array.isArray(body?.data) ? body.data : []
  return {
    items: data.map(normalizeProduct).filter(Boolean),
    pagination: body?.pagination || { page: 1, limit: data.length, total: data.length, pages: 1 },
  }
}

/* GET /api/products/:slug — throws ApiError(404) for unknown slugs. */
export async function fetchProductBySlug(slug, { signal } = {}) {
  const body = await request(`/products/${encodeURIComponent(slug)}`, { signal })
  return normalizeProduct(body?.data)
}

/* ---- Auth (HTTP-only cookie session; no token ever touches JS state) ---- */

function toSafeUser(data) {
  const user = data?.user
  if (!user || typeof user !== 'object') return null
  const { id, name, email, role } = user
  if (!id || !name || !email) return null
  return { id: String(id), name, email, role: role || 'user' }
}

/* POST /api/auth/register — { name, email, password } */
export async function registerUser({ name, email, password }) {
  const body = await request('/auth/register', {
    method: 'POST',
    body: { name, email, password },
  })
  return toSafeUser(body?.data)
}

/* POST /api/auth/login — { email, password } */
export async function loginUser({ email, password }) {
  const body = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
  })
  return toSafeUser(body?.data)
}

/* POST /api/auth/logout */
export async function logoutUser() {
  await request('/auth/logout', { method: 'POST' })
}

/* GET /api/auth/me — returns the safe user or throws ApiError(401). */
export async function fetchCurrentUser({ signal } = {}) {
  const body = await request('/auth/me', { signal })
  return toSafeUser(body?.data)
}

/* ---- Database cart (authenticated users; HTTP-only cookie session) ----
   The server returns lines in the exact shape the cart UI and checkout
   already consume; sanitizeCart only guards against malformed payloads. */

function sanitizeCartLine(l) {
  if (!l || typeof l.productId !== 'string' || typeof l.name !== 'string' || typeof l.price !== 'number') {
    return null
  }
  const qty = Number.isInteger(l.qty) && l.qty > 0 ? l.qty : 1
  const max = typeof l.max === 'number' && l.max > 0 ? l.max : 10
  return {
    key: typeof l.key === 'string' ? l.key : `${l.productId}|${l.size || ''}|${l.colour || ''}`,
    productId: l.productId,
    slug: typeof l.slug === 'string' ? l.slug : l.productId,
    name: l.name,
    image: typeof l.image === 'string' ? l.image : '',
    price: l.price,
    size: l.size || null,
    colour: l.colour || null,
    max,
    qty: Math.min(qty, Math.max(1, max)),
  }
}

function toCartData(data) {
  const raw = Array.isArray(data?.items) ? data.items : []
  const items = raw.map(sanitizeCartLine).filter(Boolean)
  const count = items.reduce((n, l) => n + l.qty, 0)
  const subtotal = items.reduce((n, l) => n + l.qty * l.price, 0)
  return { items, count, subtotal }
}

/* GET /api/cart */
export async function fetchCart({ signal } = {}) {
  const body = await request('/cart', { signal })
  return toCartData(body?.data)
}

/* POST /api/cart/items */
export async function addCartItem({ productId, size = null, colour = null, qty = 1 }) {
  const body = await request('/cart/items', {
    method: 'POST',
    body: { productId, size, colour, qty },
  })
  return toCartData(body?.data)
}

/* PATCH /api/cart/items/:productId */
export async function updateCartItem(productId, { qty, size, colour }) {
  const payload = { qty }
  if (size !== undefined) payload.size = size
  if (colour !== undefined) payload.colour = colour
  const body = await request(`/cart/items/${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    body: payload,
  })
  return toCartData(body?.data)
}

/* DELETE /api/cart/items/:productId */
export async function removeCartItem(productId, { size, colour } = {}) {
  // Variant is always sent explicitly (empty string = no variant) so the
  // server addresses the exact product + size + colour line.
  const query = new URLSearchParams()
  query.set('size', size ?? '')
  query.set('colour', colour ?? '')
  const body = await request(
    `/cart/items/${encodeURIComponent(productId)}?${query.toString()}`,
    { method: 'DELETE' },
  )
  return toCartData(body?.data)
}

/* DELETE /api/cart */
export async function clearCartServer() {
  const body = await request('/cart', { method: 'DELETE' })
  return toCartData(body?.data)
}

/* POST /api/cart/merge — guest lines merged into the database cart. */
export async function mergeCartServer(items) {
  const body = await request('/cart/merge', {
    method: 'POST',
    body: {
      items: (Array.isArray(items) ? items : []).map((l) => ({
        productId: l.productId,
        size: l.size || null,
        colour: l.colour || null,
        qty: l.qty,
      })),
    },
  })
  return toCartData(body?.data)
}

/* ---- Database wishlist (authenticated users) ---- */

function toWishlistData(data) {
  const raw = Array.isArray(data?.ids) ? data.ids : []
  const seen = new Set()
  const ids = []
  for (const id of raw) {
    if (typeof id !== 'string' || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return { ids, count: ids.length }
}

/* GET /api/wishlist */
export async function fetchWishlist({ signal } = {}) {
  const body = await request('/wishlist', { signal })
  return toWishlistData(body?.data)
}

/* POST /api/wishlist/items/:productId */
export async function addWishlistItem(productId) {
  const body = await request(`/wishlist/items/${encodeURIComponent(productId)}`, {
    method: 'POST',
  })
  return toWishlistData(body?.data)
}

/* DELETE /api/wishlist/items/:productId */
export async function removeWishlistItem(productId) {
  const body = await request(`/wishlist/items/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
  })
  return toWishlistData(body?.data)
}

/* DELETE /api/wishlist */
export async function clearWishlistServer() {
  const body = await request('/wishlist', { method: 'DELETE' })
  return toWishlistData(body?.data)
}

/* POST /api/wishlist/merge — guest ids unioned into the database list. */
export async function mergeWishlistServer(productIds) {
  const body = await request('/wishlist/merge', {
    method: 'POST',
    body: { productIds: Array.isArray(productIds) ? productIds.filter((id) => typeof id === 'string') : [] },
  })
  return toWishlistData(body?.data)
}

/* ---- Persistent orders (authenticated users; HTTP-only cookie session) ----
   The server is authoritative for prices, shipping, tax and totals.
   Responses are passed through untouched apart from light validation. */

function isSafeOrder(o) {
  return Boolean(o && typeof o === 'object' && typeof o.orderNumber === 'string' && Array.isArray(o.items))
}

/* POST /api/orders — { customer, shipping, deliveryMethod, paymentMethod, couponCode? }.
   Totals are computed by the server; any totals sent are ignored. */
export async function createOrder({ customer, shipping, deliveryMethod, paymentMethod, couponCode }) {
  const payload = { customer, shipping, deliveryMethod, paymentMethod }
  if (couponCode) payload.couponCode = couponCode
  const body = await request('/orders', {
    method: 'POST',
    body: payload,
  })
  const order = body?.data?.order
  if (!isSafeOrder(order)) throw new ApiError('Could not place your order. Please try again.', 500)
  return order
}

/* GET /api/orders — owner's orders, newest first, paginated. */
export async function fetchOrders({ page = 1, limit = 20, signal } = {}) {
  const query = new URLSearchParams()
  query.set('page', String(page))
  query.set('limit', String(limit))
  const body = await request(`/orders?${query.toString()}`, { signal })
  const orders = Array.isArray(body?.data?.orders) ? body.data.orders.filter(isSafeOrder) : []
  return {
    orders,
    pagination: body?.data?.pagination || { page: 1, limit: orders.length, total: orders.length, pages: 1 },
  }
}

/* GET /api/orders/:orderNumber */
export async function fetchOrder(orderNumber, { signal } = {}) {
  const body = await request(`/orders/${encodeURIComponent(orderNumber)}`, { signal })
  const order = body?.data?.order
  if (!isSafeOrder(order)) throw new ApiError('Order not found.', 404)
  return order
}

/* PATCH /api/orders/:orderNumber/cancel */
export async function cancelOrder(orderNumber) {
  const body = await request(`/orders/${encodeURIComponent(orderNumber)}/cancel`, {
    method: 'PATCH',
  })
  const order = body?.data?.order
  if (!isSafeOrder(order)) throw new ApiError('Could not cancel your order. Please try again.', 500)
  return order
}

/* Map a server order to the confirmation-page shape (the same fields the
   page already renders from the local last-order snapshot). */
export function toConfirmationOrder(order) {  if (!isSafeOrder(order)) return null
  return {
    number: order.orderNumber,
    placedAt: order.createdAt || new Date().toISOString(),
    customer: order.customer,
    shipping: {
      address: order.shippingAddress?.address || '',
      apartment: order.shippingAddress?.apartment || '',
      city: order.shippingAddress?.city || '',
      state: order.shippingAddress?.state || '',
      pin: order.shippingAddress?.pin || '',
      country: order.shippingAddress?.country || '',
    },
    delivery: {
      id: order.deliveryMethod?.id || 'standard',
      label: order.deliveryMethod?.label || '',
      charge: order.deliveryMethod?.charge ?? 0,
      eta: order.deliveryMethod?.eta || '',
    },
    payment: {
      id: order.paymentMethod,
      label: order.paymentMethodLabel || order.paymentMethod,
    },
    items: order.items,
    subtotal: order.subtotal,
    deliveryCharge: order.shippingCost,
    discount: order.discount ?? 0,
    coupon: order.coupon || null,
    total: order.total,
  }
}

/* ---- Coupons (Step 18) — authenticated only. The server loads the live
   cart and MongoDB prices; the discount is always computed backend-side. ---- */

/* POST /api/coupons/validate — { code }. Never consumes usage. */
export async function validateCoupon(code) {
  const body = await request('/coupons/validate', {
    method: 'POST',
    body: { code },
  })
  if (!body?.data || typeof body.data.discountAmount !== 'number') {
    throw new ApiError('Could not validate the coupon.', 500)
  }
  return body.data
}

/* ---- Razorpay TEST MODE (authenticated users; HTTP-only cookie session) ----
   Amounts always originate server-side. The client only opens the gateway
   modal and forwards the signed response for SERVER verification. */

function isGatewaySession(s) {
  return Boolean(
    s && typeof s === 'object' &&
    typeof s.keyId === 'string' && s.keyId &&
    typeof s.razorpayOrderId === 'string' && s.razorpayOrderId &&
    Number.isInteger(s.amountPaise) && s.amountPaise > 0,
  )
}

/* POST /api/payments/razorpay/order — { deliveryMethod, paymentMethod, customer?, shipping?, couponCode? } */
export async function createRazorpayOrder({ deliveryMethod, paymentMethod, customer, shipping, couponCode }) {
  const payload = { deliveryMethod, paymentMethod }
  if (customer !== undefined) payload.customer = customer
  if (shipping !== undefined) payload.shipping = shipping
  if (couponCode) payload.couponCode = couponCode
  const body = await request('/payments/razorpay/order', { method: 'POST', body: payload })
  const session = body?.data
  if (!isGatewaySession(session)) {
    throw new ApiError('Could not start online payment. Please try again.', 502)
  }
  return { ...session, currency: session.currency || 'INR' }
}

/* POST /api/payments/razorpay/verify — signed gateway response + contact details. */
export async function verifyRazorpayPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature, customer, shipping }) {
  const body = await request('/payments/razorpay/verify', {
    method: 'POST',
    body: {
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
      customer,
      shipping,
    },
  })
  const order = body?.data?.order
  if (!order || typeof order !== 'object' || typeof order.orderNumber !== 'string') {
    throw new ApiError('Payment verification failed.', 500)
  }
  return order
}

/* POST /api/payments/razorpay/fail — close the attempt after a cancel/failure (best effort). */
export async function markRazorpayFailed(razorpayOrderId) {
  try {
    await request('/payments/razorpay/fail', {
      method: 'POST',
      body: { razorpay_order_id: razorpayOrderId },
    })
  } catch {
    // Failure bookkeeping must never block retry.
  }
}

/* ---- Admin (Step 16) — session cookie + server-enforced admin role.
   The backend returns 401/403 for unauthorized callers; these helpers
   only surface the safe payloads. ---- */

function adminQuery(params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      query.set(key, String(value))
    }
  }
  const suffix = query.toString()
  return suffix ? `?${suffix}` : ''
}

/* GET /api/admin/dashboard */
export async function fetchAdminDashboard({ signal } = {}) {
  const body = await request('/admin/dashboard', { signal })
  if (!body?.data) throw new ApiError('Could not load the dashboard.', 500)
  return body.data
}

/* GET /api/admin/analytics/:section — admin-only business intelligence,
   always computed live on the backend. section: overview | sales |
   products | categories | customers | coupons. */
export async function fetchAdminAnalytics(section, params = {}, { signal } = {}) {
  const allowed = ['overview', 'sales', 'products', 'categories', 'customers', 'coupons']
  if (!allowed.includes(section)) throw new ApiError('Unknown analytics section.', 400)
  const body = await request(`/admin/analytics/${section}${adminQuery(params)}`, { signal })
  if (!body?.data) throw new ApiError('Could not load analytics.', 500)
  return body.data
}

/* GET /api/admin/products */
export async function fetchAdminProducts(params = {}, { signal } = {}) {
  const body = await request(`/admin/products${adminQuery(params)}`, { signal })
  const items = Array.isArray(body?.data) ? body.data : []
  return {
    items,
    pagination: body?.pagination || { page: 1, limit: items.length, total: items.length, pages: 1 },
  }
}

/* GET /api/admin/products/:id */
export async function fetchAdminProduct(id, { signal } = {}) {
  const body = await request(`/admin/products/${encodeURIComponent(id)}`, { signal })
  if (!body?.data) throw new ApiError('Product not found.', 404)
  return body.data
}

/* POST /api/admin/products */
export async function createAdminProduct(payload) {
  const body = await request('/admin/products', { method: 'POST', body: payload })
  if (!body?.data) throw new ApiError('Could not create the product.', 500)
  return body.data
}

/* PATCH /api/admin/products/:id */
export async function updateAdminProduct(id, payload) {
  const body = await request(`/admin/products/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: payload,
  })
  if (!body?.data) throw new ApiError('Could not update the product.', 500)
  return body.data
}

/* DELETE /api/admin/products/:id */
export async function deleteAdminProduct(id) {
  await request(`/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/* GET /api/admin/orders */
export async function fetchAdminOrders(params = {}, { signal } = {}) {
  const body = await request(`/admin/orders${adminQuery(params)}`, { signal })
  const orders = Array.isArray(body?.data?.orders) ? body.data.orders : []
  return {
    orders,
    pagination: body?.data?.pagination || { page: 1, limit: orders.length, total: orders.length, pages: 1 },
  }
}

/* GET /api/admin/orders/:orderNumber */
export async function fetchAdminOrder(orderNumber, { signal } = {}) {
  const body = await request(`/admin/orders/${encodeURIComponent(orderNumber)}`, { signal })
  const order = body?.data?.order
  if (!order) throw new ApiError('Order not found.', 404)
  return { order, account: body?.data?.account || null }
}

/* PATCH /api/admin/orders/:orderNumber/status */
export async function updateAdminOrderStatus(orderNumber, status) {
  const body = await request(`/admin/orders/${encodeURIComponent(orderNumber)}/status`, {
    method: 'PATCH',
    body: { status },
  })
  const order = body?.data?.order
  if (!order) throw new ApiError('Could not update the order.', 500)
  return order
}

/* GET /api/admin/customers */
export async function fetchAdminCustomers(params = {}, { signal } = {}) {
  const body = await request(`/admin/customers${adminQuery(params)}`, { signal })
  const customers = Array.isArray(body?.data?.customers) ? body.data.customers : []
  return {
    customers,
    pagination: body?.data?.pagination || { page: 1, limit: customers.length, total: customers.length, pages: 1 },
  }
}

/* ---- Reviews (Step 17) — verified-purchase only, server-enforced.
   Reads are public; writes use the session cookie (`auth: true`). ---- */

function isSafeReview(r) {
  return Boolean(r && typeof r === 'object' && typeof r.id === 'string' && Number.isInteger(r.rating))
}

const EMPTY_SUMMARY = { average: 0, count: 0, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }

/* GET /api/products/:productId/reviews — approved reviews + summary. */
export async function fetchProductReviews(productId, params = {}, { signal } = {}) {
  const body = await request(`/products/${encodeURIComponent(productId)}/reviews${adminQuery(params)}`, { signal })
  const reviews = Array.isArray(body?.data?.reviews) ? body.data.reviews.filter(isSafeReview) : []
  return {
    reviews,
    summary: body?.data?.summary || EMPTY_SUMMARY,
    pagination: body?.data?.pagination || { page: 1, limit: reviews.length, total: reviews.length, pages: 1 },
  }
}

/* GET /api/products/:productId/reviews/eligibility */
export async function fetchReviewEligibility(productId, { signal } = {}) {
  const body = await request(`/products/${encodeURIComponent(productId)}/reviews/eligibility`, {
    signal,
    auth: true,
  })
  return body?.data || { eligible: false, reason: 'not-purchased', eligibleOrders: [], userReview: null }
}

/* POST /api/products/:productId/reviews */
export async function createProductReview(productId, { rating, title, comment, orderNumber }) {
  const body = await request(`/products/${encodeURIComponent(productId)}/reviews`, {
    method: 'POST',
    auth: true,
    body: { rating, title, comment, orderNumber },
  })
  const review = body?.data?.review
  if (!isSafeReview(review)) throw new ApiError('Could not submit your review.', 500)
  return review
}

/* PATCH /api/reviews/:id — content fields only; the server ignores
   status/verifiedPurchase/user. */
export async function updateProductReview(id, { rating, title, comment }) {
  const body = await request(`/reviews/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { rating, title, comment },
  })
  const review = body?.data?.review
  if (!isSafeReview(review)) throw new ApiError('Could not update your review.', 500)
  return { review, message: body?.message || '' }
}

/* DELETE /api/reviews/:id */
export async function deleteProductReview(id) {
  await request(`/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/* GET /api/admin/reviews */
export async function fetchAdminReviews(params = {}, { signal } = {}) {
  const body = await request(`/admin/reviews${adminQuery(params)}`, { signal })
  const reviews = Array.isArray(body?.data?.reviews) ? body.data.reviews : []
  return {
    reviews,
    pagination: body?.data?.pagination || { page: 1, limit: reviews.length, total: reviews.length, pages: 1 },
  }
}

/* PATCH /api/admin/reviews/:id/status */
export async function updateAdminReviewStatus(id, status) {
  const body = await request(`/admin/reviews/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: { status },
  })
  if (!body?.data?.review) throw new ApiError('Could not update the review.', 500)
  return body.data.review
}

/* DELETE /api/admin/reviews/:id */
export async function deleteAdminReview(id) {
  await request(`/admin/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/* ---- Admin coupons (Step 18) — session cookie + server-enforced admin role. ---- */

/* GET /api/admin/coupons */
export async function fetchAdminCoupons(params = {}, { signal } = {}) {
  const body = await request(`/admin/coupons${adminQuery(params)}`, { signal })
  const coupons = Array.isArray(body?.data?.coupons) ? body.data.coupons : []
  return {
    coupons,
    pagination: body?.data?.pagination || { page: 1, limit: coupons.length, total: coupons.length, pages: 1 },
  }
}

/* GET /api/admin/coupons/:id */
export async function fetchAdminCoupon(id, { signal } = {}) {
  const body = await request(`/admin/coupons/${encodeURIComponent(id)}`, { signal })
  if (!body?.data?.coupon) throw new ApiError('Coupon not found.', 404)
  return body.data.coupon
}

/* POST /api/admin/coupons */
export async function createAdminCoupon(payload) {
  const body = await request('/admin/coupons', { method: 'POST', body: payload })
  if (!body?.data?.coupon) throw new ApiError('Could not create the coupon.', 500)
  return body.data.coupon
}

/* PATCH /api/admin/coupons/:id */
export async function updateAdminCoupon(id, payload) {
  const body = await request(`/admin/coupons/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: payload,
  })
  if (!body?.data?.coupon) throw new ApiError('Could not update the coupon.', 500)
  return body.data.coupon
}

/* DELETE /api/admin/coupons/:id */
export async function deleteAdminCoupon(id) {
  await request(`/admin/coupons/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/* ---- Notifications (Step 19) — authenticated owner only; the server
   scopes everything to the session user. ---- */

function isSafeNotification(n) {
  return Boolean(n && typeof n === 'object' && typeof n.id === 'string' && typeof n.title === 'string')
}

/* GET /api/notifications */
export async function fetchNotifications(params = {}, { signal } = {}) {
  const body = await request(`/notifications${adminQuery(params)}`, { signal })
  const notifications = Array.isArray(body?.data?.notifications)
    ? body.data.notifications.filter(isSafeNotification)
    : []
  return {
    notifications,
    unreadCount: Number(body?.data?.unreadCount) || 0,
    pagination: body?.data?.pagination || { page: 1, limit: notifications.length, total: notifications.length, pages: 1 },
  }
}

/* PATCH /api/notifications/:id/read */
export async function markNotificationRead(id) {
  const body = await request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' })
  const notification = body?.data?.notification
  if (!isSafeNotification(notification)) throw new ApiError('Could not update the notification.', 500)
  return notification
}

/* PATCH /api/notifications/read-all */
export async function markAllNotificationsRead() {
  const body = await request('/notifications/read-all', { method: 'PATCH' })
  return {
    updated: Number(body?.data?.updated) || 0,
    unreadCount: Number(body?.data?.unreadCount) || 0,
  }
}

/* DELETE /api/notifications/:id */
export async function deleteNotification(id) {
  await request(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/* DELETE /api/notifications */
export async function clearNotifications() {
  const body = await request('/notifications', { method: 'DELETE' })
  return { deleted: Number(body?.data?.deleted) || 0 }
}
