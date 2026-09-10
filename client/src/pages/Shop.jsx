import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ProductCard from '../components/product/ProductCard.jsx'
import { ProductGridSkeleton, ProductLoadError } from '../components/product/ProductStates.jsx'
import { fetchProducts } from '../lib/api.js'

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'men', label: 'Men' },
  { value: 'women', label: 'Women' },
  { value: 'accessories', label: 'Accessories' },
]

const SORTS = [
  { value: 'featured', label: 'Featured' },
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'rating', label: 'Rating' },
]

const isValidCategory = (v) => CATEGORIES.some((c) => c.value === v && v !== 'all')
const isValidSort = (v) => SORTS.some((s) => s.value === v)

/* Frontend sort values stay in the URL; the API uses price-low/price-high. */
const toApiSort = (sort) =>
  sort === 'price-asc' ? 'price-low' : sort === 'price-desc' ? 'price-high' : sort

function Shop() {
  const [params, setParams] = useSearchParams()

  const rawCategory = params.get('category') || 'all'
  const rawSort = params.get('sort') || 'featured'
  const category = isValidCategory(rawCategory) ? rawCategory : 'all'
  const sort = isValidSort(rawSort) ? rawSort : 'featured'
  const q = (params.get('q') || '').trim()

  const updateParams = (nextCategory, nextSort, nextQ = q) => {
    const next = {}
    if (nextCategory !== 'all') next.category = nextCategory
    if (nextSort !== 'featured') next.sort = nextSort
    if (String(nextQ || '').trim()) next.q = String(nextQ).trim()
    setParams(next)
  }

  const [visible, setVisible] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    fetchProducts(
      {
        category: category === 'all' ? undefined : category,
        q: q || undefined,
        sort: toApiSort(sort),
        limit: 100,
      },
      { signal: controller.signal },
    )
      .then(({ items, pagination }) => {
        setVisible(items)
        setTotal(pagination.total)
        setLoading(false)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setVisible([])
        setTotal(0)
        setLoadError('Could not load products. Please check your connection and try again.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [category, sort, q, reloadKey])

  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container py-12 md:py-16">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="type-label">The collection</p>
          <h1 className="type-h1 mt-2">Shop</h1>
          <p className="type-body-muted mt-3">Explore the CLOTHZA collection.</p>
        </div>

        {/* Active search query (from navbar search Enter) */}
        {q && (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <p className="type-small" role="status" aria-live="polite">
              Results for &ldquo;{q}&rdquo;
            </p>
            <button
              type="button"
              onClick={() => updateParams(category, sort, '')}
              className="btn btn-secondary"
            >
              Clear search
            </button>
          </div>
        )}

        {/* Category filter */}
        <nav aria-label="Shop by category" className="mt-8 flex flex-wrap justify-center gap-2">
          {CATEGORIES.map((c) => {
            const active = category === c.value
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => updateParams(c.value, sort)}
                aria-pressed={active}
                className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
              >
                {c.label}
              </button>
            )
          })}
        </nav>

        {/* Toolbar */}
        <div className="mt-8 flex flex-col gap-4 border-y border-linen py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="type-small" role="status" aria-live="polite">
            {loading ? 'Loading products…' : `${total} ${total === 1 ? 'product' : 'products'}`}
          </p>
          <div className="flex items-center gap-3">
            <label htmlFor="shop-sort" className="type-label whitespace-nowrap">
              Sort by
            </label>
            <select
              id="shop-sort"
              value={sort}
              onChange={(e) => updateParams(category, e.target.value)}
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
            {q ? (
              <p className="type-body-muted">
                Nothing matches &ldquo;{q}&rdquo;. Try a different name, category
                or keyword.
              </p>
            ) : (
              <p className="type-body-muted">
                Try changing your category or sorting options.
              </p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {q && (
                <button
                  type="button"
                  onClick={() => updateParams(category, sort, '')}
                  className="btn btn-secondary"
                >
                  Clear search
                </button>
              )}
              <Link to="/shop" className="btn btn-secondary">
                View All Products
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

export default Shop
