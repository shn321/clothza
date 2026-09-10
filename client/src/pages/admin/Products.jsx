import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, deleteAdminProduct, fetchAdminProducts } from '../../lib/api.js'

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'price-low', label: 'Price: low to high' },
  { value: 'price-high', label: 'Price: high to low' },
  { value: 'rating', label: 'Top rated' },
]

function Products() {
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 })
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [gender, setGender] = useState('')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [actionError, setActionError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminProducts({
        q: q.trim() || undefined,
        category: category.trim() || undefined,
        gender: gender || undefined,
        sort,
        page,
        limit: 20,
      })
      setItems(result.items)
      setPagination(result.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load products.')
    } finally {
      setLoading(false)
    }
  }, [q, category, gender, sort, page])

  useEffect(() => {
    load()
  }, [load])

  function resetFilters() {
    setQ('')
    setCategory('')
    setGender('')
    setSort('newest')
    setPage(1)
  }

  async function handleDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    setActionError('')
    try {
      await deleteAdminProduct(confirmDelete._id || confirmDelete.slug)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not delete the product.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="type-h2">Products</h1>
          <p className="type-body-muted mt-1">
            {pagination.total} {pagination.total === 1 ? 'product' : 'products'}
          </p>
        </div>
        <Link to="/admin/products/new" className="btn btn-primary">
          + New product
        </Link>
      </div>

      {/* Filters */}
      <div className="card mt-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_160px_140px_170px_auto]">
        <label className="block">
          <span className="field-label">Search</span>
          <input
            type="search"
            className="field-input"
            placeholder="Name, slug or tag…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </label>
        <label className="block">
          <span className="field-label">Category</span>
          <input
            type="text"
            className="field-input"
            placeholder="e.g. men"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
              setPage(1)
            }}
          />
        </label>
        <label className="block">
          <span className="field-label">Gender</span>
          <select
            className="field-select"
            value={gender}
            onChange={(e) => {
              setGender(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All</option>
            <option value="men">Men</option>
            <option value="women">Women</option>
            <option value="unisex">Unisex</option>
          </select>
        </label>
        <label className="block">
          <span className="field-label">Sort</span>
          <select className="field-select" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button type="button" className="btn btn-ghost text-sm" onClick={resetFilters}>
            Reset
          </button>
        </div>
      </div>

      {actionError && (
        <div className="card mt-4 border-red-800/20 bg-red-800/5 p-4" role="alert">
          <p className="text-sm text-red-800">{actionError}</p>
        </div>
      )}

      {/* Table */}
      <div className="card mt-4 overflow-x-auto">
        {loading ? (
          <p className="type-body-muted p-6" aria-busy="true">
            Loading products…
          </p>
        ) : error ? (
          <div className="p-6" role="alert">
            <p className="type-body">{error}</p>
            <button type="button" className="btn btn-secondary mt-4" onClick={load}>
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="type-body-muted p-6">No products match these filters.</p>
        ) : (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-linen text-xs uppercase tracking-wider text-fog">
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linen">
              {items.map((p) => (
                <tr key={p._id || p.slug} className="hover:bg-cream/60">
                  <td className="px-4 py-3">
                    <p className="font-medium">{p.name}</p>
                    <p className="type-small truncate">{p.slug}</p>
                  </td>
                  <td className="px-4 py-3 tabular-nums">₹{Number(p.price).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${
                        (p.stock ?? 0) <= 5
                          ? 'border-red-800/20 bg-red-800/5 text-red-800'
                          : 'border-linen bg-cream text-charcoal'
                      }`}
                    >
                      {p.stock ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-fog">
                    {p.category}
                    {p.gender ? ` · ${p.gender}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Link to={`/admin/products/${p._id || p.slug}/edit`} className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs">
                        Edit
                      </Link>
                      <button
                        type="button"
                        className="btn btn-secondary !min-h-0 border-red-800/20 px-3 py-1.5 text-xs text-red-800 hover:!border-red-800"
                        onClick={() => setConfirmDelete(p)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="type-small">
            Page {pagination.page} of {pagination.pages}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs"
              disabled={page <= 1}
              onClick={() => setPage((v) => Math.max(1, v - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs"
              disabled={page >= pagination.pages}
              onClick={() => setPage((v) => v + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm product deletion"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-charcoal/40 p-4"
          onClick={() => {
            if (!deleting) setConfirmDelete(null)
          }}
        >
          <div
            className="card w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="type-h3">Delete product?</h2>
            <p className="type-body-muted mt-2">
              “{confirmDelete.name}” will be removed from the catalog. Existing orders keep their
              snapshots and are unaffected. This cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={deleting}
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary !border-red-800 !bg-red-800"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Products
