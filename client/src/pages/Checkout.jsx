import { useEffect, useRef, useState } from 'react'
import { Lock, ShoppingBag } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useNotifications } from '../context/NotificationContext.jsx'
import { formatINR } from '../data/home.js'
import { confirmDemoPayment, createDemoSession, createOrder, failDemoPayment, toConfirmationOrder, validateCoupon } from '../lib/api.js'
import {
  COUNTRIES,
  DELIVERY_METHODS,
  PAYMENT_METHODS,
  getDeliveryMethod,
  isValidDeliveryMethod,
  isValidPaymentMethod,
  orderTotals,
  saveLastOrder,
  validateCustomer,
  validateShipping,
} from '../utils/checkout.js'

const ERROR_TO_ID = {
  firstName: 'co-firstName',
  lastName: 'co-lastName',
  email: 'co-email',
  phone: 'co-phone',
  address: 'co-address',
  city: 'co-city',
  state: 'co-state',
  pin: 'co-pin',
  country: 'co-country',
}

function Field({
  id,
  name,
  label,
  error,
  showError,
  optional = false,
  hint,
  ...inputProps
}) {
  const errorId = `${id}-error`
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}{' '}
        {optional ? (
          <span className="normal-case tracking-normal">(optional)</span>
        ) : (
          <span aria-hidden="true">*</span>
        )}
      </label>
      <input
        id={id}
        name={name}
        required={!optional}
        aria-required={!optional}
        aria-invalid={Boolean(showError && error)}
        aria-describedby={[showError && error ? errorId : null, hintId].filter(Boolean).join(' ') || undefined}
        className="field-input"
        {...inputProps}
      />
      {hint && (
        <p id={hintId} className="type-small mt-1">
          {hint}
        </p>
      )}
      {showError && error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  )
}

function Checkout() {
  const { items, subtotal, clearCart } = useCart()
  const { user } = useAuth()
  const navigate = useNavigate()
  /* Step 19 — refresh the navbar bell after a successful order. */
  const notifications = useNotifications()
  const refreshNotifications = () => notifications?.refresh?.()

  const [customer, setCustomer] = useState({ firstName: '', lastName: '', email: '', phone: '' })
  const [shipping, setShipping] = useState({
    address: '',
    apartment: '',
    city: '',
    state: '',
    pin: '',
    country: 'India',
  })
  const [delivery, setDelivery] = useState('standard')
  const [payment, setPayment] = useState('cod')
  const [touched, setTouched] = useState({})
  const [submittedOnce, setSubmittedOnce] = useState(false)
  const [formError, setFormError] = useState('')
  const [payStatus, setPayStatus] = useState('')
  const [submitting, setSubmitting] = useState(false)
  /* Step 30 — simulated demo online payment. The server quotes the
     payable amount (demoQuote, from MongoDB prices); the "Pay" step is
     a frontend simulation, and the server confirms the paid order.
     demoStage: idle → ready → processing → done. */
  const [demoQuote, setDemoQuote] = useState(null)
  const [demoStage, setDemoStage] = useState('idle')
  const placedRef = useRef(false)
  const demoTimersRef = useRef([])
  /* One idempotency key per checkout attempt — refresh / retry /
     double-submit returns the original order instead of a duplicate. */
  const idempotencyRef = useRef(null)
  /* Step 18 — coupons (authenticated shoppers only; the server recomputes
     the discount at order time, so this display amount is indicative). */
  const [couponInput, setCouponInput] = useState('')
  const [coupon, setCoupon] = useState(null)
  const [couponError, setCouponError] = useState('')
  const [couponApplying, setCouponApplying] = useState(false)

  /* Revalidate the applied coupon when the bag changes so the displayed
     discount never goes stale. A coupon that no longer applies is
     removed with an explanatory message. */
  const appliedCode = coupon?.coupon?.code || ''
  const prevSubtotalRef = useRef(subtotal)
  useEffect(() => {
    if (!appliedCode || !user) {
      prevSubtotalRef.current = subtotal
      return
    }
    if (prevSubtotalRef.current === subtotal) return
    prevSubtotalRef.current = subtotal
    let cancelled = false
    validateCoupon(appliedCode)
      .then((data) => {
        if (!cancelled) {
          setCoupon(data)
          setCouponError('')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCoupon(null)
          setCouponError('The coupon no longer applies to your bag and was removed.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [subtotal, user, appliedCode])

  const setIn = (setter) => (e) => {
    const { name, value } = e.target
    setter((prev) => ({ ...prev, [name]: value }))
  }
  const markTouched = (e) => {
    const { name } = e.target
    setTouched((prev) => (prev[name] ? prev : { ...prev, [name]: true }))
  }
  const show = (name) => touched[name] || submittedOnce

  const customerErrors = validateCustomer(customer)
  const shippingErrors = validateShipping(shipping)

  /* One idempotency key per checkout attempt. A changed bag starts a
     fresh attempt (old quotes/keys are discarded). */
  function getIdempotencyKey() {
    if (!idempotencyRef.current) {
      try {
        idempotencyRef.current =
          window.crypto?.randomUUID?.() || `clz-${Date.now()}-${Math.random().toString(36).slice(2)}`
      } catch {
        idempotencyRef.current = `clz-${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
    }
    return idempotencyRef.current
  }

  const bagFingerprint = items.map((l) => `${l.key}:${l.qty}:${l.price}`).join('|')
  useEffect(() => {
    idempotencyRef.current = null
    setDemoQuote(null)
    setDemoStage('idle')
    /* Intentionally keyed on the derived bag fingerprint only: a changed
       bag starts a fresh checkout attempt. */
  }, [bagFingerprint])

  /* Demo simulation timers are cleaned up on unmount. */
  useEffect(() => {
    const timers = demoTimersRef.current
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  const totals = (() => {
    const base = orderTotals(subtotal, delivery)
    const discount = coupon ? Math.min(Number(coupon.discountAmount) || 0, base.subtotal) : 0
    return { ...base, discount, total: base.total - discount }
  })()
  const couponDiscount = totals.discount || 0
  const deliveryMethod = getDeliveryMethod(delivery)

  async function handleApplyCoupon(e) {
    e?.preventDefault()
    const code = couponInput.trim()
    if (!code || couponApplying) return
    setCouponApplying(true)
    setCouponError('')
    try {
      const data = await validateCoupon(code)
      setCoupon(data)
      setCouponError('')
    } catch (err) {
      setCoupon(null)
      setCouponError(err?.message || 'This coupon could not be applied.')
    } finally {
      setCouponApplying(false)
    }
  }

  function handleRemoveCoupon() {
    setCoupon(null)
    setCouponError('')
    setCouponInput('')
  }

  if (items.length === 0) {
    return (
      <main className="bg-ivory text-charcoal">
        <div className="clothza-container py-16 md:py-24">
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 text-center">
            <ShoppingBag size={28} strokeWidth={1.25} aria-hidden="true" className="text-fog" />
            <p className="type-label">Checkout</p>
            <h1 className="type-h2">Your bag is empty.</h1>
            <p className="type-body-muted">
              There is nothing to check out yet. Discover timeless essentials designed
              for the way you live.
            </p>
            <Link to="/shop" className="btn btn-primary mt-2">
              Back to Shop
            </Link>
          </div>
        </div>
      </main>
    )
  }

  // Simulated demo online payment (Step 30 — portfolio only, no real
  // gateway). Step 1 (here): the server quotes the payable amount from
  // MongoDB prices. Step 2 (handleDemoPay): a short frontend simulation,
  // then the server confirms the paid order. Guards stay armed while a
  // quote/confirmation is in flight, so a double-click can never create
  // two sessions or two orders. Any failure resets the guards, keeps the
  // bag intact and allows a safe retry.
  async function handleDemoQuote() {
    const resetForRetry = (message) => {
      placedRef.current = false
      setSubmitting(false)
      setDemoStage('idle')
      setDemoQuote(null)
      setPayStatus('')
      setFormError(message)
    }

    try {
      setPayStatus('Requesting demo payment amount…')
      const quote = await createDemoSession({
        deliveryMethod: delivery,
        customer,
        shipping,
        ...(coupon?.coupon?.code ? { couponCode: coupon.coupon.code } : {}),
      })
      setDemoQuote(quote)
      setDemoStage('ready')
      setSubmitting(false)
      setPayStatus('')
    } catch (err) {
      resetForRetry(err?.message || 'Could not start the demo payment. Please try again or use Cash on Delivery.')
    }
  }

  // Step 2: simulated "Pay ₹amount (Demo)" → server confirmation.
  function handleDemoPay() {
    if (!demoQuote || demoStage !== 'ready') return
    setDemoStage('processing')
    setFormError('')
    const amountLabel = formatINR(demoQuote.total)
    const steps = [
      'Contacting demo bank…',
      `Authorising ${amountLabel} (simulated)…`,
      'Confirming demo payment…',
    ]
    steps.forEach((message, i) => {
      demoTimersRef.current.push(
        window.setTimeout(() => setPayStatus(message), i * 700),
      )
    })
    demoTimersRef.current.push(
      window.setTimeout(async () => {
        try {
          const order = await confirmDemoPayment({
            demoSessionId: demoQuote.demoSessionId,
            customer,
            shipping,
            idempotencyKey: getIdempotencyKey(),
          })
          const confirmation = toConfirmationOrder(order)
          if (confirmation) saveLastOrder(confirmation)
          await clearCart()
          refreshNotifications()
          setDemoStage('done')
          navigate('/order-confirmation')
        } catch (err) {
          placedRef.current = false
          setSubmitting(false)
          setDemoStage('idle')
          setDemoQuote(null)
          setPayStatus('')
          setFormError(err?.message || 'Demo payment failed. Your bag is saved — please try again.')
        }
      }, steps.length * 700 + 400),
    )
  }

  function handleDemoCancel() {
    if (demoQuote) failDemoPayment(demoQuote.demoSessionId)
    demoTimersRef.current.forEach((t) => window.clearTimeout(t))
    demoTimersRef.current = []
    placedRef.current = false
    setSubmitting(false)
    setDemoQuote(null)
    setDemoStage('idle')
    setPayStatus('')
    setFormError('Demo payment was cancelled before completion. Your bag is saved — try again when ready.')
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (submitting || placedRef.current) return
    setSubmittedOnce(true)
    setFormError('')
    setPayStatus('')

    const merged = { ...customerErrors, ...shippingErrors }
    if (
      Object.keys(merged).length > 0 ||
      !isValidDeliveryMethod(delivery) ||
      !isValidPaymentMethod(payment)
    ) {
      const firstKey = Object.keys(merged)[0]
      const targetId = firstKey ? ERROR_TO_ID[firstKey] : null
      setFormError('Please review the highlighted fields before placing your order.')
      if (targetId) {
        // Focus after errors render.
        window.setTimeout(() => document.getElementById(targetId)?.focus(), 30)
      }
      return
    }

    // Guard against double-clicks / double submits.
    placedRef.current = true
    setSubmitting(true)

    // Authenticated shoppers place a persistent MongoDB order. Totals,
    // prices and stock are validated on the server; the cart is cleared
    // there only after the order exists.
    // Note: this page sits behind <ProtectedRoute>, so `user` is always
    // set here — guests are redirected to /login (cart preserved in
    // localStorage and merged on sign-in) and return here afterwards.
    if (user) {
      // Demo online payment: the server quotes the amount first; the
      // shopper then simulates paying it (handleDemoPay), and the
      // server confirms the paid order. No real gateway is involved.
      if (payment === 'demo_online') {
        handleDemoQuote()
        return
      }
      createOrder({
        customer,
        shipping,
        deliveryMethod: delivery,
        paymentMethod: payment,
        ...(coupon?.coupon?.code ? { couponCode: coupon.coupon.code } : {}),
        idempotencyKey: getIdempotencyKey(),
      })
        .then((order) => {
          const confirmation = toConfirmationOrder(order)
          if (confirmation) saveLastOrder(confirmation)
          return clearCart()
        })
        .then(() => {
          refreshNotifications()
          navigate('/order-confirmation')
        })
        .catch((err) => {
          placedRef.current = false
          setSubmitting(false)
          setFormError(err?.message || 'Could not place your order. Please try again.')
        })
      return
    }
  }

  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container py-12 md:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="type-label">Almost there</p>
          <h1 className="type-h1 mt-2">Checkout</h1>
          <p className="type-body-muted mt-3">
            Secure demo checkout — no real payment is processed.
          </p>
        </div>

        <form noValidate onSubmit={handleSubmit} className="mt-10 grid gap-10 lg:grid-cols-[1fr_22rem] lg:gap-12">
          {/* Form column */}
          <div className="flex min-w-0 flex-col gap-10">
            {/* 1. Customer */}
            <section aria-labelledby="co-customer-heading">
              <h2 id="co-customer-heading" className="type-h3">
                1. Customer information
              </h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field
                  id="co-firstName"
                  name="firstName"
                  label="First name"
                  type="text"
                  autoComplete="given-name"
                  placeholder="Aarav"
                  value={customer.firstName}
                  onChange={setIn(setCustomer)}
                  onBlur={markTouched}
                  error={customerErrors.firstName}
                  showError={show('firstName')}
                />
                <Field
                  id="co-lastName"
                  name="lastName"
                  label="Last name"
                  type="text"
                  autoComplete="family-name"
                  placeholder="Sharma"
                  value={customer.lastName}
                  onChange={setIn(setCustomer)}
                  onBlur={markTouched}
                  error={customerErrors.lastName}
                  showError={show('lastName')}
                />
                <Field
                  id="co-email"
                  name="email"
                  label="Email address"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={customer.email}
                  onChange={setIn(setCustomer)}
                  onBlur={markTouched}
                  error={customerErrors.email}
                  showError={show('email')}
                />
                <Field
                  id="co-phone"
                  name="phone"
                  label="Phone number"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="98765 43210"
                  value={customer.phone}
                  onChange={setIn(setCustomer)}
                  onBlur={markTouched}
                  error={customerErrors.phone}
                  showError={show('phone')}
                />
              </div>
            </section>

            <hr className="divider" />

            {/* 2. Shipping */}
            <section aria-labelledby="co-shipping-heading">
              <h2 id="co-shipping-heading" className="type-h3">
                2. Shipping address
              </h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field
                    id="co-address"
                    name="address"
                    label="Address"
                    type="text"
                    autoComplete="street-address"
                    placeholder="Flat 4B, 12 MG Road"
                    value={shipping.address}
                    onChange={setIn(setShipping)}
                    onBlur={markTouched}
                    error={shippingErrors.address}
                    showError={show('address')}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Field
                    id="co-apartment"
                    name="apartment"
                    label="Apartment / Suite"
                    type="text"
                    autoComplete="address-line2"
                    placeholder="Apartment, suite, floor"
                    optional
                    value={shipping.apartment}
                    onChange={setIn(setShipping)}
                    onBlur={markTouched}
                  />
                </div>
                <Field
                  id="co-city"
                  name="city"
                  label="City"
                  type="text"
                  autoComplete="address-level2"
                  placeholder="Mumbai"
                  value={shipping.city}
                  onChange={setIn(setShipping)}
                  onBlur={markTouched}
                  error={shippingErrors.city}
                  showError={show('city')}
                />
                <Field
                  id="co-state"
                  name="state"
                  label="State"
                  type="text"
                  autoComplete="address-level1"
                  placeholder="Maharashtra"
                  value={shipping.state}
                  onChange={setIn(setShipping)}
                  onBlur={markTouched}
                  error={shippingErrors.state}
                  showError={show('state')}
                />
                <Field
                  id="co-pin"
                  name="pin"
                  label="PIN / ZIP code"
                  type="text"
                  autoComplete="postal-code"
                  inputMode="numeric"
                  placeholder="400001"
                  value={shipping.pin}
                  onChange={setIn(setShipping)}
                  onBlur={markTouched}
                  error={shippingErrors.pin}
                  showError={show('pin')}
                />
                <div>
                  <label htmlFor="co-country" className="field-label">
                    Country <span aria-hidden="true">*</span>
                  </label>
                  <select
                    id="co-country"
                    name="country"
                    required
                    aria-required="true"
                    value={shipping.country}
                    onChange={setIn(setShipping)}
                    onBlur={markTouched}
                    aria-invalid={Boolean(show('country') && shippingErrors.country)}
                    aria-describedby={show('country') && shippingErrors.country ? 'co-country-error' : undefined}
                    className="field-select"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {show('country') && shippingErrors.country && (
                    <p id="co-country-error" role="alert" className="mt-1 text-sm text-red-800">
                      {shippingErrors.country}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <hr className="divider" />

            {/* 3. Delivery */}
            <section aria-labelledby="co-delivery-heading">
              <h2 id="co-delivery-heading" className="type-h3">
                3. Delivery method
              </h2>
              <fieldset className="mt-5 flex flex-col gap-3">
                <legend className="sr-only">Choose a delivery method</legend>
                {DELIVERY_METHODS.map((m) => {
                  const active = delivery === m.id
                  return (
                    <label
                      key={m.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-[4px] border p-4 transition-colors duration-200 ${
                        active ? 'border-charcoal bg-porcelain' : 'border-linen bg-porcelain hover:border-charcoal'
                      }`}
                    >
                      <input
                        type="radio"
                        name="delivery"
                        value={m.id}
                        checked={active}
                        onChange={(e) => setDelivery(e.target.value)}
                        className="field-radio mt-1"
                      />
                      <span className="flex flex-1 flex-col">
                        <span className="flex items-center justify-between gap-3">
                          <span className="text-[0.9375rem] font-medium">{m.label}</span>
                          <span className="type-price">{m.charge === 0 ? 'Free' : formatINR(m.charge)}</span>
                        </span>
                        <span className="type-small mt-1">Estimated delivery: {m.eta}</span>
                      </span>
                    </label>
                  )
                })}
              </fieldset>
            </section>

            <hr className="divider" />

            {/* 4. Payment */}
            <section aria-labelledby="co-payment-heading">
              <h2 id="co-payment-heading" className="type-h3">
                4. Payment method
              </h2>
              <p className="type-small mt-2 rounded-[3px] border border-linen bg-porcelain p-3">
                Demo checkout only — no real payment is processed or stored. Please do
                not enter real card details.
              </p>
              <fieldset className="mt-4 flex flex-col gap-3">
                <legend className="sr-only">Choose a payment method</legend>
                {PAYMENT_METHODS.map((m) => {
                  const active = payment === m.id
                  return (
                    <label
                      key={m.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-[4px] border p-4 transition-colors duration-200 ${
                        active ? 'border-charcoal bg-porcelain' : 'border-linen bg-porcelain hover:border-charcoal'
                      }`}
                    >
                      <input
                        type="radio"
                        name="payment"
                        value={m.id}
                        checked={active}
                        onChange={(e) => setPayment(e.target.value)}
                        className="field-radio mt-1"
                      />
                      <span className="flex flex-1 flex-col">
                        <span className="text-[0.9375rem] font-medium">
                          {m.label}{' '}
                          {m.id === 'demo_online' && (
                            <span className="ml-1 inline-flex items-center rounded-full border border-bronze/40 bg-cream px-2 py-0.5 align-middle text-[11px] font-medium uppercase tracking-wide text-bronze-deep">
                              Demo · Test only
                            </span>
                          )}
                        </span>
                        {m.hint && <span className="type-small mt-1">{m.hint}</span>}
                        {m.id === 'demo_online' && (
                          <span className="type-small mt-1">
                            A simulated payment screen follows — no real gateway, no real charge, no card details.
                          </span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </fieldset>

              {payment === 'demo_online' && demoStage !== 'idle' && demoQuote && (
                <div
                  className="mt-4 rounded-[4px] border border-bronze/40 bg-cream p-4 sm:p-5"
                  role="status"
                  aria-label="Demo payment"
                >
                  <p className="type-label">Demo payment · Test only</p>
                  <p className="type-price mt-2 text-2xl" aria-live="polite">
                    {formatINR(demoQuote.total)}
                  </p>
                  <p className="type-small mt-1">
                    Amount verified with the server — no real money will move.
                  </p>
                  {demoStage === 'ready' && (
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={handleDemoPay}
                        className="btn btn-primary flex-1"
                      >
                        <Lock size={16} strokeWidth={1.5} aria-hidden="true" />
                        Pay {formatINR(demoQuote.total)} (Demo)
                      </button>
                      <button
                        type="button"
                        onClick={handleDemoCancel}
                        className="btn btn-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {demoStage === 'processing' && (
                    <div className="mt-4">
                      <p className="type-small" aria-live="polite">
                        {payStatus || 'Processing demo payment…'}
                      </p>
                      <div
                        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-linen"
                        aria-hidden="true"
                      >
                        <div className="demo-progress h-full rounded-full bg-bronze" />
                      </div>
                      <button
                        type="button"
                        onClick={handleDemoCancel}
                        className="btn btn-secondary mt-3"
                      >
                        Cancel demo payment
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {formError && (
              <p role="alert" className="rounded-[3px] border border-linen bg-porcelain p-3 text-sm text-red-800">
                {formError}
              </p>
            )}
            {payStatus && !formError && (
              <p role="status" className="type-small rounded-[3px] border border-linen bg-porcelain p-3">
                {payStatus}
              </p>
            )}

            <div>
              <button
                type="submit"
                disabled={submitting || (payment === 'demo_online' && demoStage !== 'idle')}
                className="btn btn-primary w-full sm:w-auto sm:min-w-64"
              >
                <Lock size={16} strokeWidth={1.5} aria-hidden="true" />
                {submitting
                  ? payment === 'demo_online'
                    ? 'Requesting Demo Amount…'
                    : 'Placing Your Order…'
                  : payment === 'demo_online' && demoStage === 'idle'
                    ? `Continue to Demo Payment · ${formatINR(totals.total)}`
                    : payment === 'demo_online'
                      ? 'Demo Payment In Progress…'
                      : `Place Order · ${formatINR(totals.total)}`}
              </button>
              <p className="type-small mt-2">
                {deliveryMethod.label} · {deliveryMethod.eta}. Demo checkout — no real
                charge will be made.
              </p>
            </div>
          </div>

          {/* Summary column */}
          <aside
            aria-label="Order summary"
            className="order-first lg:order-none lg:sticky lg:top-28 lg:self-start"
          >
            <div className="rounded-[4px] border border-linen bg-porcelain p-6">
              <h2 className="type-label">Order summary</h2>
              <ul aria-label="Items in your order" className="mt-4 flex max-h-80 flex-col gap-4 overflow-y-auto">
                {items.map((l) => (
                  <li key={l.key} className="flex gap-3">
                    <span className="relative w-14 shrink-0 overflow-hidden rounded-[3px] border border-linen bg-ivory">
                      {l.image && (
                        <img src={l.image} alt="" aria-hidden="true" className="aspect-[3/4] w-full object-cover" />
                      )}
                      <span
                        aria-label={`Quantity ${l.qty}`}
                        className="absolute -right-0 -top-0 flex h-5 min-w-5 items-center justify-center rounded-bl-[3px] bg-charcoal px-1 text-[11px] font-medium leading-none text-ivory"
                      >
                        {l.qty}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{l.name}</span>
                      <span className="type-small">
                        {[l.size ? `Size ${l.size}` : null, l.colour || null].filter(Boolean).join(' · ') || 'One size'}
                      </span>
                      <span className="type-small">Qty {l.qty}</span>
                    </span>
                    <span className="type-price shrink-0 text-sm">{formatINR(l.price * l.qty)}</span>
                  </li>
                ))}
              </ul>
              {/* Coupon — checkout requires sign-in, so every shopper
                  here is authenticated. */}
              <div className="mt-5 border-t border-linen pt-4">
                {coupon ? (
                    <div className="flex items-center justify-between gap-3 rounded-[3px] border border-linen bg-ivory px-3 py-2.5 text-sm">
                      <span>
                        <span className="font-medium">{coupon.coupon.code}</span>{' '}
                        <span className="text-fog">applied · −{formatINR(couponDiscount)}</span>
                      </span>
                      <button
                        type="button"
                        onClick={handleRemoveCoupon}
                        className="font-medium underline underline-offset-2 hover:no-underline"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleApplyCoupon} className="flex flex-col gap-2">
                      <label htmlFor="co-coupon" className="type-small font-medium">
                        Coupon code
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="co-coupon"
                          name="coupon"
                          type="text"
                          autoComplete="off"
                          placeholder="Enter coupon code"
                          value={couponInput}
                          onChange={(e) => setCouponInput(e.target.value)}
                          disabled={couponApplying}
                          aria-invalid={Boolean(couponError)}
                          aria-describedby={couponError ? 'co-coupon-error' : undefined}
                          className="field-input min-w-0 flex-1 uppercase"
                        />
                        <button
                          type="submit"
                          disabled={couponApplying || !couponInput.trim()}
                          className="btn btn-secondary shrink-0"
                        >
                          {couponApplying ? 'Applying…' : 'Apply'}
                        </button>
                      </div>
                      {couponError && (
                        <p id="co-coupon-error" role="alert" className="text-sm text-red-800">
                          {couponError}
                        </p>
                      )}
                    </form>
                  )}
                {couponError && coupon && (
                  <p role="alert" className="mt-2 text-sm text-red-800">
                    {couponError}
                  </p>
                )}
              </div>
              <dl className="mt-5 flex flex-col gap-3 border-t border-linen pt-4 text-sm">
                <div className="flex justify-between gap-6">
                  <dt className="text-fog">Subtotal</dt>
                  <dd className="font-medium">{formatINR(totals.subtotal)}</dd>
                </div>
                {couponDiscount > 0 && coupon && (
                  <div className="flex justify-between gap-6">
                    <dt className="text-fog">Coupon discount ({coupon.coupon.code})</dt>
                    <dd className="font-medium">−{formatINR(couponDiscount)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-6">
                  <dt className="text-fog">Delivery ({deliveryMethod.label})</dt>
                  <dd className="font-medium">
                    {totals.deliveryCharge === 0 ? 'Free' : formatINR(totals.deliveryCharge)}
                  </dd>
                </div>
                <div className="flex justify-between gap-6 border-t border-linen pt-3">
                  <dt className="font-medium">Total</dt>
                  <dd className="type-price text-lg" aria-live="polite">{formatINR(totals.total)}</dd>
                </div>
              </dl>
            </div>
          </aside>
        </form>
      </div>
    </main>
  )
}

export default Checkout
