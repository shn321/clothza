import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowRight, Search, SearchX, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useProducts } from '../../context/ProductsContext.jsx'
import { formatINR } from '../../data/home.js'
import { fetchProducts } from '../../lib/api.js'
import {
  POPULAR_SEARCHES,
  getCategoryLabel,
  getPopularProducts,
  resolveSearchNavigation,
  searchProducts,
} from '../../utils/search.js'

const RESULT_LIMIT = 7

function ResultRow({ product, active, onSelect, id }) {
  const image = product.images?.[0]
  const categoryLabel = getCategoryLabel(product.category)
  return (
    <li role="option" aria-selected={active} id={id}>
      <Link
        to={`/product/${product.slug || product.id}`}
        onClick={onSelect}
        aria-label={`View ${product.name}`}
        className={`flex items-center gap-3 rounded-[3px] border p-2.5 text-left transition-colors duration-150 sm:gap-4 sm:p-3 ${
          active
            ? 'border-charcoal bg-cream'
            : 'border-transparent hover:border-linen hover:bg-cream'
        }`}
      >
        <span className="h-16 w-12 shrink-0 overflow-hidden rounded-[3px] border border-linen bg-porcelain sm:h-20 sm:w-16">
          {image ? (
            <img
              src={image}
              alt=""
              aria-hidden="true"
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-fog">
              <Search size={18} strokeWidth={1.5} aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[0.9375rem] font-medium leading-6 text-charcoal">
            {product.name}
          </span>
          <span className="type-small mt-0.5 truncate">
            {categoryLabel}
            {product.subcategory ? ` · ${product.subcategory}` : ''}
          </span>
          <span className="type-price mt-1">
            {formatINR(product.price)}{' '}
            {product.originalPrice && (
              <span className="ml-1 text-sm font-normal text-fog line-through">
                {formatINR(product.originalPrice)}
              </span>
            )}
          </span>
        </span>
        <ArrowRight
          size={18}
          strokeWidth={1.5}
          aria-hidden="true"
          className="shrink-0 text-fog"
        />
      </Link>
    </li>
  )
}

function SearchOverlay({ open, onClose }) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [results, setResults] = useState([])
  const [resultsQuery, setResultsQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const inputRef = useRef(null)
  const panelRef = useRef(null)
  const navigate = useNavigate()
  const listboxId = useId()
  const { products: catalog, getPopular } = useProducts()
  const trimmed = query.trim()

  const popular = useMemo(() => {
    const fromCatalog = getPopularProducts(3, catalog)
    return fromCatalog.length > 0 ? fromCatalog : getPopular(3)
  }, [catalog, getPopular])
  const showEmptyState = resultsQuery.length > 0 && !searching && results.length === 0

  // Reset state each time the overlay opens; autofocus the input.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(-1)
    setResults([])
    setResultsQuery('')
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [open ])

  // Escape to close + body scroll lock.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  useEffect(() => {
    setActiveIndex(-1)
  }, [results])

  // Debounced MongoDB-backed search. Previous results stay visible while
  // the next query resolves; if the API is unreachable, fall back to
  // client-side scoring over the cached API catalog.
  useEffect(() => {
    if (!open) return
    if (!trimmed) {
      setResults([])
      setResultsQuery('')
      setSearching(false)
      return undefined
    }
    setSearching(true)
    const controller = new AbortController()
    const t = window.setTimeout(() => {
      fetchProducts({ q: trimmed, limit: RESULT_LIMIT }, { signal: controller.signal })
        .then(({ items }) => {
          setResults(items)
          setResultsQuery(trimmed)
          setSearching(false)
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return
          setResults(searchProducts(trimmed, catalog, RESULT_LIMIT))
          setResultsQuery(trimmed)
          setSearching(false)
        })
    }, 180)
    return () => {
      window.clearTimeout(t)
      controller.abort()
    }
  }, [trimmed, open, catalog])

  if (!open) return null

  const clearSearch = () => {
    setQuery('')
    setActiveIndex(-1)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && results[activeIndex]) {
        // Keyboard users can jump straight to the highlighted product.
        const target = results[activeIndex]
        onClose()
        navigate(`/product/${target.slug || target.id}`)
      } else if (trimmed) {
        // Submit the query: exact keywords go to their page, everything
        // else opens the Shop results page with ?q= preserved.
        const to = resolveSearchNavigation(trimmed)
        if (to) {
          onClose()
          navigate(to)
        }
      }
    }
  }

  const handleBackdropClick = (e) => {
    if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto px-4 pb-8 pt-4 sm:pt-10"
      role="dialog"
      aria-modal="true"
      aria-label="Search products"
      onMouseDown={handleBackdropClick}
    >
      {/* Backdrop */}
      <div aria-hidden="true" className="fixed inset-0 bg-charcoal/30" />

      {/* Panel */}
      <div
        ref={panelRef}
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[4px] border border-linen bg-ivory shadow-[0_8px_30px_rgba(28,27,26,0.12)] sm:max-h-[calc(100dvh-5rem)]"
      >
        {/* Search field row */}
        <div className="flex items-center gap-2 border-b border-linen bg-ivory px-4 py-3 sm:px-5">
          <Search size={20} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-fog" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search products, categories, keywords…"
            aria-label="Search products"
            aria-expanded={results.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={
              activeIndex >= 0 && results[activeIndex]
                ? `search-result-${results[activeIndex].id}`
                : undefined
            }
            role="combobox"
            aria-autocomplete="list"
            autoComplete="off"
            className="h-11 w-full bg-transparent text-[0.9375rem] text-charcoal placeholder:text-[#a8a29a] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="inline-flex shrink-0 items-center justify-center rounded-[3px] p-2 text-charcoal transition-colors duration-200 hover:bg-charcoal/5"
            >
              <X size={18} strokeWidth={1.5} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="hidden shrink-0 items-center justify-center rounded-[3px] border border-linen bg-porcelain px-3 py-2 text-sm text-charcoal transition-colors duration-200 hover:border-charcoal sm:inline-flex"
          >
            Esc
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="inline-flex shrink-0 items-center justify-center rounded-[3px] p-2 text-charcoal transition-colors duration-200 hover:bg-charcoal/5 sm:hidden"
          >
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          {trimmed.length === 0 ? (
            <div>
              <p className="type-label">Popular right now</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {POPULAR_SEARCHES.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => {
                      setQuery(term)
                      inputRef.current?.focus()
                    }}
                    className="rounded-[3px] border border-linen bg-porcelain px-3 py-2 text-sm text-charcoal transition-colors duration-200 hover:border-charcoal"
                  >
                    {term}
                  </button>
                ))}
              </div>
              <ul className="mt-5 flex flex-col gap-2" aria-label="Popular products">
                {popular.map((p) => (
                  <ResultRow key={p.id} product={p} active={false} onSelect={onClose} />
                ))}
              </ul>
            </div>
          ) : showEmptyState ? (
            <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-3 py-10 text-center sm:py-12">
              <span className="inline-flex items-center justify-center rounded-[4px] border border-linen bg-porcelain p-3 text-fog">
                <SearchX size={22} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <h2 className="type-h3">No products found.</h2>
              <p className="type-body-muted">
                Nothing matches &ldquo;{resultsQuery}&rdquo;. Try a different name,
                category or keyword.
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={clearSearch} className="btn btn-secondary">
                  Clear search
                </button>
                <Link to="/shop" onClick={onClose} className="btn btn-primary">
                  Browse Shop
                </Link>
              </div>
            </div>
          ) : (
            <div>
              <p className="type-small" role="status" aria-live="polite">
                {results.length} {results.length === 1 ? 'result' : 'results'} for
                &ldquo;{resultsQuery}&rdquo;
              </p>
              <ul
                id={listboxId}
                role="listbox"
                aria-label="Product results"
                aria-busy={searching}
                className="mt-3 flex flex-col gap-2"
              >
                {results.map((p, i) => (
                  <ResultRow
                    key={p.id}
                    product={p}
                    id={`search-result-${p.id}`}
                    active={i === activeIndex}
                    onSelect={onClose}
                  />
                ))}
              </ul>
              <p className="type-small mt-4 hidden sm:block">
                Press Esc to close · ↑↓ to navigate · Enter to search
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SearchOverlay
