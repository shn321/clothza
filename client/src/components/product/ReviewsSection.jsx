import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import {
  ApiError,
  createProductReview,
  deleteProductReview,
  fetchProductReviews,
  fetchReviewEligibility,
  updateProductReview,
} from '../../lib/api.js'

/* Product reviews section (Step 17) — CLOTHZA-minimal styling.
   Summary + breakdown from approved reviews only; the Write a Review
   form appears solely for verified-purchase-eligible customers. */

function Stars({ value, size = 15 }) {
  const full = Math.round(Number(value) || 0)
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`Rated ${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          strokeWidth={1.5}
          aria-hidden="true"
          className={i <= full ? 'text-bronze-deep' : 'text-linen'}
          fill="currentColor"
        />
      ))}
    </span>
  )
}

function StarPicker({ value, onChange }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} star${i > 1 ? 's' : ''}`}
          onClick={() => onChange(i)}
          className="rounded-[3px] p-1 transition-colors duration-150 hover:bg-charcoal/5"
        >
          <Star
            size={22}
            strokeWidth={1.5}
            aria-hidden="true"
            className={i <= value ? 'text-bronze-deep' : 'text-linen'}
            fill="currentColor"
          />
        </button>
      ))}
    </div>
  )
}

const REASON_COPY = {
  'not-purchased': 'Purchase this product to leave a review.',
  'not-delivered': 'Thanks for your order — you can leave a review once it is delivered.',
}

function ReviewForm({ initial, eligibleOrders, saving, serverError, onSubmit, onCancel }) {
  const [rating, setRating] = useState(initial?.rating || 0)
  const [title, setTitle] = useState(initial?.title || '')
  const [comment, setComment] = useState(initial?.comment || '')
  const [orderNumber, setOrderNumber] = useState(eligibleOrders?.[0]?.orderNumber || '')
  const [localError, setLocalError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    setLocalError('')
    if (!rating) {
      setLocalError('Please select a star rating.')
      return
    }
    if (comment.trim().length < 10) {
      setLocalError('Please write at least 10 characters.')
      return
    }
    onSubmit({ rating, title: title.trim(), comment: comment.trim(), orderNumber })
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4 rounded-[4px] border border-linen bg-porcelain p-5">
      <div>
        <span className="field-label">Your rating *</span>
        <StarPicker value={rating} onChange={setRating} />
      </div>
      {eligibleOrders && eligibleOrders.length > 1 && (
        <label className="block">
          <span className="field-label">Order *</span>
          <select className="field-select" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} required>
            {eligibleOrders.map((o) => (
              <option key={o.orderNumber} value={o.orderNumber}>
                {o.orderNumber}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="field-label">Title</span>
        <input
          className="field-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="Sum it up in a few words"
        />
      </label>
      <label className="block">
        <span className="field-label">Review *</span>
        <textarea
          className="field-textarea"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={2000}
          placeholder="What did you love? How is the fit and fabric?"
          required
        />
      </label>
      {(localError || serverError) && (
        <p role="alert" className="text-sm text-red-800">
          {localError || serverError}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Submitting…' : initial ? 'Save changes' : 'Submit review'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

function ReviewsSection({ product }) {
  const { user, loading: authLoading } = useAuth()
  const slug = product?.slug
  const [reviews, setReviews] = useState([])
  const [summary, setSummary] = useState({ average: 0, count: 0, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } })
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [elig, setElig] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async (nextPage = 1, append = false) => {
    if (!slug) return
    setLoading(!append)
    setListError('')
    try {
      const result = await fetchProductReviews(slug, { page: nextPage, limit: 10 })
      setReviews((prev) => (append ? [...prev, ...result.reviews] : result.reviews))
      setSummary(result.summary)
      setPage(result.pagination.page)
      setPages(result.pagination.pages)
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setListError(err instanceof ApiError ? err.message : 'Could not load reviews.')
      }
    } finally {
      setLoading(false)
    }
  }, [slug])

  const loadEligibility = useCallback(async () => {
    if (!slug || authLoading || !user) {
      setElig(null)
      return
    }
    try {
      setElig(await fetchReviewEligibility(slug))
    } catch {
      setElig(null)
    }
  }, [slug, authLoading, user])

  useEffect(() => {
    setReviews([])
    setPage(1)
    load(1, false)
    setFormOpen(false)
    setEditingId(null)
    setNotice('')
  }, [load])

  useEffect(() => {
    loadEligibility()
  }, [loadEligibility])

  async function refresh() {
    await load(1, false)
    await loadEligibility()
  }

  async function handleCreate({ rating, title, comment, orderNumber }) {
    setSaving(true)
    setFormError('')
    try {
      await createProductReview(slug, { rating, title, comment, orderNumber })
      setFormOpen(false)
      setNotice('Thanks! Your review was submitted and will appear once approved.')
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not submit your review.')
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(id, { rating, title, comment }) {
    setSaving(true)
    setFormError('')
    try {
      const { message } = await updateProductReview(id, { rating, title, comment })
      setEditingId(null)
      setNotice(message || 'Review updated.')
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not update your review.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    setSaving(true)
    try {
      await deleteProductReview(id)
      setConfirmDeleteId(null)
      setNotice('Your review was deleted.')
      await refresh()
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not delete your review.')
    } finally {
      setSaving(false)
    }
  }

  const userReview = elig?.userReview || null
  const showForm = formOpen && elig?.eligible
  const maxBucket = Math.max(1, ...[1, 2, 3, 4, 5].map((s) => summary.breakdown?.[s] || 0))

  return (
    <section aria-label="Product reviews" className="mt-16 md:mt-24">
      <h2 className="type-h2">Reviews</h2>

      {loading ? (
        <p className="type-body-muted mt-4" role="status" aria-label="Loading reviews">
          Loading reviews…
        </p>
      ) : listError ? (
        <p className="mt-4 text-sm text-red-800" role="alert">
          {listError}
        </p>
      ) : (
        <>
          {/* Summary */}
          <div className="card mt-6 grid gap-6 p-6 md:grid-cols-[220px_1fr]">
            <div className="flex flex-col items-start justify-center">
              <p className="flex items-center gap-2">
                <Stars value={summary.average} size={18} />
                <span className="type-h2 tabular-nums">{Number(summary.average).toFixed(1)}</span>
              </p>
              <p className="type-small mt-2">
                Based on {summary.count} {summary.count === 1 ? 'review' : 'reviews'}
              </p>
            </div>
            <div className="flex flex-col justify-center gap-1.5" aria-label="Rating breakdown">
              {[5, 4, 3, 2, 1].map((s) => {
                const n = summary.breakdown?.[s] || 0
                return (
                  <div key={s} className="flex items-center gap-3 text-sm">
                    <span className="w-10 shrink-0 text-fog tabular-nums">{s} star</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-linen" aria-hidden="true">
                      <div
                        className="h-full rounded-full bg-bronze-deep"
                        style={{ width: `${Math.round((n / maxBucket) * 100)}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-fog tabular-nums">{n}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Eligibility / write */}
          <div className="mt-6">
            {authLoading ? null : !user ? (
              <p className="type-body-muted text-sm">
                <Link to="/login" className="font-medium text-charcoal underline underline-offset-4">
                  Sign in
                </Link>{' '}
                and purchase this product to leave a review.
              </p>
            ) : userReview && userReview.status !== 'approved' ? (
              <div className="rounded-[4px] border border-linen bg-porcelain p-4" role="status">
                <p className="text-sm">
                  {userReview.status === 'pending'
                    ? 'Your review is awaiting moderation and will appear here once approved.'
                    : 'Your review was not approved. You can edit it below to resubmit.'}
                </p>
                {userReview.status === 'rejected' && (
                  editingId ? (
                    <ReviewForm
                      initial={userReview}
                      saving={saving}
                      serverError={formError}
                      onSubmit={(v) => handleEdit(userReview.id, v)}
                      onCancel={() => {
                        setEditingId(null)
                        setFormError('')
                      }}
                    />
                  ) : (
                    <button type="button" className="btn btn-secondary mt-3" onClick={() => setEditingId(userReview.id)}>
                      Edit and resubmit
                    </button>
                  )
                )}
              </div>
            ) : elig?.eligible ? (
              showForm ? (
                <ReviewForm
                  eligibleOrders={elig.eligibleOrders}
                  saving={saving}
                  serverError={formError}
                  onSubmit={handleCreate}
                  onCancel={() => {
                    setFormOpen(false)
                    setFormError('')
                  }}
                />
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => setFormOpen(true)}>
                  Write a Review
                </button>
              )
            ) : elig?.reason && REASON_COPY[elig.reason] ? (
              <p className="type-body-muted text-sm">{REASON_COPY[elig.reason]}</p>
            ) : null}
            {notice && (
              <p className="mt-3 text-sm text-charcoal" role="status">
                {notice}
              </p>
            )}
          </div>

          {/* List */}
          {reviews.length === 0 ? (
            <p className="type-body-muted mt-6 text-sm">No reviews yet — be the first to share your thoughts.</p>
          ) : (
            <ul className="mt-6 flex flex-col gap-4">
              {reviews.map((r) => (
                <li key={r.id} className="card p-5">
                  {editingId === r.id ? (
                    <ReviewForm
                      initial={r}
                      saving={saving}
                      serverError={formError}
                      onSubmit={(v) => handleEdit(r.id, v)}
                      onCancel={() => {
                        setEditingId(null)
                        setFormError('')
                      }}
                    />
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Stars value={r.rating} />
                        <span className="type-small">
                          {r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN') : ''}
                        </span>
                      </div>
                      {r.title && <p className="mt-2 font-medium">{r.title}</p>}
                      <p className="type-body-muted mt-1 text-[0.9375rem]">{r.comment}</p>
                      <p className="type-small mt-3">
                        {r.reviewer}
                        {r.verifiedPurchase && <span className="ml-2 text-bronze-deep">· Verified purchase</span>}
                      </p>
                      {r.isMine && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs"
                            disabled={saving}
                            onClick={() => {
                              setEditingId(r.id)
                              setFormError('')
                            }}
                          >
                            Edit
                          </button>
                          {confirmDeleteId === r.id ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-primary !min-h-0 !border-red-800 !bg-red-800 px-3 py-1.5 text-xs"
                                disabled={saving}
                                onClick={() => handleDelete(r.id)}
                              >
                                Confirm delete
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost !min-h-0 px-3 py-1.5 text-xs"
                                disabled={saving}
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Keep
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-ghost !min-h-0 px-3 py-1.5 text-xs"
                              disabled={saving}
                              onClick={() => setConfirmDeleteId(r.id)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {page < pages && (
            <button
              type="button"
              className="btn btn-secondary mt-6"
              disabled={loading}
              onClick={() => load(page + 1, true)}
            >
              Load more reviews
            </button>
          )}
        </>
      )}
    </section>
  )
}

export default ReviewsSection
