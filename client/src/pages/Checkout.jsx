import { useEffect, useRef, useState } from 'react'
import { Lock, ShoppingBag } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useNotifications } from '../context/NotificationContext.jsx'
import { formatINR } from '../data/home.js'
import { createOrder, createRazorpayOrder, markRazorpayFailed, toConfirmationOrder, validateCoupon, verifyRazorpayPayment } from '../lib/api.js'
import { loadRazorpayCheckout, openRazorpayCheckout } from '../lib/razorpay.js'
import {
  COUNTRIES,
  DELIVERY_METHODS,
  PAYMENT_METHODS,
  getDeliveryMethod,
  isValidDeliveryMethod,
  isValidPaymentMethod,
  orderTotals,
  saveLastOrder,
  buildSafeOrder,
  validateCardPayment,
  validateCustomer,
  validateShipping,
  validateUpiPayment,
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
  cardName: 'co-cardName',
  cardNumber: 'co-cardNumber',
  expiry: 'co-expiry',
  cvv: 'co-cvv',
  upiId: 'co-upiId',
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
  const [card, setCard] = useState({ cardName: '', cardNumber: '', expiry: '', cvv: '' })
  const [upi, setUpi] = useState({ upiId: '' })
  const [touched, setTouched] = useState({})
  const [submittedOnce, setSubmittedOnce] = useState(false)
  const [formError, setFormError] = useState('')
  const [payStatus, setPayStatus] = useState('')
  const [submitting, setSubmitting] = useState(false)
  /* Step 18 — coupons (authenticated shoppers only; the server recomputes
     the discount at order time, so this display amount is indicative). */
  const [couponInput, setCouponInput] = useState('')
  const [coupon, setCoupon] = useState(null)
  const [couponError, setCouponError] = useState('')
  const [couponApplying, setCouponApplying] = useState(false)
  const placedRef = useRef(false)
  const timerRef = useRef(null)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

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
  const paymentErrors =
    payment === 'card' ? validateCardPayment(card) : payment === 'upi' ? validateUpiPayment(upi) : {}

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

  // Razorpay TEST MODE flow for signed-in shoppers paying online.
  // Guards stay armed while the modal/verification is in flight, so a
  // double-click can never double-charge or double-order. Any failure
  // resets the guards, keeps the bag intact and allows a safe retry.
  async function handleOnlinePayment() {
    const resetForRetry = (message) => {
      placedRef.current = false
      setSubmitting(false)
      setPayStatus('')
      setFormError(message)
    }

    let session
    try {
      setPayStatus('Starting secure payment…')
      session = await createRazorpayOrder({
        deliveryMethod: delivery,
        paymentMethod: payment,
        customer,
        shipping,
        ...(coupon?.coupon?.code ? { couponCode: coupon.coupon.code } : {}),
      })
      await loadRazorpayCheckout()
    } catch (err) {
      resetForRetry(err?.message || 'Could not start online payment. Please try again or use Cash on Delivery.')
      return
    }

    const fullName = `${customer.firstName} ${customer.lastName}`.trim()
    setPayStatus('Waiting for payment…')
    try {
      openRazorpayCheckout({
        keyId: session.keyId,
        amountPaise: session.amountPaise,
        currency: session.currency,
        razorpayOrderId: session.razorpayOrderId,
        prefill: { name: fullName, email: customer.email, contact: customer.phone },
        handlers: {
          onSuccess: async (response) => {
            setPayStatus('Verifying payment…')
            try {
              const order = await verifyRazorpayPayment({
                razorpayOrderId: response?.razorpay_order_id,
                razorpayPaymentId: response?.razorpay_payment_id,
                razorpaySignature: response?.razorpay_signature,
                customer,
                shipping,
              })
              const confirmation = toConfirmationOrder(order)
              if (confirmation) saveLastOrder(confirmation)
              await clearCart()
              refreshNotifications()
              navigate('/order-confirmation')
            } catch (err) {
              resetForRetry(err?.message || 'Payment verification failed. Your bag is saved — please try again.')
            }
          },
          onDismiss: () => {
            markRazorpayFailed(session.razorpayOrderId)
            resetForRetry('Payment was cancelled before completion. Your bag is saved — try again when ready.')
          },
          onError: (gatewayError) => {
            markRazorpayFailed(session.razorpayOrderId)
            const detail = gatewayError?.description ? ` ${gatewayError.description}` : ''
            resetForRetry(`Payment failed.${detail} Your bag is saved — please try again or use Cash on Delivery.`)
          },
        },
      })
    } catch {
      resetForRetry('Could not open the payment window. Please try again or use Cash on Delivery.')
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (submitting || placedRef.current) return
    setSubmittedOnce(true)
    setFormError('')
    setPayStatus('')

    const merged = { ...customerErrors, ...shippingErrors, ...paymentErrors }
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
    if (user) {
      // Online payment (TEST MODE): server creates the gateway order,
      // the Razorpay modal collects sensitive details, and the signed
      // response is verified server-side before any order is created.
      if (payment === 'card' || payment === 'upi') {
        handleOnlinePayment()
        return
      }
      createOrder({
        customer,
        shipping,
        deliveryMethod: delivery,
        paymentMethod: payment,
        ...(coupon?.coupon?.code ? { couponCode: coupon.coupon.code } : {}),
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

    // Guest demo flow — unchanged: local snapshot, local cart clear.
    timerRef.current = window.setTimeout(() => {
      const order = buildSafeOrder({
        items,
        subtotal,
        deliveryId: delivery,
        customer,
        shipping,
        paymentId: payment,
      })
      saveLastOrder(order)
      clearCart()
      navigate('/order-confirmation')
    }, 900)
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
                      className={`flex cursor-pointer items-center gap-3 rounded-[4px] border p-4 transition-colors duration-200 ${
                        active ? 'border-charcoal bg-porcelain' : 'border-linen bg-porcelain hover:border-charcoal'
                      }`}
                    >
                      <input
                        type="radio"
                        name="payment"
                        value={m.id}
                        checked={active}
                        onChange={(e) => setPayment(e.target.value)}
                        className="field-radio"
                      />
                      <span className="text-[0.9375rem] font-medium">{m.label}</span>
                    </label>
                  )
                })}
              </fieldset>

              {payment === 'card' && (
                <div className="mt-4 grid gap-4 rounded-[4px] border border-linen bg-porcelain p-4 sm:grid-cols-2 sm:p-5">
                  <div className="sm:col-span-2">
                    <Field
                      id="co-cardName"
                      name="cardName"
                      label="Cardholder name"
                      type="text"
                      autoComplete="cc-name"
                      placeholder="AARAV SHARMA"
                      value={card.cardName}
                      onChange={setIn(setCard)}
                      onBlur={markTouched}
                      error={paymentErrors.cardName}
                      showError={show('cardName')}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Field
                      id="co-cardNumber"
                      name="cardNumber"
                      label="Card number"
                      type="text"
                      autoComplete="cc-number"
                      inputMode="numeric"
                      placeholder="1234 5678 9012 3456"
                      hint="Demo only — use a test number, never a real card."
                      value={card.cardNumber}
                      onChange={setIn(setCard)}
                      onBlur={markTouched}
                      error={paymentErrors.cardNumber}
                      showError={show('cardNumber')}
                    />
                  </div>
                  <Field
                    id="co-expiry"
                    name="expiry"
                    label="Expiry date"
                    type="text"
                    autoComplete="cc-exp"
                    inputMode="numeric"
                    placeholder="MM/YY"
                    value={card.expiry}
                    onChange={setIn(setCard)}
                    onBlur={markTouched}
                    error={paymentErrors.expiry}
                    showError={show('expiry')}
                  />
                  <Field
                    id="co-cvv"
                    name="cvv"
                    label="CVV"
                    type="password"
                    autoComplete="off"
                    inputMode="numeric"
                    placeholder="123"
                    hint="Demo only — never stored."
                    value={card.cvv}
                    onChange={setIn(setCard)}
                    onBlur={markTouched}
                    error={paymentErrors.cvv}
                    showError={show('cvv')}
                  />
                </div>
              )}

              {payment === 'upi' && (
                <div className="mt-4 rounded-[4px] border border-linen bg-porcelain p-4 sm:p-5">
                  <Field
                    id="co-upiId"
                    name="upiId"
                    label="UPI ID"
                    type="text"
                    autoComplete="off"
                    inputMode="email"
                    placeholder="name@bank"
                    value={upi.upiId}
                    onChange={setIn(setUpi)}
                    onBlur={markTouched}
                    error={paymentErrors.upiId}
                    showError={show('upiId')}
                  />
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
              <button type="submit" disabled={submitting} className="btn btn-primary w-full sm:w-auto sm:min-w-64">
                <Lock size={16} strokeWidth={1.5} aria-hidden="true" />
                {submitting ? 'Placing Your Order…' : `Place Order · ${formatINR(totals.total)}`}
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
              {/* Coupon — authenticated shoppers only; guests keep the
                  unchanged demo flow with a sign-in hint. */}
              <div className="mt-5 border-t border-linen pt-4">
                {user ? (
                  coupon ? (
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
                  )
                ) : (
                  <p className="type-small">
                    Have a coupon?{' '}
                    <Link to="/login" className="font-medium underline underline-offset-2">
                      Sign in
                    </Link>{' '}
                    to apply it at checkout.
                  </p>
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
