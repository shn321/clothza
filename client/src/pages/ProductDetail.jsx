import { useEffect, useState } from 'react'
import { Check, Heart, Minus, Plus, Star } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import ProductCard from '../components/product/ProductCard.jsx'
import { ProductLoadError } from '../components/product/ProductStates.jsx'
import ReviewsSection from '../components/product/ReviewsSection.jsx'
import { useCart } from '../context/CartContext.jsx'
import { useProducts } from '../context/ProductsContext.jsx'
import { useWishlist } from '../context/WishlistContext.jsx'
import { formatINR } from '../data/home.js'
import { fetchProductBySlug } from '../lib/api.js'

const CATEGORY_LABEL = { men: 'Men', women: 'Women', accessories: 'Accessories' }

function ProductDetail() {
  const { slug } = useParams()
  const { products } = useProducts()
  const [product, setProduct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setNotFound(false)
    setLoadError('')
    fetchProductBySlug(slug, { signal: controller.signal })
      .then((item) => {
        setProduct(item)
        setLoading(false)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setProduct(null)
        if (err?.status === 404) setNotFound(true)
        else setLoadError('Could not load this product. Please check your connection and try again.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [slug, reloadKey])

  const { addItem } = useCart()
  const { isSaved, toggle } = useWishlist()
  const [imageIndex, setImageIndex] = useState(0)
  const [selectedColor, setSelectedColor] = useState(null)
  const [selectedSize, setSelectedSize] = useState(null)
  const [quantity, setQuantity] = useState(1)
  const [added, setAdded] = useState(false)
  const [sizeError, setSizeError] = useState('')

  // Reset selections when navigating between products.
  useEffect(() => {
    setImageIndex(0)
    setSelectedColor(null)
    setSelectedSize(null)
    setQuantity(1)
    setAdded(false)
    setSizeError('')
  }, [slug])

  if (loading) {
    return (
      <main className="bg-ivory text-charcoal">
        <div className="clothza-container py-10 md:py-16">
          <div role="status" aria-label="Loading product" className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="aspect-[3/4] w-full animate-pulse rounded-[4px] border border-linen bg-porcelain" aria-hidden="true" />
            <div className="flex flex-col gap-4" aria-hidden="true">
              <div className="h-4 w-1/3 animate-pulse rounded-[3px] bg-linen" />
              <div className="h-8 w-3/4 animate-pulse rounded-[3px] bg-linen" />
              <div className="h-4 w-1/4 animate-pulse rounded-[3px] bg-linen" />
              <div className="h-20 w-full animate-pulse rounded-[3px] bg-linen" />
              <div className="h-11 w-48 animate-pulse rounded-[3px] bg-linen" />
            </div>
            <span className="sr-only">Loading product…</span>
          </div>
        </div>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="bg-ivory text-charcoal">
        <div className="clothza-container py-16 md:py-24">
          <ProductLoadError
            message={loadError}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        </div>
      </main>
    )
  }

  if (!product || notFound) {
    return (
      <main className="bg-ivory text-charcoal">
        <div className="clothza-container py-16 md:py-24">
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 text-center">
            <p className="type-label">Not found</p>
            <h1 className="type-h2">Product not available.</h1>
            <p className="type-body-muted">
              This piece may have moved. Explore the collection instead.
            </p>
            <Link to="/shop" className="btn btn-secondary mt-2">
              Back to Shop
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const images = product.images?.length ? product.images : []
  const discount =
    product.discountPercentage ??
    (product.originalPrice
      ? Math.round((1 - product.price / product.originalPrice) * 100)
      : 0)
  const categoryPath =
    product.category === 'men'
      ? '/men'
      : product.category === 'women'
        ? '/women'
        : '/shop?category=accessories'
  const related = products.filter(
    (p) => p.category === product.category && p.id !== product.id,
  ).slice(0, 4)
  const maxQty = Math.min(Math.max(product.stock, 1), 10)

  const requiresSize = Array.isArray(product?.sizes) && product.sizes.length > 0
  const saved = isSaved(product.id)

  const handleAdd = () => {
    if (requiresSize && !selectedSize) {
      setSizeError('Please select a size first.')
      return
    }
    addItem(product, { size: selectedSize, colour: selectedColor, qty: quantity })
    setAdded(true)
    window.setTimeout(() => setAdded(false), 2500)
  }

  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container py-10 md:py-16">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-sm text-fog">
            <li>
              <Link to="/" className="transition-colors duration-200 hover:text-charcoal">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link to="/shop" className="transition-colors duration-200 hover:text-charcoal">
                Shop
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link
                to={categoryPath}
                className="transition-colors duration-200 hover:text-charcoal"
              >
                {CATEGORY_LABEL[product.category] || product.category}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-charcoal">
              {product.name}
            </li>
          </ol>
        </nav>

        <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-16">
          {/* Gallery */}
          <div>
            <div className="overflow-hidden rounded-[4px] border border-linen bg-porcelain">
              {images[imageIndex] && (
                <img
                  src={images[imageIndex]}
                  alt={product.name}
                  fetchpriority="high"
                  className="aspect-[3/4] w-full object-cover"
                />
              )}
            </div>
            {images.length > 1 && (
              <div className="mt-4 flex gap-3" role="group" aria-label="Product images">
                {images.map((src, i) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setImageIndex(i)}
                    aria-label={`View image ${i + 1} of ${product.name}`}
                    aria-pressed={imageIndex === i}
                    className={`overflow-hidden rounded-[3px] border bg-porcelain transition-colors duration-200 ${
                      imageIndex === i ? 'border-charcoal' : 'border-linen'
                    }`}
                  >
                    <img src={src} alt="" aria-hidden="true" className="h-20 w-16 object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="flex flex-col">
            <p className="type-label">
              {CATEGORY_LABEL[product.category] || product.category}
              {product.subcategory ? ` · ${product.subcategory}` : ''}
            </p>
            <h1 className="type-h1 mt-2">{product.name}</h1>

            {typeof product.rating === 'number' && (
              <p className="mt-3 flex items-center gap-2 text-sm text-fog">
                <Star size={15} strokeWidth={1.5} aria-hidden="true" fill="currentColor" />
                <span className="font-medium text-charcoal">{product.rating.toFixed(1)}</span>
                <span>({product.reviewCount} reviews)</span>
              </p>
            )}

            <p className="mt-4 flex flex-wrap items-center gap-2">
              <span className="type-price text-xl">{formatINR(product.price)}</span>
              {product.originalPrice && (
                <span className="text-base text-fog line-through">
                  {formatINR(product.originalPrice)}
                </span>
              )}
              {discount > 0 && (
                <span className="rounded-[3px] bg-charcoal px-2 py-1 text-[0.6875rem] font-medium tracking-[0.08em] text-ivory">
                  −{discount}%
                </span>
              )}
              {product.isNewArrival && (
                <span className="rounded-[3px] border border-linen bg-porcelain px-2 py-1 text-[0.6875rem] font-medium tracking-[0.08em] text-charcoal">
                  NEW
                </span>
              )}
              {product.isBestSeller && (
                <span className="rounded-[3px] bg-bronze px-2 py-1 text-[0.6875rem] font-medium tracking-[0.08em] text-ivory">
                  BESTSELLER
                </span>
              )}
            </p>

            <p className="type-body-muted mt-5">{product.description}</p>

            {/* Colors */}
            {Array.isArray(product.colors) && product.colors.length > 0 && (
              <div className="mt-6">
                <p className="field-label" id="pd-color-label">
                  Colour{selectedColor ? ` — ${selectedColor}` : ''}
                </p>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="pd-color-label">
                  {product.colors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSelectedColor(c)}
                      aria-pressed={selectedColor === c}
                      className={`rounded-[3px] border px-3 py-2 text-sm transition-colors duration-200 ${
                        selectedColor === c
                          ? 'border-charcoal bg-charcoal text-ivory'
                          : 'border-linen bg-porcelain text-charcoal hover:border-charcoal'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Sizes */}
            {Array.isArray(product.sizes) && product.sizes.length > 0 && (
              <div className="mt-6">
                <p className="field-label" id="pd-size-label">
                  Size{selectedSize ? ` — ${selectedSize}` : ''}
                </p>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="pd-size-label">
                  {product.sizes.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setSelectedSize(s)
                        setSizeError('')
                      }}
                      aria-pressed={selectedSize === s}
                      className={`min-w-11 rounded-[3px] border px-3 py-2 text-sm transition-colors duration-200 ${
                        selectedSize === s
                          ? 'border-charcoal bg-charcoal text-ivory'
                          : 'border-linen bg-porcelain text-charcoal hover:border-charcoal'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {sizeError && (
                  <p role="alert" className="mt-2 text-sm text-red-800">
                    {sizeError}
                  </p>
                )}
              </div>
            )}

            {/* Quantity + actions */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="inline-flex items-center rounded-[3px] border border-linen bg-porcelain">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  aria-label="Decrease quantity"
                  className="p-3 text-charcoal transition-colors duration-200 hover:bg-charcoal/5 disabled:opacity-40"
                >
                  <Minus size={16} strokeWidth={1.5} aria-hidden="true" />
                </button>
                <span className="min-w-10 text-center text-sm font-medium" aria-live="polite" aria-label={`Quantity ${quantity}`}>
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
                  disabled={quantity >= maxQty}
                  aria-label="Increase quantity"
                  className="p-3 text-charcoal transition-colors duration-200 hover:bg-charcoal/5 disabled:opacity-40"
                >
                  <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                onClick={handleAdd}
                className="btn btn-primary flex-1"
              >
                {added ? (
                  <>
                    <Check size={16} strokeWidth={2} aria-hidden="true" /> Added to Bag
                  </>
                ) : (
                  'Add to Bag'
                )}
              </button>
              <button
                type="button"
                onClick={() => toggle(product.id)}
                aria-label={saved ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
                aria-pressed={saved}
                className="btn btn-secondary"
              >
                <Heart size={16} strokeWidth={1.5} aria-hidden="true" fill={saved ? 'currentColor' : 'none'} />
                {saved ? 'Saved' : 'Wishlist'}
              </button>
            </div>

            {added && (
              <p className="mt-3 text-sm" role="status">
                <span className="text-fog">Added to your bag. </span>
                <Link to="/cart" className="font-medium text-charcoal underline underline-offset-4">
                  View Bag
                </Link>
              </p>
            )}

            <p className="type-small mt-4" role="status">
              {product.stock > 10 ? 'In stock — ready to ship.' : `Low stock — only ${product.stock} left.`}
            </p>

            {/* Details */}
            <hr className="divider my-8" />
            <section aria-label="Product details">
              <h2 className="type-label">Details</h2>
              <dl className="mt-4 flex flex-col gap-3 text-sm">
                <div className="flex justify-between gap-6 border-b border-linen pb-3">
                  <dt className="text-fog">Category</dt>
                  <dd className="text-right font-medium">
                    {CATEGORY_LABEL[product.category] || product.category}
                    {product.subcategory ? ` · ${product.subcategory}` : ''}
                  </dd>
                </div>
                {product.colors?.length > 0 && (
                  <div className="flex justify-between gap-6 border-b border-linen pb-3">
                    <dt className="text-fog">Colours</dt>
                    <dd className="text-right font-medium">{product.colors.join(', ')}</dd>
                  </div>
                )}
                {product.sizes?.length > 0 && (
                  <div className="flex justify-between gap-6 border-b border-linen pb-3">
                    <dt className="text-fog">Sizes</dt>
                    <dd className="text-right font-medium">{product.sizes.join(', ')}</dd>
                  </div>
                )}
                {product.tags?.length > 0 && (
                  <div className="flex justify-between gap-6">
                    <dt className="text-fog">Tags</dt>
                    <dd className="text-right font-medium">{product.tags.join(', ')}</dd>
                  </div>
                )}
              </dl>
            </section>
          </div>
        </div>

        {/* Reviews — approved verified-purchase reviews only. */}
        <ReviewsSection product={product} />

        {/* Related */}
        {related.length > 0 && (
          <section aria-label="You may also like" className="mt-16 md:mt-24">
            <div className="flex items-end justify-between gap-6">
              <h2 className="type-h2">You may also like</h2>
              <Link to="/shop" className="btn btn-secondary">
                View All
              </Link>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-5 md:gap-6 lg:grid-cols-4">
              {related.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

export default ProductDetail
