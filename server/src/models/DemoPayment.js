import mongoose from 'mongoose'

/* CLOTHZA simulated demo payments (Step 30) — portfolio only.
   This is NOT a real payment gateway: no Razorpay/Stripe/PayPal, no
   card data, no external calls. The session quotes the SERVER-computed
   total; the simulated frontend "Pay" step only triggers
   POST /api/payments/demo/confirm, where the backend re-validates the
   cart, recomputes totals from MongoDB and creates the paid order.
   Idempotency: pending → processing is an atomic claim, so refresh /
   retry / double-submit can never create two paid orders. Card, UPI,
   PIN, CVV or any secret is never accepted, logged or stored. */

export const DEMO_SESSION_STATUSES = ['pending', 'processing', 'paid', 'failed', 'expired']

const demoItemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, trim: true },
    size: { type: String, default: null, trim: true },
    colour: { type: String, default: null, trim: true },
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false },
)

const demoPaymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true,
    },
    /* Public session id, e.g. DEMO-AB12CD34. Never a gateway id. */
    demoSessionId: {
      type: String,
      required: [true, 'Demo session id is required'],
      unique: true,
      index: true,
      trim: true,
    },
    currency: { type: String, default: 'INR', trim: true, uppercase: true },
    /* Frozen server-computed intent at quote time. Confirm re-reads the
       live cart and requires matching totals — frontend amounts are
       never trusted. */
    items: { type: [demoItemSchema], default: [] },
    subtotal: { type: Number, required: true, min: 0 },
    shippingCost: { type: Number, required: true, min: 0 },
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
    status: { type: String, enum: DEMO_SESSION_STATUSES, default: 'pending', index: true },
    clothzaOrderNumber: { type: String, default: null, trim: true },
    paidAt: { type: Date, default: null },
    failureReason: { type: String, default: '', trim: true },
  },
  { timestamps: true },
)

demoPaymentSchema.index({ user: 1, status: 1, createdAt: -1 })

const DemoPayment =
  mongoose.models.DemoPayment || mongoose.model('DemoPayment', demoPaymentSchema)

export default DemoPayment
