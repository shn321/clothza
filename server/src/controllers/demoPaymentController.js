import crypto from 'node:crypto'
import Cart from '../models/Cart.js'
import Coupon from '../models/Coupon.js'
import DemoPayment from '../models/DemoPayment.js'
import Order, { computeTotals } from '../models/Order.js'
import Product from '../models/Product.js'
import { createOrderDoc, DELIVERY_META, normalizePaymentMethod, serializeOrder } from './orderController.js'
import { resolveCartLines } from './paymentController.js'
import {
  claimCouponUsage,
  evaluateCoupon,
  normalizeCouponCode,
  releaseCouponUsage,
} from '../services/couponService.js'
import { notifyOrderEvent, notifyPaymentFailure } from '../services/notificationService.js'
import { cartFingerprint } from '../services/razorpayService.js'
import { str, validateCustomer, validateShipping } from '../utils/orderValidation.js'

/* CLOTHZA simulated demo online payments (Step 30) — portfolio only.
   NOT a real gateway: no Razorpay/Stripe/PayPal, no external calls, no
   card data anywhere. Flow:
     1. POST /api/payments/demo/order   → server quotes the total from
        MongoDB prices and returns { demoSessionId, amount }.
     2. Frontend simulates processing ("Pay ₹X — DEMO") and calls
        POST /api/payments/demo/confirm → backend re-validates the live
        cart, recomputes totals, atomically claims the session and
        creates the PAID order (paymentMethod demo_online).
   The frontend can never mark an order paid: `paymentStatus: paid` is
   set only here, from server-computed totals. Duplicate confirms hit
   the atomic pending → processing claim and replay the same order. */

const DELIVERY_IDS = ['standard', 'express']
const DEMO_SUFFIX_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function makeDemoSessionId() {
  let suffix = ''
  const bytes = crypto.randomBytes(8)
  for (let i = 0; i < 8; i += 1) {
    suffix += DEMO_SUFFIX_CHARS[bytes[i] % DEMO_SUFFIX_CHARS.length]
  }
  return `DEMO-${suffix}`
}

function demoQuote(session) {
  return {
    demo: true,
    demoSessionId: session.demoSessionId,
    amount: session.total,
    currency: session.currency || 'INR',
    subtotal: session.subtotal,
    shippingCost: session.shippingCost,
    discount: session.discount || 0,
    total: session.total,
  }
}

function snapshotItems(lines) {
  return lines.map(({ product, qty, size, colour }) => ({
    productId: product.legacyId || product.slug,
    size,
    colour,
    qty,
  }))
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

/* POST /api/payments/demo/order — { deliveryMethod, customer?, shipping?, couponCode? }.
   Server quotes the payable total from MongoDB. Refresh/retry with an
   unchanged bag reuses the pending session (no duplicate sessions). */
export async function createDemoSession(req, res, next) {
  try {
    const deliveryId = str(req.body?.deliveryMethod || req.body?.delivery || req.body?.deliveryId || 'standard')
    if (!DELIVERY_IDS.includes(deliveryId)) {
      return res.status(400).json({ success: false, message: 'Invalid delivery method.' })
    }

    const { lines, subtotal } = await resolveCartLines(req.user._id)

    /* Only the coupon code is accepted; the discount is recomputed here
       from live MongoDB prices — frontend amounts are never trusted. */
    const couponCode = normalizeCouponCode(req.body?.couponCode || req.body?.coupon)
    let couponDiscount = 0
    let couponSnapshot = null
    if (couponCode) {
      const found = await Coupon.findOne({ code: couponCode })
      try {
        const evaluated = evaluateCoupon(found, req.user._id, lines)
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
    const fingerprint = cartFingerprint(snapshotItems(lines))

    /* Idempotent retry: unchanged bag (+ coupon + totals) reuses the
       pending session instead of minting a duplicate. */
    const existing = await DemoPayment.findOne({
      user: req.user._id,
      status: 'pending',
      deliveryMethod: deliveryId,
    }).sort({ createdAt: -1 })
    if (
      existing &&
      cartFingerprint(existing.items) === fingerprint &&
      existing.total === totals.total &&
      (existing.couponCode || null) === (couponSnapshot?.code || null) &&
      Number(existing.discount || 0) === Number(totals.discount || 0)
    ) {
      return res.status(200).json({ success: true, data: demoQuote(existing) })
    }
    await DemoPayment.updateMany(
      { user: req.user._id, status: 'pending' },
      { $set: { status: 'expired', failureReason: 'superseded by a newer demo session' } },
    )

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

    const session = await DemoPayment.create({
      user: req.user._id,
      demoSessionId: makeDemoSessionId(),
      items: snapshotItems(lines),
      subtotal: totals.subtotal,
      shippingCost: totals.shippingCost,
      discount: totals.discount,
      couponCode: couponSnapshot?.code || null,
      couponSnapshot,
      total: totals.total,
      deliveryMethod: deliveryId,
      customer,
      shippingAddress,
      status: 'pending',
    })
    return res.status(201).json({ success: true, data: demoQuote(session) })
  } catch (err) {
    if (err && Number.isInteger(err.statusCode)) {
      return res.status(err.statusCode).json({ success: false, message: err.message })
    }
    return next(err)
  }
}

/* POST /api/payments/demo/confirm — { demoSessionId, customer, shipping, idempotencyKey? }.
   The single secure path that mints a paid demo_online order. Totals
   are recomputed from the live cart; only the atomic-claim winner
   completes. Replays return the existing order. */
export async function confirmDemoPayment(req, res, next) {
  try {
    const demoSessionId = str(req.body?.demoSessionId || req.body?.demo_session_id)
    if (!demoSessionId) {
      return res.status(400).json({ success: false, message: 'Demo payment reference is required.' })
    }
    const session = await DemoPayment.findOne({ demoSessionId, user: req.user._id })
    if (!session) {
      return res.status(404).json({ success: false, message: 'Demo payment session not found.' })
    }
    if (session.status === 'paid') {
      const existing = await Order.findOne({
        orderNumber: session.clothzaOrderNumber,
        user: req.user._id,
      })
      if (!existing) {
        return res.status(500).json({ success: false, message: 'Something went wrong. Please contact support.' })
      }
      return res.status(200).json({ success: true, data: { order: serializeOrder(existing), replay: true } })
    }
    if (session.status !== 'pending') {
      return res.status(409).json({ success: false, message: 'This demo payment session is no longer active.' })
    }

    /* Sanity: the session must belong to the demo method family. */
    if (normalizePaymentMethod(req.body?.paymentMethod || 'demo_online') !== 'demo_online') {
      return res.status(400).json({ success: false, message: 'Invalid payment method for demo confirmation.' })
    }

    let customer
    let shippingAddress
    try {
      customer = validateCustomer(req.body?.customer)
      shippingAddress = validateShipping(req.body?.shipping || req.body?.shippingAddress)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message })
    }

    /* Live cart must still match the quoted amount; coupon discounts are
       recomputed server-side and must still match. */
    const { lines, subtotal } = await resolveCartLines(req.user._id)
    let coupon = null
    let couponSnapshot = null
    if (session.couponCode) {
      const found = await Coupon.findOne({ code: session.couponCode })
      try {
        const evaluated = evaluateCoupon(found, req.user._id, lines)
        coupon = evaluated.coupon
        couponSnapshot = {
          code: evaluated.coupon.code,
          discountType: evaluated.coupon.discountType,
          discountValue: evaluated.coupon.discountValue,
          discountAmount: evaluated.discountAmount,
        }
        if (Number(evaluated.discountAmount) !== Number(session.discount || 0)) {
          return res.status(400).json({
            success: false,
            message: 'Your coupon no longer gives the same discount. Please start checkout again.',
          })
        }
      } catch (err) {
        return res.status(err.statusCode || 400).json({ success: false, message: err.message })
      }
    }
    const totals = computeTotals(subtotal, session.deliveryMethod, couponSnapshot?.discountAmount || 0)
    if (totals.total !== session.total || totals.subtotal !== session.subtotal) {
      return res.status(400).json({
        success: false,
        message: 'Your bag changed during payment. Please start checkout again.',
      })
    }

    /* Atomic claim — only one confirm path wins. */
    const claimed = await DemoPayment.findOneAndUpdate(
      { _id: session._id, status: 'pending' },
      { $set: { status: 'processing' } },
      { new: true },
    )
    if (!claimed) {
      const current = await DemoPayment.findById(session._id)
      if (current && current.status === 'paid' && current.clothzaOrderNumber) {
        const existing = await Order.findOne({
          orderNumber: current.clothzaOrderNumber,
          user: req.user._id,
        })
        if (existing) {
          return res.status(200).json({ success: true, data: { order: serializeOrder(existing), replay: true } })
        }
      }
      return res.status(409).json({ success: false, message: 'Demo payment is already being processed. Please wait a moment and try again.' })
    }

    /* Guarded stock decrements — never negative, no oversell on races. */
    const decremented = []
    for (const { product, qty } of lines) {
      const result = await Product.updateOne(
        { _id: product._id, stock: { $gte: qty } },
        { $inc: { stock: -qty } },
      )
      if (result.matchedCount === 0) {
        await restoreStock(decremented)
        await DemoPayment.updateOne(
          { _id: session._id },
          { $set: { status: 'failed', failureReason: 'stock changed during demo payment' } },
        )
        return res.status(409).json({ success: false, message: `“${product.name}” just went out of stock.` })
      }
      decremented.push({ productId: product._id, qty })
    }

    let couponClaimed = false
    if (coupon) {
      try {
        await claimCouponUsage(coupon._id, req.user._id)
        couponClaimed = true
      } catch (err) {
        await restoreStock(decremented)
        await DemoPayment.updateOne(
          { _id: session._id },
          { $set: { status: 'pending' } },
        )
        return res.status(err.statusCode || 400).json({ success: false, message: err.message })
      }
    }

    const idempotencyKey = str(
      req.body?.idempotencyKey || req.headers['x-idempotency-key'],
    ).slice(0, 128) || undefined
    if (idempotencyKey) {
      const prior = await Order.findOne({ user: req.user._id, idempotencyKey })
      if (prior) {
        await DemoPayment.updateOne(
          { _id: session._id },
          { $set: { status: 'paid', clothzaOrderNumber: prior.orderNumber, paidAt: prior.paidAt || new Date() } },
        )
        return res.status(200).json({ success: true, data: { order: serializeOrder(prior), replay: true } })
      }
    }

    const meta = DELIVERY_META[session.deliveryMethod]
    let order
    try {
      order = await createOrderDoc({
        user: req.user._id,
        ...(idempotencyKey ? { idempotencyKey } : {}),
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
        deliveryMethod: {
          id: session.deliveryMethod,
          label: meta.label,
          charge: totals.shippingCost,
          eta: meta.eta,
        },
        ...totals,
        ...(couponSnapshot ? { coupon: couponSnapshot } : {}),
        /* Server-decided: simulated demo payment is always recorded
           paid with the demo provider. Never from client input. */
        paymentMethod: 'demo_online',
        paymentStatus: 'paid',
        paymentProvider: 'demo',
        paidAt: new Date(),
        orderStatus: 'pending',
      })
    } catch (err) {
      if (err && err.message === '__IDEMPOTENT_REPLAY__' && err.replayOrder) {
        await DemoPayment.updateOne(
          { _id: session._id },
          { $set: { status: 'paid', clothzaOrderNumber: err.replayOrder.orderNumber, paidAt: new Date() } },
        )
        return res.status(200).json({
          success: true,
          data: { order: serializeOrder(err.replayOrder), replay: true },
        })
      }
      await restoreStock(decremented)
      if (couponClaimed && coupon) await releaseCouponUsage(coupon._id, req.user._id)
      await DemoPayment.updateOne(
        { _id: session._id },
        { $set: { status: 'failed', failureReason: 'order completion failed after demo confirmation' } },
      )
      return next(err)
    }

    try {
      await Cart.findOneAndDelete({ user: req.user._id })
    } catch {
      // Order stands; the client also clears.
    }
    await DemoPayment.updateOne(
      { _id: session._id },
      { $set: { status: 'paid', clothzaOrderNumber: order.orderNumber, paidAt: order.paidAt } },
    )
    /* Lifecycle notices — only the atomic-claim winner reaches here, so
       retries/replays can never duplicate them. Best-effort by design. */
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

/* POST /api/payments/demo/fail — { demoSessionId }.
   Shopper abandoned the simulated payment; the session closes, the
   cart is untouched and checkout can be retried safely. Idempotent. */
export async function failDemoPayment(req, res, next) {
  try {
    const demoSessionId = str(req.body?.demoSessionId || req.body?.demo_session_id)
    if (!demoSessionId) {
      return res.status(400).json({ success: false, message: 'Demo payment reference is required.' })
    }
    const session = await DemoPayment.findOne({ demoSessionId, user: req.user._id })
    if (!session) {
      return res.status(404).json({ success: false, message: 'Demo payment session not found.' })
    }
    if (session.status === 'paid') {
      return res.status(409).json({ success: false, message: 'This demo payment has already been processed.' })
    }
    let transitioned = false
    if (session.status === 'pending' || session.status === 'processing') {
      session.status = 'failed'
      session.failureReason = 'cancelled or failed by customer (demo)'
      await session.save()
      transitioned = true
    }
    /* Failure notice only on the actual transition, so idempotent
       retries notify once. Best-effort; never blocks retry. */
    if (transitioned) {
      const c = session.customer || {}
      const customerName = `${c.firstName || ''} ${c.lastName || ''}`.trim()
      await notifyPaymentFailure({
        userId: req.user._id,
        email: c.email,
        customerName,
        amount: session.total,
        paymentLabel: 'Online Payment (Demo)',
      })
    }
    return res.status(200).json({ success: true, data: { status: session.status, demo: true } })
  } catch (err) {
    return next(err)
  }
}

/* POST /api/payments/demo/verify — alias kept for symmetry with the
   Razorpay flow docs; delegates to the same secure confirm path. */
export async function verifyDemoPayment(req, res, next) {
  return confirmDemoPayment(req, res, next)
}
