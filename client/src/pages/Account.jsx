import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import OrderStatusBadge from '../components/order/OrderStatusBadge.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { formatINR } from '../data/home.js'
import { fetchOrders } from '../lib/api.js'
import { formatDateLong } from '../utils/checkout.js'

/* Account page: identity, status, order history, logout.
   Orders load once per session from the persistent order API. */

function Account() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [ordersError, setOrdersError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadOrders() {
      setOrdersLoading(true)
      setOrdersError('')
      try {
        const { orders: list } = await fetchOrders({ limit: 20 })
        if (!cancelled) setOrders(list)
      } catch {
        if (!cancelled) setOrdersError('Could not load your orders. Please try again later.')
      } finally {
        if (!cancelled) setOrdersLoading(false)
      }
    }
    loadOrders()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await logout()
      navigate('/login', { replace: true })
    } finally {
      setLoggingOut(false)
    }
  }

  if (!user) return null

  const initial = String(user.name || user.email || '?').trim().charAt(0).toUpperCase()

  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container clothza-section">
        <div className="mx-auto w-full max-w-2xl">
          <p className="type-label">Account</p>
          <h1 className="type-h2 mt-2">Your account</h1>

          <section aria-label="Profile" className="card mt-6 p-6">
            <div className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-charcoal text-lg font-medium text-ivory"
              >
                {initial}
              </span>
              <div className="min-w-0">
                <p className="type-h3 truncate">{user.name}</p>
                <p className="type-small truncate">{user.email}</p>
              </div>
            </div>

            <hr className="divider my-5" />

            <dl className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <dt className="type-small">Account status</dt>
                <dd>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-linen bg-cream px-2.5 py-1 text-xs font-medium text-charcoal">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-green-700" />
                    Active
                  </span>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="type-small">Role</dt>
                <dd className="text-sm capitalize text-charcoal">{user.role || 'user'}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="type-small">Notifications</dt>
                <dd>
                  <Link
                    to="/account/notifications"
                    className="text-sm font-medium underline underline-offset-4"
                  >
                    View notifications
                  </Link>
                </dd>
              </div>
            </dl>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="btn btn-secondary mt-6 inline-flex items-center gap-2"
            >
              <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
              {loggingOut ? 'Logging out…' : 'Log out'}
            </button>
          </section>

          <section aria-label="My orders" className="card mt-6 p-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="type-h3">My Orders</h2>
              {!ordersLoading && !ordersError && orders.length > 0 && (
                <span className="type-small" aria-label={`${orders.length} orders`}>
                  {orders.length}
                </span>
              )}
            </div>

            {ordersLoading ? (
              <p className="type-body-muted mt-4" aria-busy="true">Loading your orders…</p>
            ) : ordersError ? (
              <p role="alert" className="mt-4 text-sm text-red-800">{ordersError}</p>
            ) : orders.length === 0 ? (
              <div className="mt-4">
                <p className="type-body-muted">You have not placed any orders yet.</p>
                <Link to="/shop" className="btn btn-secondary mt-4">
                  Start Shopping
                </Link>
              </div>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-linen">
                {orders.map((order) => (
                  <li key={order.orderNumber} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{order.orderNumber}</p>
                      <p className="type-small mt-0.5">
                        {[formatDateLong(order.createdAt), `${order.itemCount} ${order.itemCount === 1 ? 'item' : 'items'}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p className="type-price mt-1 text-sm">{formatINR(order.total)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <OrderStatusBadge status={order.orderStatus} />
                      <Link
                        to={`/account/orders/${encodeURIComponent(order.orderNumber)}`}
                        aria-label={`View order ${order.orderNumber}`}
                        className="text-sm font-medium underline underline-offset-4"
                      >
                        View Order
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

export default Account
