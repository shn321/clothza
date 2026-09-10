import mongoose from 'mongoose'

/* CLOTHZA PaymentAttempt model (Step 15) — Razorpay TEST MODE.
   One record per gateway order created, owned by exactly one user.
   Purpose: idempotency. A refresh, retry, double-submit, webhook replay
   or duplicate verify can never create two paid CLOTHZA orders, because
   the attempt transitions pending → processing atomically and only one
   completion path can win. The CLOTHZA order itself is created only
   AFTER a verified payment, carrying the gateway references.
   No card, UPI, PIN or secret data is ever stored here. */

export const ATTEMPT_STATUSES = ['pending', 'processing', 'paid', 'failed', 'expired']

const attemptItemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, trim: true },
    size: { type: String, default: null, trim: true },
    colour: { type: String, default: null, trim: true },
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false },
)

const paymentAttemptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true,
    },
    razorpayOrderId: {
      type: String,
      required: [true, 'Razorpay order id is required'],
      unique: true,
      index: true,
      trim: true,
    },
    receipt: { type: String, default: '', trim: true },
    amountPaise: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'INR', trim: true, uppercase: true },
    /* Frozen cart intent at gateway-order time (for completion + audit).
       Live verification re-reads the cart and requires matching totals. */
    items: { type: [attemptItemSchema], default: [] },
    subtotal: { type: Number, required: true, min: 0 },
    shippingCost: { type: Number, required: true, min: 0 },
    /* Step 18 — server-computed coupon discount frozen with the payment
       intent. The gateway amount always reflects subtotal − discount. */
    discount: { type: Number, default: 0, min: 0 },
    couponCode: { type: String, default: null, trim: true, uppercase: true },
    couponSnapshot: {
      code: { type: String, default: null, trim: true, uppercase: true },
      discountType: { type: String, enum: ['percentage', 'fixed'], default: null },
      discountValue: { type: Number, default: null, min: 0 },
      discountAmount: { type: Number, default: null, min: 0 },
    },
    total: { type: Number, required: true, min: 0 },
    deliveryMethod: { type: String, enum: ['standard', 'express'], default: 'standard' },
    paymentMethod: { type: String, enum: ['card', 'upi'], required: true },
    /* Checkout contact details captured at gateway-order time so the
       server-to-server webhook can complete the order identically to
       the verify path. Validated with the same shared rules. */
    customer: {
      firstName: { type: String, default: '', trim: true },
      lastName: { type: String, default: '', trim: true },
      email: { type: String, default: '', trim: true, lowercase: true },
      phone: { type: String, default: '', trim: true },
    },
    shippingAddress: {
      address: { type: String, default: '', trim: true },
      apartment: { type: String, default: '', trim: true },
      city: { type: String, default: '', trim: true },
      state: { type: String, default: '', trim: true },
      pin: { type: String, default: '', trim: true },
      country: { type: String, default: '', trim: true },
    },
    status: { type: String, enum: ATTEMPT_STATUSES, default: 'pending', index: true },
    clothzaOrderNumber: { type: String, default: null, trim: true },
    razorpayPaymentId: { type: String, default: null, trim: true },
    paidAt: { type: Date, default: null },
    failureReason: { type: String, default: '', trim: true },
  },
  { timestamps: true },
)

paymentAttemptSchema.index({ user: 1, status: 1, createdAt: -1 })

const PaymentAttempt =
  mongoose.models.PaymentAttempt || mongoose.model('PaymentAttempt', paymentAttemptSchema)

export default PaymentAttempt
