import mongoose from 'mongoose'

/* CLOTHZA Order model (Step 14) — persistent orders for authenticated
   users. Every order item preserves a full snapshot (productId, slug,
   name, image, price, size, colour, qty) so the order stays historically
   correct even if the product document later changes. Totals are ALWAYS
   computed on the server — frontend amounts are never trusted.
   Field spellings (`colour`, `qty`) match the cart/checkout shapes. */

export const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']
export const PAYMENT_METHODS = ['cod', 'upi', 'card']
export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded']
/* Shipped / delivered orders are final and can never be cancelled. */
export const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing']

/* Server-side totals — mirrors the frontend `orderTotals` exactly:
   standard delivery is free, express is a flat charge, and there is
   currently no tax. Step 18 adds server-computed coupon discounts:
   `discount` is ALWAYS derived on the backend from the coupon snapshot
   (never from frontend amounts). Orders without coupons keep
   discount 0, exactly as before. */
export const DELIVERY_CHARGES = { standard: 0, express: 199 }
export const TAX_AMOUNT = 0
export const DISCOUNT_AMOUNT = 0

export function computeTotals(subtotal, deliveryId, discount = 0) {
  const safeSubtotal = Math.max(0, Number(subtotal) || 0)
  const shippingCost = DELIVERY_CHARGES[deliveryId] ?? DELIVERY_CHARGES.standard
  const tax = TAX_AMOUNT
  const safeDiscount = Math.min(Math.max(0, Number(discount) || 0), safeSubtotal)
  const total = safeSubtotal + shippingCost + tax - safeDiscount
  return { subtotal: safeSubtotal, shippingCost, tax, discount: safeDiscount, total }
}

/* Step 18 — coupon snapshot stored on the order at creation time.
   A plain subdocument (no _id): the code, the configured type/value
   and the server-computed amount actually granted. Absent for orders
   placed without a coupon. */
const couponSnapshotSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product reference is required'],
    },
    productId: { type: String, required: [true, 'Product id is required'], trim: true },
    slug: { type: String, required: [true, 'Slug is required'], trim: true, lowercase: true },
    name: { type: String, required: [true, 'Name is required'], trim: true },
    image: { type: String, default: '' },
    price: { type: Number, required: [true, 'Price is required'], min: 0 },
    size: { type: String, default: null, trim: true },
    colour: { type: String, default: null, trim: true },
    qty: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1'],
      validate: {
        validator: (v) => Number.isInteger(v),
        message: 'Quantity must be an integer',
      },
    },
  },
  { _id: false },
)

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true,
    },
    /* Human-readable customer reference — MongoDB _id is never exposed. */
    orderNumber: {
      type: String,
      required: [true, 'Order number is required'],
      unique: true,
      index: true,
      trim: true,
    },
    items: {
      type: [orderItemSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'Order must contain at least one item',
      },
    },
    customer: {
      firstName: { type: String, required: true, trim: true },
      lastName: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      phone: { type: String, required: true, trim: true },
    },
    shippingAddress: {
      address: { type: String, required: true, trim: true },
      apartment: { type: String, default: '', trim: true },
      city: { type: String, required: true, trim: true },
      state: { type: String, required: true, trim: true },
      pin: { type: String, required: true, trim: true },
      country: { type: String, required: true, trim: true },
    },
    deliveryMethod: {
      id: { type: String, enum: ['standard', 'express'], default: 'standard' },
      label: { type: String, default: '' },
      charge: { type: Number, default: 0, min: 0 },
      eta: { type: String, default: '' },
    },
    subtotal: { type: Number, required: true, min: 0 },
    shippingCost: { type: Number, required: true, min: 0 },
    tax: { type: Number, required: true, min: 0, default: 0 },
    discount: { type: Number, required: true, min: 0, default: 0 },
    /* Step 18 coupon snapshot — present only when a coupon was applied
       and validated server-side during order creation. */
    coupon: { type: couponSnapshotSchema, default: undefined },
    total: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    /* No real gateway yet — nothing is ever marked paid in this step. */
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
    /* Step 15 — Razorpay TEST MODE. Card/UPI details never touch this
       model; only gateway references and derived statuses. */
    paymentProvider: {
      type: String,
      enum: ['cod', 'razorpay'],
      default: 'cod',
      index: true,
    },
    /* Step 16 fix: default is `undefined` (field absent) rather than
       `null` — a sparse unique index still indexes explicit nulls, so a
       null default allowed only ONE unpaid/COD order per database
       (E11000 on the second). Absent fields are skipped by the sparse
       index, so any number of non-Razorpay orders can coexist while
       gateway ids stay unique. */
    razorpayOrderId: {
      type: String,
      default: undefined,
      trim: true,
      sparse: true,
      unique: true,
    },
    razorpayPaymentId: { type: String, default: null, trim: true },
    paidAt: { type: Date, default: null },
    orderStatus: { type: String, enum: ORDER_STATUSES, default: 'pending', index: true },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true },
)

/* Newest-first listing per user. */
orderSchema.index({ user: 1, createdAt: -1 })

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema)

export default Order
