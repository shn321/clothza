import mongoose from 'mongoose'

/* CLOTHZA Wishlist model (Step 13) — one wishlist per user for
   authenticated shoppers. Guests keep using localStorage.
   Products are stored as Product references (no duplicates); the API
   maps them back to the frontend ids (legacyId || slug) so the existing
   wishlist UI — which resolves ids against the catalog — works unchanged. */

const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      unique: true,
      index: true,
    },
    products: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
      default: [],
      validate: {
        validator: (arr) => {
          const seen = new Set(arr.map((id) => String(id)))
          return seen.size === arr.length
        },
        message: 'Wishlist must not contain duplicate products',
      },
    },
  },
  { timestamps: true },
)

const Wishlist = mongoose.models.Wishlist || mongoose.model('Wishlist', wishlistSchema)

export default Wishlist
