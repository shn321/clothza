import Notification, { NOTIFICATION_TYPES } from '../models/Notification.js'
import User from '../models/User.js'
import { invalid } from '../utils/orderValidation.js'
import {
  orderCancelledEmail,
  orderDeliveredEmail,
  orderPlacedEmail,
  orderShippedEmail,
  paymentFailedEmail,
  paymentSuccessEmail,
} from './emailTemplates.js'
import { sendEmail } from './emailService.js'

/* CLOTHZA notification service (Step 19) — the single place that mints
   user notifications and pairs them with transactional email.
   - The owner ALWAYS comes from server data (order.user / req.user);
     arbitrary user ids from the frontend are never accepted.
   - notifyOrderEvent() NEVER throws: notification/email failures are
     contained so checkout, payment and admin flows can never break.
   - Transactional order/payment emails are always attempted (they must
     not be silently disabled by a marketing preference); only
     non-transactional types (COUPON/SYSTEM) honour
     user.emailNotifications === false. */

const TRANSACTIONAL_TYPES = new Set([
  'ORDER_PLACED',
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
  'ORDER_CONFIRMED',
  'ORDER_PROCESSING',
  'ORDER_SHIPPED',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
])

/* Step 31 — lifecycle types that may exist only ONCE per order.
   A valid flow can never repeat them (statuses never recur, an order is
   placed and paid once), so a retried admin request or a double-fired
   event resolves to the existing notification instead of a duplicate.
   PAYMENT_FAILED is intentionally excluded: each failed attempt is a
   distinct event (per-transition guards at the call sites already make
   retries silent). */
const ONCE_PER_ORDER_TYPES = new Set([
  'ORDER_PLACED',
  'PAYMENT_SUCCESS',
  'ORDER_CONFIRMED',
  'ORDER_PROCESSING',
  'ORDER_SHIPPED',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
])

/* Step 31 — customer-facing copy. COD and simulated demo payments get
   their own wording so shoppers always know what happened; status
   wording matches the portfolio spec. No secrets or payment details
   are ever included — only the order number. */
const ORDER_COPY = {
  ORDER_PLACED: (n, order) =>
    order?.paymentMethod === 'cod'
      ? {
        title: 'Order placed',
        message: `Your Cash on Delivery order ${n} has been placed successfully.`,
      }
      : {
        title: 'Order placed',
        message: `Your order ${n} has been placed successfully.`,
      },
  PAYMENT_SUCCESS: (n, order) =>
    order?.paymentProvider === 'demo' || order?.paymentMethod === 'demo_online'
      ? {
        title: 'Demo payment successful',
        message: `Your demo payment for order ${n} was successful. This was a simulated payment — no real money moved.`,
      }
      : {
        title: 'Payment successful',
        message: `Payment for order ${n} was successful.`,
      },
  PAYMENT_FAILED: (n) => ({
    title: 'Payment failed',
    message: `Payment for order ${n} did not go through. Your bag is saved — please try again.`,
  }),
  ORDER_CONFIRMED: (n) => ({
    title: 'Order Confirmed',
    message: `Your order ${n} has been confirmed.`,
  }),
  ORDER_PROCESSING: (n) => ({
    title: 'Order Processing',
    message: `Your order ${n} is now being prepared.`,
  }),
  ORDER_SHIPPED: (n) => ({
    title: 'Order Shipped',
    message: `Your order ${n} has been shipped.`,
  }),
  ORDER_DELIVERED: (n) => ({
    title: 'Order Delivered',
    message: `Your order ${n} has been delivered.`,
  }),
  ORDER_CANCELLED: (n) => ({
    title: 'Order Cancelled',
    message: `Your order ${n} has been cancelled.`,
  }),
}

const EMAIL_BUILDERS = {
  ORDER_PLACED: orderPlacedEmail,
  PAYMENT_SUCCESS: paymentSuccessEmail,
  PAYMENT_FAILED: paymentFailedEmail,
  ORDER_SHIPPED: orderShippedEmail,
  ORDER_DELIVERED: orderDeliveredEmail,
  ORDER_CANCELLED: orderCancelledEmail,
}

/* Low-level creation. Throws on programmer errors (unknown type,
   missing owner) so tests catch misuse; lifecycle callers go through
   notifyOrderEvent(), which contains all failures. */
export async function createNotification({ userId, type, title, message, orderNumber = null }) {
  if (!userId) throw invalid('User reference is required.', 500)
  if (!NOTIFICATION_TYPES.includes(type)) throw invalid('Invalid notification type.', 500)
  const safeTitle = String(title || '').trim()
  const safeMessage = String(message || '').trim()
  if (!safeTitle || !safeMessage) throw invalid('Notification title and message are required.', 500)
  return Notification.create({
    user: userId,
    type,
    title: safeTitle.slice(0, 160),
    message: safeMessage.slice(0, 2000),
    orderNumber: orderNumber ? String(orderNumber).trim() : null,
    isRead: false,
  })
}

/* Build the standard order-lifecycle notification content. The owner
   always comes from the order document — never from request data. */
export async function createOrderNotification(order, type) {
  if (!order || !order.user) throw invalid('Order owner is required.', 500)
  const copy = ORDER_COPY[type]
  if (!copy) throw invalid('Invalid order notification type.', 500)
  const { title, message } = copy(order.orderNumber, order)
  return createNotification({
    userId: order.user,
    type,
    title,
    message,
    orderNumber: order.orderNumber,
  })
}

function recipientEmail(order) {
  const email = String(order?.customer?.email || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

/* Full lifecycle event: persist the notification, then attempt the
   matching transactional email. NEVER throws — returns a summary.
   Email is skipped (not failed) when there is no template for the
   type, no recipient, or the user opted out of non-transactional mail.
   Step 31 — once-per-order dedup: if this exact (owner, type, order)
   notification already exists (retried admin request, double-fired
   event), the existing one is returned and NO duplicate email is sent.
   Complements the unchanged-status early return in the admin flow. */
export async function notifyOrderEvent(order, type) {
  const result = { notification: null, email: { sent: false, skipped: true } }
  if (!order || !order.user) return result
  if (ONCE_PER_ORDER_TYPES.has(type) && order.orderNumber) {
    try {
      const existing = await Notification.findOne({
        user: order.user,
        type,
        orderNumber: order.orderNumber,
      }).lean()
      if (existing) {
        return {
          notification: existing,
          email: { sent: false, skipped: true, reason: 'duplicate' },
          deduped: true,
        }
      }
    } catch {
      // Dedup lookup must never block the lifecycle event.
    }
  }
  try {
    result.notification = await createOrderNotification(order, type)
  } catch {
    return result
  }
  const buildEmail = EMAIL_BUILDERS[type]
  if (!buildEmail) return result
  const to = recipientEmail(order)
  if (!to) return result
  if (!TRANSACTIONAL_TYPES.has(type)) {
    try {
      const owner = await User.findById(order.user).select('emailNotifications').lean()
      if (owner && owner.emailNotifications === false) {
        result.email = { sent: false, skipped: true, reason: 'opted-out' }
        return result
      }
    } catch {
      return result
    }
  }
  try {
    const { subject, html, text } = buildEmail(order)
    result.email = await sendEmail({ to, subject, html, text })
  } catch {
    result.email = { sent: false, error: 'delivery failed' }
  }
  return result
}

/* Payment failure BEFORE any CLOTHZA order exists (dismissed modal,
   gateway failure). There is no order number yet — the notification and
   email reference the attempted amount only. NEVER throws. */
export async function notifyPaymentFailure({ userId, email, customerName, amount, paymentLabel }) {
  const result = { notification: null, email: { sent: false, skipped: true } }
  if (!userId) return result
  const safeAmount = Number(amount)
  const amountLabel = Number.isFinite(safeAmount)
    ? `₹${safeAmount.toLocaleString('en-IN')}`
    : 'your payment'
  try {
    result.notification = await createNotification({
      userId,
      type: 'PAYMENT_FAILED',
      title: 'Payment failed',
      message: `Your payment of ${amountLabel} did not go through. Your bag is saved — please try again.`,
    })
  } catch {
    return result
  }
  const to = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return result
  try {
    const name = String(customerName || '').trim()
    const { subject, html, text } = paymentFailedEmail({
      customer: { firstName: name },
      orderNumber: '',
      items: [],
      subtotal: Number.isFinite(safeAmount) ? safeAmount : 0,
      discount: 0,
      shippingCost: 0,
      total: Number.isFinite(safeAmount) ? safeAmount : 0,
      paymentMethodLabel: paymentLabel || '',
    })
    result.email = await sendEmail({ to, subject, html, text })
  } catch {
    result.email = { sent: false, error: 'delivery failed' }
  }
  return result
}

/* Mark one notification read — owner-scoped. Returns the doc or throws
   404 (unknown id, or owned by someone else — same response, no leak). */
export async function markNotificationRead(userId, id) {
  const doc = await Notification.findOne({ _id: id, user: userId })
  if (!doc) throw invalid('Notification not found.', 404)
  if (!doc.isRead) {
    doc.isRead = true
    await doc.save()
  }
  return doc
}

/* Mark every unread notification read. Returns the modified count. */
export async function markAllNotificationsRead(userId) {
  const res = await Notification.updateMany(
    { user: userId, isRead: false },
    { $set: { isRead: true } },
  )
  return { modified: res.modifiedCount ?? 0 }
}
