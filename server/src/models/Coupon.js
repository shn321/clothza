import mongoose from 'mongoose'

/* CLOTHZA Coupon model (Step 18) — promotions & discount codes.
   The backend is the source of truth: validation, eligibility and the
   discount amount are ALWAYS computed server-side from MongoDB prices.
   Frontend-supplied subtotals, discounts or totals are never trusted.
   `code` is normalized to uppercase (unique). `usedBy` tracks per-user
   consumption ({ user, count }); `usageCount` tracks global consumption
   and is only ever changed through guarded atomic updates. */

export const COUPON_DISCOUNT_TYPES = ['percentage', 'fixed']
export const COUPON_GENDERS = ['men', 'women', 'unisex']

const couponUsageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
    },
    count: { type: Number, required: true, min: 1, default: 1 },
  },
  { _id: false },
)

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Coupon code is required'],
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: [32, 'Coupon code must be at most 32 characters'],
      match: [/^[A-Z0-9_-]+$/, 'Coupon code may contain letters, numbers, hyphens and underscores only'],
      index: true,
    },
    description: { type: String, default: '', trim: true, maxlength: [500, 'Description is too long'] },
    discountType: { type: String, enum: COUPON_DISCOUNT_TYPES, required: [true, 'Discount type is required'] },
    discountValue: { type: Number, required: [true, 'Discount value is required'], min: 0 },
    minimumOrderValue: { type: Number, default: 0, min: [0, 'Minimum order value cannot be negative'] },
    maximumDiscount: { type: Number, default: 0, min: [0, 'Maximum discount cannot be negative'] },
    startDate: { type: Date, required: [true, 'Start date is required'] },
    expiryDate: { type: Date, required: [true, 'Expiry date is required'] },
    /* 0 (or null) = unlimited global redemptions. */
    usageLimit: { type: Number, default: 0, min: [0, 'Usage limit cannot be negative'] },
    usageCount: { type: Number, default: 0, min: 0 },
    perUserLimit: { type: Number, default: 1, min: [1, 'Per-user limit must be at least 1'] },
    usedBy: { type: [couponUsageSchema], default: [] },
    applicableProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    applicableCategories: [{ type: String, trim: true, lowercase: true }],
    applicableGender: [{ type: String, enum: COUPON_GENDERS }],
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
)

couponSchema.index({ isActive: 1, expiryDate: 1 })
couponSchema.index({ isActive: 1, startDate: 1 })

/* Normalize before validation so `welcome10` and `WELCOME10` collide. */
couponSchema.pre('validate', function normalizeCode(next) {
  if (typeof this.code === 'string') {
    this.code = this.code.trim().toUpperCase()
  }
  next()
})

const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema)

export default Coupon
