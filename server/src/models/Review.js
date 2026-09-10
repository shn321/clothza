import mongoose from 'mongoose'

/* CLOTHZA Review model (Step 17) — product reviews & ratings.
   A review always belongs to one authenticated user, one product and
   the one delivered order that proves the purchase. `verifiedPurchase`
   and `status` are set ONLY by the server — values arriving from the
   client are ignored. New reviews start as `pending`; only `approved`
   reviews feed the product rating aggregation and the public list.
   The compound unique index (user, product, order) guarantees one
   review per user per product per purchase — duplicates 409 instead
   of double-counting. */

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected']
export const MIN_RATING = 1
export const MAX_RATING = 5

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product reference is required'],
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: [true, 'Order reference is required'],
      index: true,
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required'],
      min: [MIN_RATING, 'Rating must be at least 1'],
      max: [MAX_RATING, 'Rating must be at most 5'],
      validate: {
        validator: (v) => Number.isInteger(v),
        message: 'Rating must be a whole number from 1 to 5',
      },
    },
    title: {
      type: String,
      default: '',
      trim: true,
      maxlength: [120, 'Title must be at most 120 characters'],
    },
    comment: {
      type: String,
      required: [true, 'Review comment is required'],
      trim: true,
      minlength: [10, 'Review must be at least 10 characters'],
      maxlength: [2000, 'Review must be at most 2000 characters'],
    },
    /* Server-determined only. True for every review created through the
       verified-purchase flow (the only creation path). */
    verifiedPurchase: { type: Boolean, default: true, index: true },
    status: {
      type: String,
      enum: REVIEW_STATUSES,
      default: 'pending',
      index: true,
    },
  },
  { timestamps: true },
)

/* One review per user per product per purchase. */
reviewSchema.index({ user: 1, product: 1, order: 1 }, { unique: true })
/* Public listing: approved reviews for a product, newest first. */
reviewSchema.index({ product: 1, status: 1, createdAt: -1 })

const Review = mongoose.models.Review || mongoose.model('Review', reviewSchema)

export default Review
