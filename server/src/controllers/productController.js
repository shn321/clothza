import Product from '../models/Product.js'

/* Allowed values — anything else falls back or 400s, never reaches
   MongoDB as an unchecked dynamic query. */

const ALLOWED_GENDERS = ['men', 'women', 'unisex']
const ALLOWED_SORTS = ['newest', 'price-low', 'price-high', 'rating', 'featured']
const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

const SORT_MAP = {
  newest: { isNewArrival: -1, createdAt: -1 },
  'price-low': { price: 1 },
  'price-high': { price: -1 },
  rating: { rating: -1, reviewCount: -1 },
  featured: { isFeatured: -1, isBestSeller: -1, rating: -1 },
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export async function listProducts(req, res, next) {
  try {
    /* Public catalog shows published products only. `{ $ne: false }`
       (rather than `true`) keeps legacy documents that predate the
       isPublished field visible. */
    const filter = { isPublished: { $ne: false } }

    if (req.query.gender !== undefined) {
      const gender = String(req.query.gender).toLowerCase().trim()
      if (!ALLOWED_GENDERS.includes(gender)) {
        return res.status(400).json({
          success: false,
          message: `Invalid gender. Allowed: ${ALLOWED_GENDERS.join(', ')}`,
        })
      }
      filter.gender = gender
    }

    if (req.query.category !== undefined) {
      const category = String(req.query.category).toLowerCase().trim().slice(0, 60)
      if (category) filter.category = category
    }

    if (req.query.subcategory !== undefined) {
      const subcategory = String(req.query.subcategory).trim().slice(0, 60)
      if (subcategory) filter.subcategory = subcategory
    }

    if (req.query.q !== undefined) {
      const term = String(req.query.q).trim().slice(0, 100)
      if (term) {
        const rx = new RegExp(escapeRegExp(term), 'i')
        filter.$or = [
          { name: rx },
          { description: rx },
          { category: rx },
          { subcategory: rx },
          { tags: rx },
        ]
      }
    }

    const sortKey = ALLOWED_SORTS.includes(req.query.sort) ? req.query.sort : 'featured'
    const page = parsePositiveInt(req.query.page, 1)
    const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT)
    const skip = (page - 1) * limit

    const [total, items] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .sort(SORT_MAP[sortKey])
        .skip(skip)
        .limit(limit)
        .lean({ virtuals: true }),
    ])

    res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        pages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function getProductBySlug(req, res, next) {
  try {
    const slug = String(req.params.slug || '').toLowerCase().trim()
    /* Current slug first, then previous slugs so renamed products keep
       their old /product/:slug links working. Unpublished → 404. */
    const product =
      (await Product.findOne({ slug }).lean({ virtuals: true })) ||
      (await Product.findOne({ previousSlugs: slug }).lean({ virtuals: true }))
    if (!product || product.isPublished === false) {
      return res.status(404).json({ success: false, message: 'Product not found' })
    }
    res.status(200).json({ success: true, data: product })
  } catch (err) {
    next(err)
  }
}
