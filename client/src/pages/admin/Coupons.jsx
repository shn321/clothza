import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, deleteAdminCoupon, fetchAdminCoupons, updateAdminCoupon } from '../../lib/api.js'
import { formatINR } from '../../data/home.js'

function discountLabel(c) {
  if (c.discountType === 'percentage') return `${c.discountValue}%`
  return formatINR(c.discountValue)
}

function Coupons() {
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 })
  const [q, setQ] = useState('')
  const [active, setActive] = useState('')
  const [expired, setExpired] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminCoupons({
        q: q.trim() || undefined,
        active: active || undefined,
        expired: expired || undefined,
        page,
        limit: 20,
      })
      setItems(result.coupons)
      setPagination(result.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load coupons.')
    } finally {
      setLoading(false)
    }
  }, [q, active, expired, page])

  useEffect(() => {
    load()
  }, [load])

  function resetFilters() {
    setQ('')
    setActive('')
    setExpired('')
    setPage(1)
  }

  async function handleToggle(c) {
    setToggling(c.id)
    setActionError('')
    try {
      await updateAdminCoupon(c.id, { isActive: !c.isActive })
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not update the coupon.')
    } finally {
      setToggling(null)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    setActionError('')
    try {
      await deleteAdminCoupon(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not delete the coupon.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="type-h2">Coupons</h1>
          <p className="type-body-muted mt-1">
            {pagination.total} {pagination.total === 1 ? 'coupon' : 'coupons'}
          </p>
        </div>
        <Link to="/admin/coupons/new" className="btn btn-primary">
          + New coupon
        </Link>
      </div>

      {/* Filters */}
      <div className="card mt-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_160px_160px_auto]">
        <label className="block">
          <span className="field-label">Search</span>
          <input
            type="search"
            className="field-input"
            placeholder="Code or description…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </label>
        <label className="block">
          <span className="field-label">Status</span>
          <select
            className="field-select"
            value={active}
            onChange={(e) => {
              setActive(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
        <label className="block">
          <span className="field-label">Expiry</span>
          <select
            className="field-select"
            value={expired}
            onChange={(e) => {
              setExpired(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All</option>
            <option value="true">Expired</option>
            <option value="false">Not expired</option>
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
            Loading coupons…
          </p>
        ) : error ? (
          <div className="p-6" role="alert">
            <p className="type-body">{error}</p>
            <button type="button" className="btn btn-secondary mt-4" onClick={load}>
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="type-body-muted p-6">No coupons match these filters.</p>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-linen text-xs uppercase tracking-wider text-fog">
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Discount</th>
                <th className="px-4 py-3 font-medium">Usage</th>
                <th className="px-4 py-3 font-medium">Validity</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linen">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-cream/60">
                  <td className="px-4 py-3">
                    <p className="font-medium">{c.code}</p>
                    {c.description && <p className="type-small truncate">{c.description}</p>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {discountLabel(c)}
                    {c.minimumOrderValue > 0 && (
                      <span className="type-small block">min {formatINR(c.minimumOrderValue)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {c.usageCount}{c.usageLimit > 0 ? ` / ${c.usageLimit}` : ' · ∞'}
                  </td>
                  <td className="px-4 py-3 text-fog">
                    {c.startDate ? new Date(c.startDate).toLocaleDateString('en-IN') : '—'}
                    {' → '}
                    {c.expiryDate ? new Date(c.expiryDate).toLocaleDateString('en-IN') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                        c.isActive && !c.expired
                          ? 'border-linen bg-cream text-charcoal'
                          : 'border-red-800/20 bg-red-800/5 text-red-800'
                      }`}
                    >
                      {c.expired ? 'Expired' : c.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs"
                        disabled={toggling === c.id}
                        onClick={() => handleToggle(c)}
                      >
                        {toggling === c.id ? '…' : c.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <Link
                        to={`/admin/coupons/${c.id}/edit`}
                        className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs"
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        className="btn btn-secondary !min-h-0 border-red-800/20 px-3 py-1.5 text-xs text-red-800 hover:!border-red-800"
                        onClick={() => setConfirmDelete(c)}
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
          aria-label="Confirm coupon deletion"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-charcoal/40 p-4"
          onClick={() => {
            if (!deleting) setConfirmDelete(null)
          }}
        >
          <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="type-h3">Delete coupon?</h2>
            <p className="type-body-muted mt-2">
              “{confirmDelete.code}” will be removed. Existing orders keep their snapshots and are
              unaffected. This cannot be undone.
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

export default Coupons
