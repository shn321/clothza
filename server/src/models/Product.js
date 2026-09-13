import mongoose from 'mongoose'

/* CLOTHZA Product model.
   Stored field names match the existing frontend catalog
   (client/src/data/products.js) so the UI can consume the API without
   remapping: category, subcategory, tags, isFeatured, isNewArrival,
   isBestSeller, legacyId (the frontend `id` used by cart/wishlist keys).
   `gender` is stored explicitly for gender filtering (accessories map
   to 'unisex'). Spec-style aliases (featured/newArrival/bestseller)
   are exposed as read-only virtuals. */

const productSchema = new mongoose.Schema(
  {
    legacyId: { type: String, unique: true, sparse: true, trim: true },
    slug: {
      type: String,
      required: [true, 'Slug is required'],
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    name: { type: String, required: [true, 'Name is required'], trim: true },
    description: { type: String, default: '' },
    price: { type: Number, required: [true, 'Price is required'], min: 0 },
    originalPrice: { type: Number, default: null, min: 0 },
    discountPercentage: { type: Number, default: null, min: 0, max: 100 },
    gender: {
      type: String,
      enum: ['men', 'women', 'unisex'],
      default: 'unisex',
      index: true,
    },
    category: { type: String, required: [true, 'Category is required'], trim: true, index: true },
    subcategory: { type: String, default: '', trim: true, index: true },
    images: { type: [String], default: [] },
    colors: { type: [String], default: [] },
    sizes: { type: [String], default: [] },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    tags: { type: [String], default: [] },
    stock: { type: Number, default: 0, min: 0 },
    isFeatured: { type: Boolean, default: false, index: true },
    isNewArrival: { type: Boolean, default: false, index: true },
    isBestSeller: { type: Boolean, default: false, index: true },
    /* Visibility gate (Step 29): unpublished products are hidden from
       every public endpoint but stay in MongoDB with their history.
       Defaults true so the existing catalog stays live; public queries
       use `{ isPublished: { $ne: false } }` so legacy documents without
       the field keep working. */
    isPublished: { type: Boolean, default: true, index: true },
    /* Previous slugs — when an admin renames a slug, the old value is
       kept here (max 10) so existing /product/:slug links keep
       resolving instead of breaking. */
    previousSlugs: { type: [String], default: [] },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
)

/* Read-only aliases for consumers expecting spec-style names. */
productSchema.virtual('featured').get(function () {
  return this.isFeatured
})
productSchema.virtual('newArrival').get(function () {
  return this.isNewArrival
})
productSchema.virtual('bestseller').get(function () {
  return this.isBestSeller
})
productSchema.virtual('badges').get(function () {
  return this.tags
})

/* Full-text search across the customer-facing fields. The public list
   keeps its regex filters; this index exists for efficient keyword
   search as the catalog grows. */
productSchema.index({
  name: 'text',
  description: 'text',
  category: 'text',
  subcategory: 'text',
  tags: 'text',
})

const Product = mongoose.models.Product || mongoose.model('Product', productSchema)

export default Product
