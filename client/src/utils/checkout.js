/* CLOTHZA demo checkout helpers — frontend only, dependency-free.
   No real payment processing. Sensitive card fields are validated for
   demo UX but NEVER persisted (see buildSafeOrder). */

export const LAST_ORDER_KEY = 'clothza_last_order'

export const EXPRESS_CHARGE = 199

export const DELIVERY_METHODS = [
  {
    id: 'standard',
    label: 'Standard Delivery',
    charge: 0,
    eta: '5–7 business days',
    etaDays: [5, 7],
  },
  {
    id: 'express',
    label: 'Express Delivery',
    charge: EXPRESS_CHARGE,
    eta: '2–3 business days',
    etaDays: [2, 3],
  },
]

/* Step 30 — portfolio checkout offers exactly two payment methods:
   Cash on Delivery, and a clearly-labelled simulated Online Payment
   (Demo). No real gateway is involved; the demo flow is a frontend
   simulation backed by server-computed totals. */
export const PAYMENT_METHODS = [
  { id: 'cod', label: 'Cash on Delivery' },
  { id: 'demo_online', label: 'Online Payment (Demo)', hint: 'Simulated test payment — no real money moves.' },
]

export const COUNTRIES = [
  'India',
  'United States',
  'United Kingdom',
  'United Arab Emirates',
  'Australia',
  'Canada',
  'Singapore',
  'Germany',
  'France',
  'Japan',
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const UPI_RE = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$/
const EXPIRY_RE = /^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/

export const digitsOnly = (value) => String(value || '').replace(/\D/g, '')

export function validateCustomer(values) {
  const errors = {}
  if (!String(values.firstName || '').trim()) errors.firstName = 'First name is required.'
  if (!String(values.lastName || '').trim()) errors.lastName = 'Last name is required.'
  const email = String(values.email || '').trim()
  if (!email) errors.email = 'Email address is required.'
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.'
  const digits = digitsOnly(values.phone)
  if (!String(values.phone || '').trim()) errors.phone = 'Phone number is required.'
  else if (digits.length < 7 || digits.length > 15)
    errors.phone = 'Enter a valid phone number (7–15 digits).'
  return errors
}

export function validateShipping(values) {
  const errors = {}
  if (!String(values.address || '').trim()) errors.address = 'Address is required.'
  if (!String(values.city || '').trim()) errors.city = 'City is required.'
  if (!String(values.state || '').trim()) errors.state = 'State is required.'
  const pin = String(values.pin || '').trim()
  if (!pin) {
    errors.pin = 'PIN / ZIP code is required.'
  } else if (values.country === 'India') {
    if (!/^\d{6}$/.test(pin.replace(/\s/g, '')))
      errors.pin = 'Enter a valid 6-digit PIN code.'
  } else if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(pin)) {
    errors.pin = 'Enter a valid ZIP / postal code.'
  }
  if (!String(values.country || '').trim()) errors.country = 'Country is required.'
  return errors
}

export function validateCardPayment(values) {
  const errors = {}
  if (!String(values.cardName || '').trim())
    errors.cardName = 'Cardholder name is required.'
  const digits = digitsOnly(values.cardNumber)
  if (!String(values.cardNumber || '').trim()) errors.cardNumber = 'Card number is required.'
  else if (digits.length !== 16) errors.cardNumber = 'Enter the 16-digit card number.'
  const expiry = String(values.expiry || '').trim()
  const match = EXPIRY_RE.exec(expiry)
  if (!expiry) {
    errors.expiry = 'Expiry date is required.'
  } else if (!match) {
    errors.expiry = 'Use MM/YY format.'
  } else {
    const month = Number(match[1])
    let year = Number(match[2])
    if (year < 100) year += 2000
    const now = new Date()
    const current = now.getFullYear() * 12 + (now.getMonth() + 1)
    if (year * 12 + month < current) errors.expiry = 'Card expiry must be in the future.'
  }
  const cvv = digitsOnly(values.cvv)
  if (!String(values.cvv || '').trim()) errors.cvv = 'CVV is required.'
  else if (cvv.length < 3 || cvv.length > 4) errors.cvv = 'Enter the 3–4 digit CVV.'
  return errors
}

export function validateUpiPayment(values) {
  const errors = {}
  const id = String(values.upiId || '').trim()
  if (!id) errors.upiId = 'UPI ID is required.'
  else if (!UPI_RE.test(id)) errors.upiId = 'Enter a valid UPI ID (e.g. name@bank).'
  return errors
}

export function isValidDeliveryMethod(id) {
  return DELIVERY_METHODS.some((m) => m.id === id)
}

export function isValidPaymentMethod(id) {
  return PAYMENT_METHODS.some((m) => m.id === id)
}

export function getDeliveryMethod(id) {
  return DELIVERY_METHODS.find((m) => m.id === id) || DELIVERY_METHODS[0]
}

export function getPaymentLabel(id) {
  return PAYMENT_METHODS.find((m) => m.id === id)?.label || id
}

export function orderTotals(subtotal, deliveryId) {
  const method = getDeliveryMethod(deliveryId)
  const safeSubtotal = Math.max(0, Number(subtotal) || 0)
  const deliveryCharge = method.charge
  return { subtotal: safeSubtotal, deliveryCharge, total: safeSubtotal + deliveryCharge }
}

/* Demo order number: CLZ-YYYYMMDD-XXXX (date + random suffix). */
export function generateOrderNumber(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let suffix = ''
  for (let i = 0; i < 4; i += 1) {
    suffix += chars[Math.floor(Math.random() * chars.length)]
  }
  return `CLZ-${y}${m}${day}-${suffix}`
}

/* Estimated delivery window as ISO dates (calendar days, demo). */
export function deliveryWindow(placedAt, deliveryId) {
  const method = getDeliveryMethod(deliveryId)
  const base = new Date(placedAt)
  const [from, to] = method.etaDays
  const start = new Date(base)
  start.setDate(start.getDate() + from)
  const end = new Date(base)
  end.setDate(end.getDate() + to)
  return { startISO: start.toISOString(), endISO: end.toISOString(), eta: method.eta }
}

/* Build the persistable order. Card number / CVV / expiry are accepted
   as arguments only so the shape is explicit — they are NEVER stored. */
export function buildSafeOrder({
  items,
  subtotal,
  deliveryId,
  customer,
  shipping,
  paymentId,
}) {
  const method = getDeliveryMethod(deliveryId)
  const totals = orderTotals(subtotal, deliveryId)
  const placedAt = new Date().toISOString()
  return {
    number: generateOrderNumber(new Date(placedAt)),
    placedAt,
    customer: {
      firstName: String(customer.firstName || '').trim(),
      lastName: String(customer.lastName || '').trim(),
      email: String(customer.email || '').trim(),
      phone: String(customer.phone || '').trim(),
    },
    shipping: {
      address: String(shipping.address || '').trim(),
      apartment: String(shipping.apartment || '').trim(),
      city: String(shipping.city || '').trim(),
      state: String(shipping.state || '').trim(),
      pin: String(shipping.pin || '').trim(),
      country: String(shipping.country || '').trim(),
    },
    delivery: {
      id: method.id,
      label: method.label,
      charge: method.charge,
      eta: method.eta,
      window: deliveryWindow(placedAt, method.id),
    },
    payment: { id: paymentId, label: getPaymentLabel(paymentId) },
    items: (items || []).map((l) => ({
      key: l.key,
      productId: l.productId,
      slug: l.slug,
      name: l.name,
      image: l.image || '',
      price: l.price,
      size: l.size || null,
      colour: l.colour || null,
      qty: l.qty,
    })),
    ...totals,
  }
}

export function saveLastOrder(order) {
  try {
    window.localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(order))
    return true
  } catch {
    return false
  }
}

export function loadLastOrder() {
  try {
    const raw = window.localStorage.getItem(LAST_ORDER_KEY)
    if (!raw) return null
    const order = JSON.parse(raw)
    if (!order || typeof order.number !== 'string' || !Array.isArray(order.items)) {
      return null
    }
    return order
  } catch {
    return null
  }
}

export function formatDateLong(iso) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}
