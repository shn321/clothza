import crypto from 'node:crypto'
import Cart from '../models/Cart.js'
import Coupon from '../models/Coupon.js'
import Order, {
  CANCELLABLE_STATUSES,
  computeTotals,
  PAYMENT_METHODS,
} from '../models/Order.js'
import Product from '../models/Product.js'
import { cartLineKey } from '../models/Cart.js'
import {
  claimCouponUsage,
  evaluateCoupon,
  normalizeCouponCode,
  releaseCouponUsage,
} from '../services/couponService.js'
import { notifyOrderEvent } from '../services/notificationService.js'
import { findProductByRef } from '../utils/catalog.js'
import { invalid, str, validateCustomer, validateShipping } from '../utils/orderValidation.js'

/* CLOTHZA orders (Step 14) — authenticated users only.
   The user ALWAYS comes from the JWT session (req.user); userId,
   totals, prices and statuses from the client are never trusted.
   Consistency without replica-set transactions (works on any
   topology, including standalone MongoDB):
   1. validate everything before touching stock,
   2. guarded atomic decrements (`stock: { $gte: qty }` — stock can
      never go negative, concurrent orders can't oversell),
   3. create the order; on failure, restore every decrement,
   4. clear the cart ONLY after the order exists (best-effort; the
      frontend also clears, so a clear failure can't strand the user). */

const DELIVERY_IDS = ['standard', 'express']

/* ---------- order number: CLZ-YYYYMMDD-XXXXXX, unique, collision-safe ---------- */
export const DELIVERY_META = {
  standard: { label: 'Standard Delivery', eta: '5–7 business days' },
  express: { label: 'Express Delivery', eta: '2–3 business days' },
}
const PAYMENT_LABELS = { cod: 'Cash on Delivery', card: 'Credit / Debit Card', upi: 'UPI' }
const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 50

/* ---------- safe serializer (no _id, __v, user, secrets) ---------- */

export function serializeOrder(doc) {
  if (!doc || typeof doc !== 'object') return null
  const items = (doc.items || []).map((l) => ({
    key: cartLineKey(l.productId, l.size, l.colour),
    productId: l.productId,
    slug: l.slug,
    name: l.name,
    image: l.image || '',
    price: l.price,
    size: l.size || null,
    colour: l.colour || null,
    qty: l.qty,
  }))
  return {
    orderNumber: doc.orderNumber,
    items,
    itemCount: items.reduce((n, l) => n + l.qty, 0),
    customer: {
      firstName: doc.customer?.firstName || '',
      lastName: doc.customer?.lastName || '',
      email: doc.customer?.email || '',
      phone: doc.customer?.phone || '',
    },
    shippingAddress: {
      address: doc.shippingAddress?.address || '',
      apartment: doc.shippingAddress?.apartment || '',
      city: doc.shippingAddress?.city || '',
      state: doc.shippingAddress?.state || '',
      pin: doc.shippingAddress?.pin || '',
      country: doc.shippingAddress?.country || '',
    },
    deliveryMethod: {
      id: doc.deliveryMethod?.id || 'standard',
      label: doc.deliveryMethod?.label || '',
      charge: doc.deliveryMethod?.charge ?? 0,
      eta: doc.deliveryMethod?.eta || '',
    },
    subtotal: doc.subtotal,
    shippingCost: doc.shippingCost,
    tax: doc.tax,
    discount: doc.discount,
    total: doc.total,
    ...(doc.coupon
      ? {
        coupon: {
          code: doc.coupon.code,
          discountType: doc.coupon.discountType,
          discountValue: doc.coupon.discountValue,
          discountAmount: doc.coupon.discountAmount,
        },
      }
      : {}),
    paymentMethod: doc.paymentMethod,
    paymentMethodLabel: PAYMENT_LABELS[doc.paymentMethod] || doc.paymentMethod,
    paymentStatus: doc.paymentStatus,
    paymentProvider: doc.paymentProvider || 'cod',
    orderStatus: doc.orderStatus,
    createdAt: doc.createdAt,
    ...(doc.paidAt ? { paidAt: doc.paidAt } : {}),
    ...(doc.cancelledAt ? { cancelledAt: doc.cancelledAt } : {}),
  }
}

/* Validators (validateCustomer/validateShipping) are shared from
   utils/orderValidation.js so COD and Razorpay flows match exactly. */

/* ---------- order number: CLZ-YYYYMMDD-XXXXXX, unique, collision-safe ---------- */

const ORDER_SUFFIX_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function makeOrderNumber() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  let suffix = ''
  const bytes = crypto.randomBytes(6)
  for (let i = 0; i < 6; i += 1) {
    suffix += ORDER_SUFFIX_CHARS[bytes[i] % ORDER_SUFFIX_CHARS.length]
  }
  return `CLZ-${y}${m}${day}-${suffix}`
}

export async function createOrderDoc(doc) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await Order.create({ ...doc, orderNumber: makeOrderNumber() })
    } catch (err) {
      if (err && err.code === 11000) continue
      throw err
    }
  }
  throw invalid('Could not place your order. Please try again.', 500)
}

/* Best-effort stock restoration (compensation for a failed order or a
   cancellation). Never throws — callers must not fail because of it. */
async function restoreStock(lines) {
  for (const { productId, qty } of lines) {
    try {
      await Product.updateOne({ _id: productId }, { $inc: { stock: qty } })
    } catch {
      // Logged nowhere with secrets; stock ops carry no sensitive data,
      // but a failed restore must never break the response path.
    }
  }
}

/* ---------- handlers ---------- */

/* POST /api/orders */
export async function createOrder(req, res, next) {
  try {
    const deliveryId = str(req.body?.deliveryMethod || req.body?.delivery || req.body?.deliveryId || 'standard')
    if (!DELIVERY_IDS.includes(deliveryId)) {
      return res.status(400).json({ success: false, message: 'Invalid delivery method.' })
    }
    const paymentMethod = str(req.body?.paymentMethod || req.body?.payment || req.body?.paymentId)
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'Invalid payment method.' })
    }
    let customer
    let shippingAddress
    try {
      customer = validateCustomer(req.body?.customer)
      shippingAddress = validateShipping(req.body?.shipping || req.body?.shippingAddress)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message })
    }

    // 1–2. Load the authoritative cart; reject empty.
    const cart = await Cart.findOne({ user: req.user._id })
    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Your bag is empty.' })
    }

    // 3–7. Re-fetch every product; validate existence, qty, price, stock.
    const lines = []
    for (const line of cart.items) {
      const product = await findProductByRef(line.productId)
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `“${line.name || 'An item'}” in your bag is no longer available.`,
        })
      }
      const qty = line.qty
      if (!Number.isInteger(qty) || qty < 1) {
        return res.status(400).json({
          success: false,
          message: `Invalid quantity for “${product.name}”.`,
        })
      }
      const stock = Number(product.stock)
      if (!Number.isFinite(stock) || stock <= 0) {
        return res.status(400).json({
          success: false,
          message: `“${product.name}” is currently out of stock.`,
        })
      }
      if (stock < qty) {
        return res.status(400).json({
          success: false,
          message: `Only ${stock} ${stock === 1 ? 'unit' : 'units'} of “${product.name}” available.`,
        })
      }
      lines.push({ product, qty, size: line.size || null, colour: line.colour || null })
    }

    // 8–11. Server-side totals from DATABASE prices. A coupon code may
    // be supplied, but NEVER a frontend discount/total — the discount is
    // always re-derived here from the live cart and MongoDB prices.
    const couponCode = normalizeCouponCode(req.body?.couponCode || req.body?.coupon)
    let coupon = null
    let couponDiscount = 0
    let couponSnapshot
    if (couponCode) {
      const found = await Coupon.findOne({ code: couponCode })
      try {
        const evaluated = evaluateCoupon(found, req.user._id, lines)
        coupon = evaluated.coupon
        couponDiscount = evaluated.discountAmount
        couponSnapshot = {
          code: evaluated.coupon.code,
          discountType: evaluated.coupon.discountType,
          discountValue: evaluated.coupon.discountValue,
          discountAmount: evaluated.discountAmount,
        }
      } catch (err) {
        return res.status(err.statusCode || 400).json({ success: false, message: err.message })
      }
    }
    const subtotal = lines.reduce((n, { product, qty }) => n + product.price * qty, 0)
    const totals = computeTotals(subtotal, deliveryId, couponDiscount)
    const meta = DELIVERY_META[deliveryId]

    // 12. Guarded atomic decrements — never negative, no oversell on races.
    const decremented = []
    for (const { product, qty } of lines) {
      const result = await Product.updateOne(
        { _id: product._id, stock: { $gte: qty } },
        { $inc: { stock: -qty } },
      )
      if (result.matchedCount === 0) {
        await restoreStock(decremented)
        return res.status(400).json({
          success: false,
          message: `“${product.name}” just went out of stock.`,
        })
      }
      decremented.push({ productId: product._id, qty })
    }

    // 12b. Claim coupon usage atomically (guarded increment — races
    // can never exceed the usage limit). Stock is already reserved; a
    // failed claim restores stock and consumes nothing.
    if (coupon) {
      try {
        await claimCouponUsage(coupon._id, req.user._id)
      } catch (err) {
        await restoreStock(decremented)
        return res.status(err.statusCode || 400).json({ success: false, message: err.message })
      }
    }

    // 13. Create the order; restore stock AND release the coupon claim
    // if this fails, so a failed order never consumes coupon usage.
    let order
    try {
      order = await createOrderDoc({
        user: req.user._id,
        items: lines.map(({ product, qty, size, colour }) => ({
          product: product._id,
          productId: product.legacyId || product.slug,
          slug: product.slug,
          name: product.name,
          image: product.images?.[0] || '',
          price: product.price,
          size,
          colour,
          qty,
        })),
        customer,
        shippingAddress,
        deliveryMethod: { id: deliveryId, label: meta.label, charge: totals.shippingCost, eta: meta.eta },
        ...totals,
        ...(couponSnapshot ? { coupon: couponSnapshot } : {}),
        paymentMethod,
        paymentStatus: 'pending',
        orderStatus: 'pending',
      })
    } catch (err) {
      await restoreStock(decremented)
      if (coupon) await releaseCouponUsage(coupon._id, req.user._id)
      return next(err)
    }

    // 14. Clear the cart only after the order exists (best effort — the
    // frontend also clears, so a failure here can't strand the shopper).
    try {
      await Cart.findOneAndDelete({ user: req.user._id })
    } catch {
      // Order stands; cart cleanup retried by the client.
    }

    /* Step 19 — ORDER_PLACED notification + order-placed email, AFTER the
       order is persisted. Best-effort by design (notifyOrderEvent never
       throws): a notification/email problem can never roll back or break
       a successful order. */
    await notifyOrderEvent(order, 'ORDER_PLACED')

    return res.status(201).json({ success: true, data: { order: serializeOrder(order) } })
  } catch (err) {
    return next(err)
  }
}

/* GET /api/orders — owner's orders, newest first, paginated. */
export async function listOrders(req, res, next) {
  try {
    const page = Number.isInteger(Number(req.query.page)) && Number(req.query.page) > 0
      ? Number(req.query.page)
      : 1
    const limit = Math.min(
      Number.isInteger(Number(req.query.limit)) && Number(req.query.limit) > 0
        ? Number(req.query.limit)
        : DEFAULT_LIST_LIMIT,
      MAX_LIST_LIMIT,
    )
    const skip = (page - 1) * limit
    const [total, docs] = await Promise.all([
      Order.countDocuments({ user: req.user._id }),
      Order.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
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

/* GET /api/orders/:orderNumber — owner only; strangers get the same 404. */
export async function getOrder(req, res, next) {
  try {
    const orderNumber = str(req.params.orderNumber)
    if (!orderNumber) {
      return res.status(404).json({ success: false, message: 'Order not found.' })
    }
    const order = await Order.findOne({ user: req.user._id, orderNumber })
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' })
    }
    return res.status(200).json({ success: true, data: { order: serializeOrder(order) } })
  } catch (err) {
    return next(err)
  }
}

/* PATCH /api/orders/:orderNumber/cancel */
export async function cancelOrder(req, res, next) {
  try {
    const orderNumber = str(req.params.orderNumber)
    if (!orderNumber) {
      return res.status(404).json({ success: false, message: 'Order not found.' })
    }
    const order = await Order.findOne({ user: req.user._id, orderNumber })
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' })
    }
    if (!CANCELLABLE_STATUSES.includes(order.orderStatus)) {
      return res.status(409).json({
        success: false,
        message: 'This order can no longer be cancelled.',
      })
    }
    await restoreStock(order.items.map((l) => ({ productId: l.product, qty: l.qty })))
    order.orderStatus = 'cancelled'
    order.cancelledAt = new Date()
    await order.save()
    /* Step 19 — cancellation notice. Best-effort; never breaks the
       cancellation response. */
    await notifyOrderEvent(order, 'ORDER_CANCELLED')
    return res.status(200).json({ success: true, data: { order: serializeOrder(order) } })
  } catch (err) {
    return next(err)
  }
}
