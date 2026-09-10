import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ProductCard from '../components/product/ProductCard.jsx'
import { ProductGridSkeleton, ProductLoadError } from '../components/product/ProductStates.jsx'
import { fetchProducts } from '../lib/api.js'

const SORTS = [
  { value: 'featured', label: 'Featured' },
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'rating', label: 'Rating' },
]

function sortProducts(list, sort) {
  const arr = [...list]
  switch (sort) {
    case 'newest':
      return arr.sort((a, b) => Number(b.isNewArrival) - Number(a.isNewArrival))
    case 'price-asc':
      return arr.sort((a, b) => a.price - b.price)
    case 'price-desc':
      return arr.sort((a, b) => b.price - a.price)
    case 'rating':
      return arr.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount)
    case 'featured':
    default: {
      if (!arr.some((p) => p.isFeatured)) {
        return arr.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount)
      }
      return arr.sort(
        (a, b) =>
          Number(b.isFeatured) - Number(a.isFeatured) ||
          Number(b.isBestSeller) - Number(a.isBestSeller) ||
          b.rating - a.rating,
      )
    }
  }
}

function Women() {
  const [women, setWomen] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    fetchProducts({ gender: 'women', limit: 100 }, { signal: controller.signal })
      .then(({ items }) => {
        setWomen(items)
        setLoading(false)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setWomen([])
        setLoadError('Could not load products. Please check your connection and try again.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [reloadKey])

  const subcategories = useMemo(
    () => ['All', ...new Set(women.map((p) => p.subcategory))],
    [women],
  )
  const [sub, setSub] = useState('All')
  const [sort, setSort] = useState('featured')

  const visible = useMemo(() => {
    const filtered = sub === 'All' ? women : women.filter((p) => p.subcategory === sub)
    return sortProducts(filtered, sort)
  }, [women, sub, sort])

  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container py-12 md:py-16">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="type-label">The collection</p>
          <h1 className="type-h1 mt-2">Women</h1>
          <p className="type-body-muted mt-3">
            Fluid silhouettes and considered details for her.
          </p>
        </div>

        {/* Subcategory filter */}
        <nav aria-label="Filter women by style" className="mt-8 flex flex-wrap justify-center gap-2">
          {subcategories.map((s) => {
            const active = sub === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSub(s)}
                aria-pressed={active}
                className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
              >
                {s}
              </button>
            )
          })}
        </nav>

        {/* Toolbar */}
        <div className="mt-8 flex flex-col gap-4 border-y border-linen py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="type-small" role="status" aria-live="polite">
            {visible.length} {visible.length === 1 ? 'product' : 'products'}
          </p>
          <div className="flex items-center gap-3">
            <label htmlFor="women-sort" className="type-label whitespace-nowrap">
              Sort by
            </label>
            <select
              id="women-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="field-select w-full sm:w-auto"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Grid / loading / error / empty state */}
        {loading ? (
          <ProductGridSkeleton count={8} />
        ) : loadError ? (
          <ProductLoadError
            message={loadError}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        ) : visible.length > 0 ? (
          <div className="mt-8 grid grid-cols-2 gap-5 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
            {visible.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-16 text-center">
            <h2 className="type-h3">No products found.</h2>
            <p className="type-body-muted">
              Try a different style or explore the full collection.
            </p>
            <Link to="/shop?category=women" className="btn btn-secondary">
              View All Women&apos;s Products
            </Link>
          </div>
        )}

        {/* Cross-link */}
        <div className="mt-12 text-center">
          <Link to="/shop?category=women" className="btn btn-secondary">
            Shop All Women
          </Link>
        </div>
      </div>
    </main>
  )
}

export default Women
