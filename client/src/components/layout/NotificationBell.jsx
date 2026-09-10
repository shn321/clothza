import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { useNotifications } from '../../context/NotificationContext.jsx'

/* CLOTHZA notification bell (Step 19) — signed-in shoppers only.
   Matches the existing navbar icon language (badge, hover wash) and
   opens a small dropdown panel: latest notifications, mark-as-read,
   mark-all-read and a link to the full notifications page. */

function timeAgo(iso) {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function NotificationBell() {
  const { user } = useAuth()
  const notifications = useNotifications()
  const [open, setOpen] = useState(false)
  const panelRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()

  const items = notifications?.items || []
  const unreadCount = notifications?.unreadCount || 0

  useEffect(() => {
    setOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onPointer = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  if (!user || !notifications) return null

  async function handleItemClick(item) {
    if (!item.isRead) {
      await notifications.markRead(item.id)
    }
    setOpen(false)
    if (item.orderNumber) {
      navigate(`/account/orders/${encodeURIComponent(item.orderNumber)}`)
    } else {
      navigate('/account/notifications')
    }
  }

  return (
    <span ref={panelRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative inline-flex items-center justify-center rounded-[3px] p-2 text-charcoal transition-colors duration-200 hover:bg-charcoal/5"
      >
        <Bell size={20} strokeWidth={1.5} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-charcoal px-1 text-[10px] font-medium leading-none text-ivory"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-[70] mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[4px] border border-linen bg-porcelain shadow-lg"
        >
          <div className="flex items-center justify-between gap-3 border-b border-linen px-4 py-3">
            <p className="type-label">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => notifications.markAllRead()}
                className="text-xs font-medium underline underline-offset-2 hover:no-underline"
              >
                Mark all as read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="type-body-muted px-4 py-6 text-center text-sm">
              You are all caught up. Order and payment updates will appear here.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id} className="border-b border-linen last:border-b-0">
                  <button
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors duration-150 hover:bg-cream/60 ${
                      n.isRead ? '' : 'bg-cream/40'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {!n.isRead && (
                          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-bronze" />
                        )}
                        {n.title}
                      </span>
                      {n.createdAt && (
                        <span className="type-small shrink-0">{timeAgo(n.createdAt)}</span>
                      )}
                    </span>
                    <span className="type-small line-clamp-2">{n.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/account/notifications"
            className="block border-t border-linen px-4 py-3 text-center text-sm font-medium transition-colors duration-150 hover:bg-cream/60"
          >
            View all notifications
          </Link>
        </div>
      )}
    </span>
  )
}

export default NotificationBell
