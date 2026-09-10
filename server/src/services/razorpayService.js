import crypto from 'node:crypto'

/* Razorpay TEST MODE service (Step 15).
   Pure helpers (paise conversion, payload building, HMAC signatures)
   are dependency-free and unit-testable without network or credentials.
   The gateway client is created lazily per call from environment config
   so tests can run with placeholder secrets and production never holds
   credentials in module state. Real money is never involved: TEST MODE
   only, and every amount still originates server-side from MongoDB. */

export const RAZORPAY_CURRENCY = 'INR'

function getConfig() {
  return {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  }
}

export function isGatewayConfigured() {
  const { keyId, keySecret } = getConfig()
  return Boolean(keyId && keySecret)
}

export function isWebhookConfigured() {
  return Boolean(getConfig().webhookSecret)
}

/* Rupees → paise as an integer. Totals are whole rupees in CLOTHZA,
   but rounding guards against any fractional input. */
export function toPaise(rupees) {
  const n = Number(rupees)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('Amount must be a positive number')
  }
  return Math.round(n * 100)
}

/* Gateway order payload — amount and receipt are server-generated.
   `receipt` is an internal idempotency reference, never a secret. */
export function buildGatewayOrderPayload({ amountPaise, receipt, notes = {} }) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error('Amount must be a positive integer in paise')
  }
  const safeReceipt = String(receipt || '').trim().slice(0, 40)
  if (!safeReceipt) throw new Error('Receipt is required')
  return {
    amount: amountPaise,
    currency: RAZORPAY_CURRENCY,
    receipt: safeReceipt,
    notes,
  }
}

/* Cart fingerprint — identifies identical intents so a refresh/retry
   reuses the pending gateway order instead of creating duplicates. */
export function cartFingerprint(items) {
  const parts = (Array.isArray(items) ? items : [])
    .map((l) => `${l.productId}|${l.size || ''}|${l.colour || ''}|${l.qty}`)
    .sort()
  return crypto.createHash('sha256').update(parts.join('~')).digest('hex')
}

/* HMAC-SHA256(razorpay_order_id|razorpay_payment_id, key_secret) — the
   exact signature Razorpay Checkout sends back. */
export function paymentSignature({ razorpayOrderId, razorpayPaymentId, keySecret }) {
  const secret = keySecret ?? getConfig().keySecret
  if (!razorpayOrderId || !razorpayPaymentId || !secret) {
    throw new Error('Cannot sign payment response without order, payment and secret')
  }
  return crypto
    .createHmac('sha256', secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex')
}

/* Constant-time comparison — never leak match position via timing. */
export function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature, keySecret }) {
  try {
    const expected = paymentSignature({ razorpayOrderId, razorpayPaymentId, keySecret })
    const a = Buffer.from(String(expected), 'utf8')
    const b = Buffer.from(String(razorpaySignature || ''), 'utf8')
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/* Webhook signature: HMAC-SHA256(rawBody, webhook_secret), hex. */
export function verifyWebhookSignature({ rawBody, signature, webhookSecret }) {
  try {
    const secret = webhookSecret ?? getConfig().webhookSecret
    if (!rawBody || !signature || !secret) return false
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(String(signature), 'utf8')
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/* Lazy SDK client — throws a safe, user-facing error when unconfigured
   so routes return 503 instead of crashing. The SDK import is local to
   keep startup dependency-free. */
async function getGatewayClient() {
  const { keyId, keySecret } = getConfig()
  if (!keyId || !keySecret) {
    const err = new Error('Online payments are not configured.')
    err.statusCode = 503
    throw err
  }
  const { default: Razorpay } = await import('razorpay')
  return new Razorpay({ key_id: keyId, key_secret: keySecret })
}

/* Create a TEST MODE gateway order. Throws the safe 503 above when
   unconfigured; SDK/network errors propagate to the route handler,
   which converts them to a generic 502 without leaking details. */
export async function createGatewayOrder(payload) {
  const client = await getGatewayClient()
  return client.orders.create(payload)
}
