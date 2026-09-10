import mongoose from 'mongoose'

/* CLOTHZA Cart model (Step 13) — one cart per user, database-backed for
   authenticated shoppers. Guests keep using localStorage; nothing here
   affects them.
   Each line stores a Product reference PLUS a snapshot (productId, slug,
   name, image, price) so the existing UI and checkout keep working even
   if the product document later changes. Price is ALWAYS re-read from
   the Product collection on write — frontend prices are never trusted.
   Line identity = productId + size + colour (same rule as the frontend).
   Field spellings (`colour`, `qty`) match the frontend cart shape so the
   API response needs no remapping in checkout. */

export const MAX_QTY_PER_LINE = 10

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product reference is required'],
    },
    /* Frontend line identity: legacyId (or slug fallback). */
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
  { _id: true },
)

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      unique: true,
      index: true,
    },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true },
)

/* Line key shared with the frontend (`productId|size|colour`). */
export function cartLineKey(productId, size, colour) {
  return `${productId}|${size || ''}|${colour || ''}`
}

/* Max units allowed on one line, mirroring the frontend cap:
   min(max(stock, 1), 10) — stock-limited where known, never above 10. */
export function maxQtyForStock(stock) {
  const s = Number(stock)
  const base = Number.isFinite(s) && s > 0 ? s : MAX_QTY_PER_LINE
  return Math.min(Math.max(Math.floor(base), 1), MAX_QTY_PER_LINE)
}

const Cart = mongoose.models.Cart || mongoose.model('Cart', cartSchema)

export default Cart
