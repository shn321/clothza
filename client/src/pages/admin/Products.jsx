import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  deleteAdminProduct,
  fetchAdminProducts,
  updateAdminProduct,
} from '../../lib/api.js'

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'price-low', label: 'Price: low to high' },
  { value: 'price-high', label: 'Price: high to low' },
  { value: 'rating', label: 'Top rated' },
]

function isLive(p) {
  return p.isPublished !== false
}

function Products() {
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 })
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [gender, setGender] = useState('')
  const [published, setPublished] = useState('all')
  const [stock, setStock] = useState('all')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [refWarning, setRefWarning] = useState(null) // { orderCount, reviewCount }
  const [actionError, setActionError] = useState('')
  const [actionOk, setActionOk] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminProducts({
        q: q.trim() || undefined,
        category: category.trim() || undefined,
        gender: gender || undefined,
        published: published === 'all' ? undefined : published,
        stock: stock === 'all' ? undefined : stock,
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
  }, [q, category, gender, published, stock, sort, page])

  useEffect(() => {
    load()
  }, [load])

  function resetFilters() {
    setQ('')
    setCategory('')
    setGender('')
    setPublished('all')
    setStock('all')
    setSort('newest')
    setPage(1)
  }

  async function handleTogglePublish(p) {
    const id = p._id || p.slug
    setToggling(id)
    setActionError('')
    setActionOk('')
    try {
      await updateAdminProduct(id, { isPublished: !isLive(p) })
      setActionOk(`“${p.name}” is now ${isLive(p) ? 'unpublished (hidden from the store)' : 'published'}.`)
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not update the product.')
    } finally {
      setToggling(null)
    }
  }

  async function handleDelete(force = false) {
    if (!confirmDelete) return
    setDeleting(true)
    setActionError('')
    setActionOk('')
    try {
      await deleteAdminProduct(confirmDelete._id || confirmDelete.slug, { force })
      setConfirmDelete(null)
      setRefWarning(null)
      setActionOk(`“${confirmDelete.name}” deleted.`)
      await load()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Referenced by orders/reviews — show counts and offer unpublish.
        const m = /referenced by (\d+) order\(s\) and (\d+) review\(s\)/.exec(err.message || '')
        setRefWarning({
          orderCount: m ? Number(m[1]) : 0,
          reviewCount: m ? Number(m[2]) : 0,
        })
        setActionError(err.message)
      } else {
        setActionError(err instanceof ApiError ? err.message : 'Could not delete the product.')
      }
    } finally {
      setDeleting(false)
    }
  }

  async function handleUnpublishInstead() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await updateAdminProduct(confirmDelete._id || confirmDelete.slug, { isPublished: false })
      setActionOk(`“${confirmDelete.name}” unpublished instead of deleted — order and review history preserved.`)
      setConfirmDelete(null)
      setRefWarning(null)
      setActionError('')
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not unpublish the product.')
    } finally {
      setDeleting(false)
    }
  }

  function closeDialog() {
    if (deleting) return
    setConfirmDelete(null)
    setRefWarning(null)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="type-h2">Products</h1>
          <p className="type-body-muted mt-1">
            {pagination.total} {pagination.total === 1 ? 'product' : 'products'} · MongoDB is the source of truth
          </p>
        </div>
        <Link to="/admin/products/new" className="btn btn-primary">
          + New product
        </Link>
      </div>

      {/* Filters */}
      <div className="card mt-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_140px_130px_130px_130px_auto]">
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
          <span className="field-label">Published</span>
          <select
            className="field-select"
            value={published}
            onChange={(e) => {
              setPublished(e.target.value)
              setPage(1)
            }}
          >
            <option value="all">All</option>
            <option value="true">Published</option>
            <option value="false">Unpublished</option>
          </select>
        </label>
        <label className="block">
          <span className="field-label">Stock</span>
          <select
            className="field-select"
            value={stock}
            onChange={(e) => {
              setStock(e.target.value)
              setPage(1)
            }}
          >
            <option value="all">All</option>
            <option value="in">In stock</option>
            <option value="low">Low (1–5)</option>
            <option value="out">Out of stock</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <label className="block flex-1 sm:flex-none">
            <span className="field-label">Sort</span>
            <select className="field-select" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
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
      {actionOk && (
        <div className="card mt-4 border-linen bg-cream p-4" role="status">
          <p className="text-sm">{actionOk}</p>
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
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead>
              <tr className="border-b border-linen text-xs uppercase tracking-wider text-fog">
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linen">
              {items.map((p) => {
                const id = p._id || p.slug
                const live = isLive(p)
                const thumb = Array.isArray(p.images) && p.images[0] ? p.images[0] : null
                return (
                  <tr key={id} className={`hover:bg-cream/60 ${live ? '' : 'opacity-70'}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-[3px] border border-linen bg-porcelain">
                          {thumb ? (
                            <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <span className="flex h-full items-center justify-center text-xs text-fog">—</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.name}</p>
                          <p className="type-small truncate">
                            {p.slug} · {p.category}
                            {p.gender ? ` · ${p.gender}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">₹{Number(p.price).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${
                          (p.stock ?? 0) <= 0 || (p.stock ?? 0) <= 5
                            ? 'border-red-800/20 bg-red-800/5 text-red-800'
                            : 'border-linen bg-cream text-charcoal'
                        }`}
                      >
                        {(p.stock ?? 0) <= 0 ? 'Out' : p.stock}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                            live
                              ? 'border-linen bg-cream text-charcoal'
                              : 'border-red-800/20 bg-red-800/5 text-red-800'
                          }`}
                        >
                          {live ? 'Published' : 'Unpublished'}
                        </span>
                        {p.isNewArrival ? (
                          <span className="inline-block rounded-full border border-linen bg-ivory px-2 py-0.5 text-xs text-fog">
                            New
                          </span>
                        ) : null}
                        {p.isBestSeller ? (
                          <span className="inline-block rounded-full border border-linen bg-ivory px-2 py-0.5 text-xs text-fog">
                            Bestseller
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs"
                          disabled={toggling === id}
                          onClick={() => handleTogglePublish(p)}
                          title={live ? 'Hide from the store' : 'Show on the store'}
                        >
                          {toggling === id ? '…' : live ? 'Unpublish' : 'Publish'}
                        </button>
                        <Link
                          to={`/admin/products/${id}/edit`}
                          className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-secondary !min-h-0 border-red-800/20 px-3 py-1.5 text-xs text-red-800 hover:!border-red-800"
                          onClick={() => {
                            setConfirmDelete(p)
                            setRefWarning(null)
                            setActionError('')
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
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
          onClick={closeDialog}
        >
          <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="type-h3">Delete product?</h2>
            <p className="type-body-muted mt-2">
              “{confirmDelete.name}” will be removed from the catalog. Existing orders keep their
              snapshots and are unaffected. This cannot be undone.
            </p>
            {refWarning && (
              <div className="mt-3 rounded-[3px] border border-red-800/20 bg-red-800/5 p-3" role="alert">
                <p className="text-sm text-red-800">
                  Referenced by {refWarning.orderCount} order(s) and {refWarning.reviewCount} review(s).
                  Unpublishing hides it from the store while preserving history — recommended.
                </p>
              </div>
            )}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={deleting}
                onClick={closeDialog}
              >
                Cancel
              </button>
              {refWarning ? (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={deleting}
                    onClick={handleUnpublishInstead}
                  >
                    {deleting ? '…' : 'Unpublish instead'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary !border-red-800 !bg-red-800"
                    disabled={deleting}
                    onClick={() => handleDelete(true)}
                  >
                    {deleting ? 'Deleting…' : 'Delete anyway'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary !border-red-800 !bg-red-800"
                  disabled={deleting}
                  onClick={() => handleDelete(false)}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Products
