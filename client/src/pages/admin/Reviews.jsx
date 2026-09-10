import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, deleteAdminReview, fetchAdminReviews, updateAdminReviewStatus } from '../../lib/api.js'

const STATUSES = ['', 'pending', 'approved', 'rejected']
const RATINGS = ['', '5', '4', '3', '2', '1']

const STATUS_STYLES = {
  pending: 'border-bronze/40 bg-cream text-bronze-deep',
  approved: 'border-green-700/30 bg-green-700/5 text-green-800',
  rejected: 'border-red-800/20 bg-red-800/5 text-red-800',
}

function Stars({ value }) {
  return (
    <span className="inline-flex text-sm tabular-nums" aria-label={`${value} out of 5 stars`}>
      {'★'.repeat(value)}
      <span className="text-linen">{'★'.repeat(5 - value)}</span>
    </span>
  )
}

function Reviews() {
  const [reviews, setReviews] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 })
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [rating, setRating] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminReviews({
        q: q.trim() || undefined,
        status: status || undefined,
        rating: rating || undefined,
        page,
        limit: 20,
      })
      setReviews(result.reviews)
      setPagination(result.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load reviews.')
    } finally {
      setLoading(false)
    }
  }, [q, status, rating, page])

  useEffect(() => {
    load()
  }, [load])

  function resetFilters() {
    setQ('')
    setStatus('')
    setRating('')
    setPage(1)
  }

  async function handleStatus(id, nextStatus) {
    setBusyId(id)
    setNotice('')
    setError('')
    try {
      await updateAdminReviewStatus(id, nextStatus)
      setNotice(`Review ${nextStatus}.`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the review.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id) {
    setBusyId(id)
    setNotice('')
    setError('')
    try {
      await deleteAdminReview(id)
      setConfirmDeleteId(null)
      setNotice('Review deleted.')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the review.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <h1 className="type-h2">Reviews</h1>
      <p className="type-body-muted mt-1">
        {pagination.total} {pagination.total === 1 ? 'review' : 'reviews'}
      </p>

      {notice && (
        <div className="card mt-4 border-green-700/30 bg-green-700/5 p-4" role="status">
          <p className="text-sm text-green-800">{notice}</p>
        </div>
      )}
      {error && (
        <div className="card mt-4 border-red-800/20 bg-red-800/5 p-4" role="alert">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Filters */}
      <div className="card mt-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_160px_130px_auto]">
        <label className="block">
          <span className="field-label">Search</span>
          <input
            type="search"
            className="field-input"
            placeholder="Title, comment, order or reviewer…"
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
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === '' ? 'All statuses' : s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Rating</span>
          <select
            className="field-select"
            value={rating}
            onChange={(e) => {
              setRating(e.target.value)
              setPage(1)
            }}
          >
            {RATINGS.map((r) => (
              <option key={r} value={r}>
                {r === '' ? 'All ratings' : `${r} star${r === '1' ? '' : 's'}`}
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

      {/* Table */}
      <div className="card mt-4 overflow-x-auto">
        {loading ? (
          <p className="type-body-muted p-6" aria-busy="true">
            Loading reviews…
          </p>
        ) : reviews.length === 0 ? (
          <p className="type-body-muted p-6">No reviews match these filters.</p>
        ) : (
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-linen text-xs uppercase tracking-wider text-fog">
                <th className="px-4 py-3 font-medium">Review</th>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Reviewer</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linen">
              {reviews.map((r) => (
                <tr key={r.id} className="align-top hover:bg-cream/60">
                  <td className="max-w-sm px-4 py-3">
                    <Stars value={r.rating} />
                    {r.title && <p className="mt-1 font-medium">{r.title}</p>}
                    <p className="type-small mt-1 line-clamp-3">{r.comment}</p>
                    <p className="type-small mt-1">
                      {r.orderNumber || '—'}
                      {r.verifiedPurchase && <span className="ml-2 text-bronze-deep">· Verified</span>}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {r.product ? (
                      <Link to={`/product/${r.product.slug}`} className="hover:underline">
                        {r.product.name}
                      </Link>
                    ) : (
                      <span className="text-fog">Removed product</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p>{r.user?.name || r.reviewer}</p>
                    <p className="type-small">{r.user?.email || ''}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLES[r.status] || STATUS_STYLES.pending}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {r.status !== 'approved' && (
                        <button
                          type="button"
                          className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs"
                          disabled={busyId === r.id}
                          onClick={() => handleStatus(r.id, 'approved')}
                        >
                          Approve
                        </button>
                      )}
                      {r.status !== 'rejected' && (
                        <button
                          type="button"
                          className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs"
                          disabled={busyId === r.id}
                          onClick={() => handleStatus(r.id, 'rejected')}
                        >
                          Reject
                        </button>
                      )}
                      {confirmDeleteId === r.id ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary !min-h-0 !border-red-800 !bg-red-800 px-3 py-1.5 text-xs"
                            disabled={busyId === r.id}
                            onClick={() => handleDelete(r.id)}
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost !min-h-0 px-3 py-1.5 text-xs"
                            disabled={busyId === r.id}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Keep
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost !min-h-0 px-3 py-1.5 text-xs"
                          disabled={busyId === r.id}
                          onClick={() => setConfirmDeleteId(r.id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
    </div>
  )
}

export default Reviews
