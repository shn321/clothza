import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { fetchProducts } from '../lib/api.js'

/* Shared API-backed catalog. Fetches the full MongoDB collection once so
   catalog-driven UI (new arrivals, collections counts, wishlist lookup,
   related products, search fallback) reads one production source:
   MongoDB → Express API → React. */

const ProductsContext = createContext(null)

export const CATALOG_ERROR =
  'Could not load the catalogue. Please check your connection and try again.'

export function ProductsProvider({ children }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (signal) => {
    setLoading(true)
    setError('')
    try {
      const { items } = await fetchProducts({ limit: 100 }, { signal })
      setProducts(items)
    } catch (err) {
      if (err?.name === 'AbortError') return
      setError(CATALOG_ERROR)
      setProducts([])
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  const value = useMemo(() => {
    const getBySlug = (slug) => products.find((p) => p.slug === slug || p.id === slug)
    const getByCategory = (category) => products.filter((p) => p.category === category)
    const getNewArrivals = (limit = 4) =>
      products.filter((p) => p.isNewArrival).slice(0, limit)
    const getPopular = (limit = 3) =>
      products.filter((p) => p.isBestSeller).slice(0, limit)
    return {
      products,
      loading,
      error,
      retry: () => load(),
      getBySlug,
      getByCategory,
      getNewArrivals,
      getPopular,
    }
  }, [products, loading, error, load])

  return <ProductsContext.Provider value={value}>{children}</ProductsContext.Provider>
}

export function useProducts() {
  const ctx = useContext(ProductsContext)
  if (!ctx) throw new Error('useProducts must be used inside <ProductsProvider>')
  return ctx
}
