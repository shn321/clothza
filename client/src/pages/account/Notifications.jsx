import { useCallback, useEffect, useState } from 'react'
import { BellRing, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useNotifications } from '../../context/NotificationContext.jsx'
import {
  ApiError,
  clearNotifications,
  deleteNotification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../lib/api.js'

/* Full notification history (Step 19) — owner-only, newest first.
   Unread items carry a bronze dot; every row links to its order where
   one is attached. Pagination via Load more; per-row delete plus
   clear-all, both with inline confirmation-free undo-less actions that
   match the existing account UX. */

const PAGE_SIZE = 20

function formatDate(iso) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

function Notifications() {
  const shelf = useNotifications()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 0 })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (page, append) => {
    if (append) setLoadingMore(true)
    else {
      setLoading(true)
      setError('')
    }
    try {
      const { notifications, pagination: pg } = await fetchNotifications({ page, limit: PAGE_SIZE })
      setItems((prev) => (append ? [...prev, ...notifications] : notifications))
      setPagination(pg)
    } catch (err) {
      if (!append) setError(err instanceof ApiError ? err.message : 'Could not load notifications.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    load(1, false)
  }, [load])

  async function afterMutation() {
    await load(1, false)
    await shelf?.refresh?.()
  }

  async function handleOpen(item) {
    setActionError('')
    try {
      if (!item.isRead) await markNotificationRead(item.id)
    } catch {
      // Reading state is best-effort; navigation still proceeds.
    } finally {
      await shelf?.refresh?.()
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)))
    }
    if (item.orderNumber) {
      navigate(`/account/orders/${encodeURIComponent(item.orderNumber)}`)
    }
  }

  async function handleMarkAll() {
    setBusy(true)
    setActionError('')
    try {
      await markAllNotificationsRead()
      await afterMutation()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not update notifications.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id) {
    setActionError('')
    try {
      await deleteNotification(id)
      await afterMutation()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not delete the notification.')
    }
  }

  async function handleClear() {
    setBusy(true)
    setActionError('')
    try {
      await clearNotifications()
      setConfirmClear(false)
      await afterMutation()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not clear notifications.')
    } finally {
      setBusy(false)
    }
  }

  const hasMore = pagination.pages > 0 && pagination.page < pagination.pages

  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container clothza-section">
        <div className="mx-auto w-full max-w-2xl">
          <p className="type-label">Account</p>
          <h1 className="type-h2 mt-2">Notifications</h1>
          <p className="type-body-muted mt-2">
            Order updates, payment receipts and alerts — newest first.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={busy || items.every((n) => n.isRead)}
              className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs"
            >
              Mark all as read
            </button>
            {confirmClear ? (
              <span className="inline-flex items-center gap-2 text-sm">
                <span className="text-fog">Clear all notifications?</span>
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={busy}
                  className="btn btn-primary !min-h-0 !border-red-800 !bg-red-800 px-3 py-1.5 text-xs"
                >
                  {busy ? 'Clearing…' : 'Yes, clear'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  disabled={busy}
                  className="btn btn-ghost !min-h-0 px-3 py-1.5 text-xs"
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={busy || items.length === 0}
                className="btn btn-secondary !min-h-0 border-red-800/20 px-3 py-1.5 text-xs text-red-800 hover:!border-red-800"
              >
                Clear all
              </button>
            )}
          </div>

          {actionError && (
            <p role="alert" className="mt-4 rounded-[3px] border border-linen bg-porcelain p-3 text-sm text-red-800">
              {actionError}
            </p>
          )}

          <div className="card mt-4">
            {loading ? (
              <p className="type-body-muted p-6" aria-busy="true">
                Loading notifications…
              </p>
            ) : error ? (
              <div className="p-6" role="alert">
                <p className="type-body">{error}</p>
                <button type="button" className="btn btn-secondary mt-4" onClick={() => load(1, false)}>
                  Retry
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-3 p-8 text-center">
                <BellRing size={28} strokeWidth={1.25} aria-hidden="true" className="text-fog" />
                <p className="type-body">No notifications yet.</p>
                <p className="type-body-muted text-sm">
                  Order confirmations, shipping updates and payment receipts will appear here.
                </p>
                <Link to="/shop" className="btn btn-primary mt-2">
                  Continue Shopping
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-linen">
                {items.map((n) => (
                  <li key={n.id} className={`flex gap-3 p-4 sm:p-5 ${n.isRead ? '' : 'bg-cream/40'}`}>
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.isRead ? 'bg-linen' : 'bg-bronze'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-[0.9375rem] font-medium">{n.title}</p>
                        {n.createdAt && (
                          <p className="type-small shrink-0">{formatDate(n.createdAt)}</p>
                        )}
                      </div>
                      <p className="type-body-muted mt-1 text-sm">{n.message}</p>
                      {n.orderNumber && (
                        <button
                          type="button"
                          onClick={() => handleOpen(n)}
                          className="mt-2 text-sm font-medium underline underline-offset-2 hover:no-underline"
                        >
                          View order {n.orderNumber}
                        </button>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {!n.isRead && (
                        <button
                          type="button"
                          onClick={() => handleOpen(n)}
                          aria-label={`Mark "${n.title}" as read`}
                          className="btn btn-ghost !min-h-0 px-2 py-1 text-xs"
                        >
                          Mark read
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(n.id)}
                        aria-label={`Delete "${n.title}"`}
                        className="inline-flex items-center justify-center rounded-[3px] p-2 text-fog transition-colors duration-200 hover:bg-charcoal/5 hover:text-red-800"
                      >
                        <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {hasMore && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => load(pagination.page + 1, true)}
                disabled={loadingMore}
                className="btn btn-secondary"
              >
                {loadingMore ? 'Loading…' : `Load more (${pagination.total - items.length} remaining)`}
              </button>
            </div>
          )}

          <div className="mt-6">
            <Link to="/account" className="btn btn-ghost text-sm">
              ← Back to account
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

export default Notifications
