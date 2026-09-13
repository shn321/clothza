import Cart from '../models/Cart.js'
import Coupon from '../models/Coupon.js'
import Order from '../models/Order.js'
import PaymentAttempt from '../models/PaymentAttempt.js'
import Product from '../models/Product.js'
import { computeTotals } from '../models/Order.js'
import { createOrderDoc, DELIVERY_META, serializeOrder } from './orderController.js'
import {
  claimCouponUsage,
  evaluateCoupon,
  normalizeCouponCode,
  releaseCouponUsage,
} from '../services/couponService.js'
import { notifyOrderEvent, notifyPaymentFailure } from '../services/notificationService.js'
import { findProductByRef } from '../utils/catalog.js'
import { invalid, str, validateCustomer, validateShipping } from '../utils/orderValidation.js'
import {
  buildGatewayOrderPayload,
  cartFingerprint,
  createGatewayOrder,
  isGatewayConfigured,
  isWebhookConfigured,
  RAZORPAY_CURRENCY,
  toPaise,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from '../services/razorpayService.js'

/* CLOTHZA Razorpay TEST MODE payments (Step 15) — authenticated only.
   The user ALWAYS comes from the JWT session; amounts, prices, stock
   and totals are ALWAYS recomputed server-side from MongoDB.
   Idempotency: a PaymentAttempt moves pending → processing atomically,
   so refresh / retry / double-submit / webhook replay can never create
   two paid CLOTHZA orders. The cart is cleared only after a paid order
   exists; every failure path leaves the cart intact for safe retry.
   No card, UPI, PIN, CVV or secret data is ever accepted, logged or
   stored — sensitive details stay inside Razorpay Checkout. */

const ONLINE_METHODS = ['card', 'upi']
const DELIVERY_IDS = ['standard', 'express']
const ONLINE_LABELS = { card: 'Credit / Debit Card', upi: 'UPI' }

function notFound() {
  return { status: 404, body: { success: false, message: 'Payment session not found.' } }
}

/* Best-effort stock restoration. Never throws. */
async function restoreStock(lines) {
  for (const { productId, qty } of lines) {
    try {
      await Product.updateOne({ _id: productId }, { $inc: { stock: qty } })
    } catch {
      // Must never break the response path.
    }
  }
}

/* Resolve + validate live cart lines against MongoDB.
   Returns { lines, totals } or throws a customer-safe HTTP error.
   Exported for the Step-30 demo-payment flow, which validates
   identically. */
export async function resolveCartLines(userId) {
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
    const stock = Number(product.stock)
    if (!Number.isFinite(stock) || stock <= 0) {
      throw invalid(`“${product.name}” is currently out of stock.`, 400)
    }
    if (stock < qty) {
      throw invalid(`Only ${stock} ${stock === 1 ? 'unit' : 'units'} of “${product.name}” available.`, 400)
    }
    lines.push({ product, qty, size: line.size || null, colour: line.colour || null })
  }
  const subtotal = lines.reduce((n, { product, qty }) => n + product.price * qty, 0)
  return { lines, subtotal }
}

/* Shared completion used by verify AND webhook — one code path, one
   final state. Guarded decrements (never negative), order creation with
   paid status, compensation on failure, cart cleared only on success. */
async function completePaidOrder({ userId, lines, totals, deliveryId, paymentMethod, customer, shippingAddress, razorpayOrderId, razorpayPaymentId, couponSnapshot }) {
  const decremented = []
  for (const { product, qty } of lines) {
    const result = await Product.updateOne(
      { _id: product._id, stock: { $gte: qty } },
      { $inc: { stock: -qty } },
    )
    if (result.matchedCount === 0) {
      await restoreStock(decremented)
      throw invalid(`“${product.name}” just went out of stock.`, 409)
    }
    decremented.push({ productId: product._id, qty })
  }
  const meta = DELIVERY_META[deliveryId]
  let order
  try {
    order = await createOrderDoc({
      user: userId,
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
      paymentStatus: 'paid',
      paymentProvider: 'razorpay',
      razorpayOrderId,
      razorpayPaymentId,
      paidAt: new Date(),
      orderStatus: 'pending',
    })
  } catch (err) {
    await restoreStock(decremented)
    throw err
  }
  try {
    await Cart.findOneAndDelete({ user: userId })
  } catch {
    // Order stands; the client also clears.
  }
  return order
}

async function sendError(res, err, fallback = 'Something went wrong. Please try again.') {
  const status = err && Number.isInteger(err.statusCode) ? err.statusCode : 500
  const message = status < 500 ? err.message || fallback : fallback
  return res.status(status).json({ success: false, message })
}

/* POST /api/payments/razorpay/order — { deliveryMethod, paymentMethod, customer?, shipping? }.
   Validates the cart, computes server totals, creates the TEST MODE
   gateway order and persists the attempt. Refresh/retry with an
   unchanged bag reuses the pending attempt (no duplicate gateway orders). */
export async function createRazorpayOrder(req, res, next) {
  try {
    const deliveryId = str(req.body?.deliveryMethod || req.body?.delivery || req.body?.deliveryId || 'standard')
    if (!DELIVERY_IDS.includes(deliveryId)) {
      return res.status(400).json({ success: false, message: 'Invalid delivery method.' })
    }
    const paymentMethod = str(req.body?.paymentMethod || req.body?.payment || req.body?.paymentId)
    if (!ONLINE_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'Online payment supports card or UPI. COD uses the standard checkout.' })
    }

    const { lines, subtotal } = await resolveCartLines(req.user._id)
    /* Step 18 — optional coupon. Only the code is accepted; the discount
       is always recomputed here from live MongoDB prices. */
    const couponCode = normalizeCouponCode(req.body?.couponCode || req.body?.coupon)
    let coupon = null
    let couponDiscount = 0
    let couponSnapshot = null
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
    const totals = computeTotals(subtotal, deliveryId, couponDiscount)
    const fingerprint = cartFingerprint(
      lines.map(({ product, qty, size, colour }) => ({
        productId: product.legacyId || product.slug,
        size,
        colour,
        qty,
      })),
    )

    // Idempotent retry: unchanged bag (+ same coupon + same totals)
    // reuses the pending attempt (no duplicate gateway orders).
    const existing = await PaymentAttempt.findOne({
      user: req.user._id,
      status: 'pending',
      deliveryMethod: deliveryId,
      paymentMethod,
    }).sort({ createdAt: -1 })
    if (existing && cartFingerprint(existing.items) === fingerprint && existing.total === totals.total
      && (existing.couponCode || null) === (couponSnapshot?.code || null)
      && Number(existing.discount || 0) === Number(totals.discount || 0)) {
      return res.status(200).json({
        success: true,
        data: {
          keyId: process.env.RAZORPAY_KEY_ID || '',
          razorpayOrderId: existing.razorpayOrderId,
          amountPaise: existing.amountPaise,
          currency: existing.currency,
        },
      })
    }
    // Retire superseded pending attempts so only the latest is live.
    await PaymentAttempt.updateMany(
      { user: req.user._id, status: 'pending' },
      { $set: { status: 'expired', failureReason: 'superseded by a newer attempt' } },
    )

    // Optional contact details now (also accepted at verify); stored so
    // the server-to-server webhook can complete identically.
    let customer = { firstName: '', lastName: '', email: '', phone: '' }
    let shippingAddress = { address: '', apartment: '', city: '', state: '', pin: '', country: '' }
    if (req.body?.customer !== undefined || req.body?.shipping !== undefined) {
      try {
        customer = validateCustomer(req.body?.customer)
        shippingAddress = validateShipping(req.body?.shipping || req.body?.shippingAddress)
      } catch (err) {
        return res.status(err.statusCode || 400).json({ success: false, message: err.message })
      }
    }

    let amountPaise
    try {
      amountPaise = toPaise(totals.total)
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid order total.' })
    }
    const receipt = `clz-${String(req.user._id).slice(-8)}-${Date.now().toString(36)}`.slice(0, 40)
    let gatewayOrder
    try {
      gatewayOrder = await createGatewayOrder(
        buildGatewayOrderPayload({
          amountPaise,
          receipt,
          notes: { user: String(req.user._id), delivery: deliveryId },
        }),
      )
    } catch (err) {
      if (err && err.statusCode === 503) {
        return res.status(503).json({ success: false, message: err.message })
      }
      return res.status(502).json({
        success: false,
        message: 'Could not start online payment. Please try again or use Cash on Delivery.',
      })
    }
    if (!gatewayOrder || !gatewayOrder.id) {
      return res.status(502).json({
        success: false,
        message: 'Could not start online payment. Please try again or use Cash on Delivery.',
      })
    }

    await PaymentAttempt.create({
      user: req.user._id,
      razorpayOrderId: gatewayOrder.id,
      receipt,
      amountPaise,
      currency: RAZORPAY_CURRENCY,
      items: lines.map(({ product, qty, size, colour }) => ({
        productId: product.legacyId || product.slug,
        size,
        colour,
        qty,
      })),
      subtotal: totals.subtotal,
      shippingCost: totals.shippingCost,
      discount: totals.discount,
      couponCode: couponSnapshot?.code || null,
      couponSnapshot,
      total: totals.total,
      deliveryMethod: deliveryId,
      paymentMethod,
      customer,
      shippingAddress,
      status: 'pending',
    })

    return res.status(201).json({
      success: true,
      data: {
        keyId: process.env.RAZORPAY_KEY_ID || '',
        razorpayOrderId: gatewayOrder.id,
        amountPaise,
        currency: RAZORPAY_CURRENCY,
      },
    })
  } catch (err) {
    if (err && Number.isInteger(err.statusCode)) {
      return res.status(err.statusCode).json({ success: false, message: err.message })
    }
    return next(err)
  }
}

/* POST /api/payments/razorpay/verify —
   { razorpay_order_id, razorpay_payment_id, razorpay_signature, customer, shipping }.
   Signature checked FIRST; only then is the attempt claimed atomically
   and the paid order created. Replays return the existing order. */
export async function verifyRazorpayPayment(req, res, next) {
  try {
    const razorpayOrderId = str(req.body?.razorpay_order_id)
    const razorpayPaymentId = str(req.body?.razorpay_payment_id)
    const razorpaySignature = str(req.body?.razorpay_signature)
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ success: false, message: 'Incomplete payment response.' })
    }
    if (!isGatewayConfigured()) {
      return res.status(503).json({ success: false, message: 'Online payment verification is unavailable.' })
    }
    if (!verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature })) {
      return res.status(401).json({ success: false, message: 'Payment verification failed.' })
    }

    const attempt = await PaymentAttempt.findOne({ razorpayOrderId, user: req.user._id })
    if (!attempt) {
      const nf = notFound()
      return res.status(nf.status).json(nf.body)
    }
    if (attempt.status === 'paid') {
      const existing = await Order.findOne({ orderNumber: attempt.clothzaOrderNumber, user: req.user._id })
      if (!existing) {
        return res.status(500).json({ success: false, message: 'Something went wrong. Please contact support.' })
      }
      return res.status(200).json({ success: true, data: { order: serializeOrder(existing), replay: true } })
    }
    if (attempt.status !== 'pending') {
      return res.status(409).json({ success: false, message: 'This payment session is no longer active.' })
    }

    let customer
    let shippingAddress
    try {
      customer = validateCustomer(req.body?.customer)
      shippingAddress = validateShipping(req.body?.shipping || req.body?.shippingAddress)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message })
    }

    // Live cart must still match the authorized amount. When the attempt
    // carries a coupon, the discount is recomputed server-side and must
    // still match — frontend amounts are never trusted.
    const { lines, subtotal } = await resolveCartLines(req.user._id)
    let coupon = null
    let couponSnapshot = null
    if (attempt.couponCode) {
      const found = await Coupon.findOne({ code: attempt.couponCode })
      try {
        const evaluated = evaluateCoupon(found, req.user._id, lines)
        coupon = evaluated.coupon
        couponSnapshot = {
          code: evaluated.coupon.code,
          discountType: evaluated.coupon.discountType,
          discountValue: evaluated.coupon.discountValue,
          discountAmount: evaluated.discountAmount,
        }
        if (Number(evaluated.discountAmount) !== Number(attempt.discount || 0)) {
          return res.status(400).json({
            success: false,
            message: 'Your coupon no longer gives the same discount. Please start checkout again.',
          })
        }
      } catch (err) {
        return res.status(err.statusCode || 400).json({ success: false, message: err.message })
      }
    }
    const totals = computeTotals(subtotal, attempt.deliveryMethod, couponSnapshot?.discountAmount || 0)
    if (totals.total !== attempt.total || totals.subtotal !== attempt.subtotal) {
      return res.status(400).json({
        success: false,
        message: 'Your bag changed during payment. Please start checkout again.',
      })
    }

    // Atomic claim — only one completion path (verify/webhook/replay) wins.
    const claimed = await PaymentAttempt.findOneAndUpdate(
      { _id: attempt._id, status: 'pending' },
      { $set: { status: 'processing', razorpayPaymentId } },
      { new: true },
    )
    if (!claimed) {
      const current = await PaymentAttempt.findById(attempt._id)
      if (current && current.status === 'paid' && current.clothzaOrderNumber) {
        const existing = await Order.findOne({ orderNumber: current.clothzaOrderNumber, user: req.user._id })
        if (existing) {
          return res.status(200).json({ success: true, data: { order: serializeOrder(existing), replay: true } })
        }
      }
      return res.status(409).json({ success: false, message: 'Payment is already being processed. Please wait a moment and try again.' })
    }

    let order
    let couponClaimed = false
    /* Step 18 — claim coupon usage atomically before creating the paid
       order. A failed claim aborts completion without consuming anything
       and releases the processing lock for a clean retry. */
    if (coupon) {
      try {
        await claimCouponUsage(coupon._id, req.user._id)
        couponClaimed = true
      } catch (err) {
        await PaymentAttempt.updateOne(
          { _id: attempt._id },
          { $set: { status: 'pending', razorpayPaymentId: null } },
        )
        return res.status(err.statusCode || 400).json({ success: false, message: err.message })
      }
    }
    try {
      order = await completePaidOrder({
        userId: req.user._id,
        lines,
        totals,
        deliveryId: attempt.deliveryMethod,
        paymentMethod: attempt.paymentMethod,
        customer,
        shippingAddress,
        razorpayOrderId,
        razorpayPaymentId,
        couponSnapshot,
      })
    } catch (err) {
      if (couponClaimed && coupon) await releaseCouponUsage(coupon._id, req.user._id)
      await PaymentAttempt.updateOne(
        { _id: attempt._id },
        { $set: { status: 'failed', failureReason: 'order completion failed after verification' } },
      )
      return sendError(res, err)
    }

    await PaymentAttempt.updateOne(
      { _id: attempt._id },
      { $set: { status: 'paid', clothzaOrderNumber: order.orderNumber, paidAt: order.paidAt } },
    )
    /* Step 19 — paid-order lifecycle notices. The atomic claim above
       guarantees exactly one completion path gets here, so a verify /
       webhook race or a replay can never duplicate these. Replays return
       earlier and notify nothing. Best-effort: never breaks payment. */
    await notifyOrderEvent(order, 'ORDER_PLACED')
    await notifyOrderEvent(order, 'PAYMENT_SUCCESS')
    return res.status(201).json({ success: true, data: { order: serializeOrder(order) } })
  } catch (err) {
    if (err && Number.isInteger(err.statusCode)) {
      return res.status(err.statusCode).json({ success: false, message: err.message })
    }
    return next(err)
  }
}

/* POST /api/payments/razorpay/fail — { razorpay_order_id }.
   Customer dismissed or failed the modal; the attempt closes, the cart
   is untouched and checkout can be retried safely. Idempotent. */
export async function markRazorpayFailed(req, res, next) {
  try {
    const razorpayOrderId = str(req.body?.razorpay_order_id)
    if (!razorpayOrderId) {
      return res.status(400).json({ success: false, message: 'Payment reference is required.' })
    }
    const attempt = await PaymentAttempt.findOne({ razorpayOrderId, user: req.user._id })
    if (!attempt) {
      const nf = notFound()
      return res.status(nf.status).json(nf.body)
    }
    if (attempt.status === 'paid') {
      return res.status(409).json({ success: false, message: 'This payment has already been processed.' })
    }
    let transitioned = false
    if (attempt.status === 'pending' || attempt.status === 'processing') {
      attempt.status = 'failed'
      attempt.failureReason = 'cancelled or failed by customer'
      await attempt.save()
      transitioned = true
    }
    /* Step 19 — failure notice only on the actual transition, so
       idempotent retries notify once. Best-effort; never blocks retry. */
    if (transitioned) {
      const c = attempt.customer || {}
      const customerName = `${c.firstName || ''} ${c.lastName || ''}`.trim()
      await notifyPaymentFailure({
        userId: req.user._id,
        email: c.email,
        customerName,
        amount: attempt.total,
        paymentLabel: ONLINE_LABELS[attempt.paymentMethod] || attempt.paymentMethod,
      })
    }
    return res.status(200).json({ success: true, data: { status: attempt.status } })
  } catch (err) {
    return next(err)
  }
}

/* POST /api/payments/razorpay/webhook — server-to-server, raw body.
   Unsigned or mis-signed payloads are rejected; processing is
   idempotent and shares completePaidOrder with the verify path so a
   verify/webhook race always converges on one correct final state. */
export async function razorpayWebhook(req, res, next) {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : null
    if (!rawBody) {
      return res.status(400).json({ success: false, message: 'Invalid webhook payload.' })
    }
    if (!isWebhookConfigured()) {
      return res.status(503).json({ success: false, message: 'Webhook handling is not configured.' })
    }
    const signature = req.headers['x-razorpay-signature']
    if (!verifyWebhookSignature({ rawBody, signature })) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature.' })
    }
    let event
    try {
      event = JSON.parse(rawBody.toString('utf8'))
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid webhook payload.' })
    }

    const type = event?.event
    const entity = event?.payload?.payment?.entity
    if (type === 'payment.failed') {
      const orderId = entity?.order_id
      if (orderId) {
        const failedAttempt = await PaymentAttempt.findOne({ razorpayOrderId: orderId })
        /* Step 19 — notify only on the real pending → failed transition;
           gateway replays stay silent. */
        if (failedAttempt && failedAttempt.status === 'pending') {
          await PaymentAttempt.updateOne(
            { _id: failedAttempt._id, status: 'pending' },
            { $set: { status: 'failed', failureReason: 'gateway reported failure' } },
          )
          const c = failedAttempt.customer || {}
          const customerName = `${c.firstName || ''} ${c.lastName || ''}`.trim()
          await notifyPaymentFailure({
            userId: failedAttempt.user,
            email: c.email,
            customerName,
            amount: failedAttempt.total,
            paymentLabel: ONLINE_LABELS[failedAttempt.paymentMethod] || failedAttempt.paymentMethod,
          })
        }
      }
      return res.status(200).json({ success: true })
    }
    if (type !== 'payment.captured' || !entity?.order_id || !entity?.id) {
      return res.status(200).json({ success: true })
    }

    const attempt = await PaymentAttempt.findOne({ razorpayOrderId: entity.order_id })
    if (!attempt || attempt.status === 'paid') {
      return res.status(200).json({ success: true })
    }
    if (attempt.status !== 'pending') {
      return res.status(200).json({ success: true })
    }
    if (!attempt.customer?.firstName || !attempt.shippingAddress?.address) {
      // Contact details arrive at verify time; the verify path owns
      // completion for such attempts.
      return res.status(200).json({ success: true })
    }

    const claimed = await PaymentAttempt.findOneAndUpdate(
      { _id: attempt._id, status: 'pending' },
      { $set: { status: 'processing', razorpayPaymentId: entity.id } },
      { new: true },
    )
    if (!claimed) {
      return res.status(200).json({ success: true })
    }

    // Resolve from the frozen snapshot (webhook has no cart guarantee).
    const lines = []
    for (const item of attempt.items || []) {
      const product = await findProductByRef(item.productId)
      if (!product) {
        await PaymentAttempt.updateOne({ _id: attempt._id }, { $set: { status: 'pending', razorpayPaymentId: null } })
        return res.status(200).json({ success: true })
      }
      const stock = Number(product.stock)
      if (!Number.isInteger(item.qty) || item.qty < 1 || !Number.isFinite(stock) || stock < item.qty) {
        await PaymentAttempt.updateOne({ _id: attempt._id }, { $set: { status: 'pending', razorpayPaymentId: null } })
        return res.status(200).json({ success: true })
      }
      lines.push({ product, qty: item.qty, size: item.size || null, colour: item.colour || null })
    }
    const totals = computeTotals(
      lines.reduce((n, { product, qty }) => n + product.price * qty, 0),
      attempt.deliveryMethod,
      Number(attempt.discount || 0),
    )
    if (totals.total !== attempt.total) {
      await PaymentAttempt.updateOne({ _id: attempt._id }, { $set: { status: 'pending', razorpayPaymentId: null } })
      return res.status(200).json({ success: true })
    }
    /* Step 18 — the gateway amount already reflects the frozen coupon
       discount; claim usage best-effort so the paid order keeps the
       exact snapshot the customer was charged. */
    const webhookCouponSnapshot = attempt.couponSnapshot?.code
      ? {
        code: attempt.couponSnapshot.code,
        discountType: attempt.couponSnapshot.discountType,
        discountValue: attempt.couponSnapshot.discountValue,
        discountAmount: Number(attempt.discount || 0),
      }
      : null
    let webhookCoupon = null
    if (webhookCouponSnapshot) {
      try {
        const found = await Coupon.findOne({ code: webhookCouponSnapshot.code })
        if (found) {
          evaluateCoupon(
            found,
            attempt.user,
            lines.map(({ product, qty }) => ({ product, qty })),
          )
          webhookCoupon = found
        }
      } catch {
        webhookCoupon = null
      }
    }
    let webhookClaimed = false
    if (webhookCoupon) {
      try {
        await claimCouponUsage(webhookCoupon._id, attempt.user)
        webhookClaimed = true
      } catch {
        webhookClaimed = false
      }
    }

    let order
    try {
      order = await completePaidOrder({
        userId: attempt.user,
        lines,
        totals,
        deliveryId: attempt.deliveryMethod,
        paymentMethod: attempt.paymentMethod,
        customer: Object.fromEntries(
          ['firstName', 'lastName', 'email', 'phone'].map((k) => [k, attempt.customer[k]]),
        ),
        shippingAddress: Object.fromEntries(
          ['address', 'apartment', 'city', 'state', 'pin', 'country'].map((k) => [k, attempt.shippingAddress[k]]),
        ),
        razorpayOrderId: attempt.razorpayOrderId,
        razorpayPaymentId: entity.id,
        couponSnapshot: webhookCouponSnapshot,
      })
    } catch {
      if (webhookClaimed && webhookCoupon) await releaseCouponUsage(webhookCoupon._id, attempt.user)
      await PaymentAttempt.updateOne(
        { _id: attempt._id },
        { $set: { status: 'failed', failureReason: 'webhook completion failed' } },
      )
      return res.status(200).json({ success: true })
    }
    await PaymentAttempt.updateOne(
      { _id: attempt._id },
      { $set: { status: 'paid', clothzaOrderNumber: order.orderNumber, paidAt: order.paidAt } },
    )
    /* Step 19 — same lifecycle notices as the verify path. Only the
       single atomic-claim winner reaches here. */
    await notifyOrderEvent(order, 'ORDER_PLACED')
    await notifyOrderEvent(order, 'PAYMENT_SUCCESS')
    return res.status(200).json({ success: true })
  } catch (err) {
    return next(err)
  }
}
