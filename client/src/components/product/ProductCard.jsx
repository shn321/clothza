import { Heart } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatINR } from '../../data/home.js'
import { useWishlist } from '../../context/WishlistContext.jsx'

/* Reusable product card — field shape mirrors the future Mongoose
   Product document (see src/data/products.js). Supports the full
   catalog shape; falls back to legacy { image, alt } demo shape. */

const CATEGORY_LABEL = { men: 'Men', women: 'Women', accessories: 'Accessories' }

function ProductCard({ product }) {
  const { isSaved, toggle } = useWishlist()
  const saved = isSaved(product.id)
  const image = product.images?.[0] || product.image
  const alt = product.alt || product.name
  const discount =
    product.discountPercentage ??
    (product.originalPrice
      ? Math.round((1 - product.price / product.originalPrice) * 100)
      : 0)
  const categoryLabel = product.category
    ? `${CATEGORY_LABEL[product.category] || product.category}${
        product.subcategory ? ` · ${product.subcategory}` : ''
      }`
    : null

  const productUrl = `/product/${product.slug || product.id}`

  return (
    <article className="group flex flex-col">
      <div className="relative overflow-hidden rounded-[4px] border border-linen bg-porcelain">
        <Link
          to={productUrl}
          aria-label={`View ${product.name}`}
          className="block aspect-[3/4] w-full"
        >
          <img
            src={image}
            alt={alt}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />
        </Link>
        <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
          {discount > 0 && (
            <span className="rounded-[3px] bg-charcoal px-2 py-1 text-[0.6875rem] font-medium tracking-[0.08em] text-ivory">
              −{discount}%
            </span>
          )}
          {product.isNewArrival && (
            <span className="rounded-[3px] bg-ivory/90 px-2 py-1 text-[0.6875rem] font-medium tracking-[0.08em] text-charcoal backdrop-blur">
              NEW
            </span>
          )}
          {product.isBestSeller && (
            <span className="rounded-[3px] bg-bronze px-2 py-1 text-[0.6875rem] font-medium tracking-[0.08em] text-ivory">
              BESTSELLER
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => toggle(product.id)}
          aria-label={saved ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
          aria-pressed={saved}
          className="absolute right-3 top-3 inline-flex items-center justify-center rounded-[3px] bg-ivory/90 p-2 text-charcoal backdrop-blur transition-colors duration-200 hover:bg-ivory"
        >
          <Heart
            size={17}
            strokeWidth={1.5}
            aria-hidden="true"
            fill={saved ? 'currentColor' : 'none'}
          />
        </button>
      </div>

      <div className="flex flex-col gap-1 pt-4 text-center">
        {categoryLabel && <p className="type-small">{categoryLabel}</p>}
        <h3 className="text-[0.9375rem] font-medium leading-6 text-charcoal">
          <Link to={productUrl} className="transition-colors duration-200 hover:text-bronze-deep">
            {product.name}
          </Link>
        </h3>
        <p className="type-price">
          {formatINR(product.price)}{' '}
          {product.originalPrice && (
            <span className="ml-1 font-normal text-fog line-through">
              {formatINR(product.originalPrice)}
            </span>
          )}
        </p>
      </div>
    </article>
  )
}

export default ProductCard
