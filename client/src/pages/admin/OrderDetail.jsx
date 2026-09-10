import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import OrderStatusBadge from '../../components/order/OrderStatusBadge.jsx'
import { ApiError, fetchAdminOrder, updateAdminOrderStatus } from '../../lib/api.js'

const NEXT_HINT = {
  pending: ['confirmed', 'processing', 'shipped', 'cancelled'],
  confirmed: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
}

function OrderDetail() {
  const { orderNumber } = useParams()
  const [order, setOrder] = useState(null)
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nextStatus, setNextStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminOrder(orderNumber)
      setOrder(result.order)
      setAccount(result.account)
      setNextStatus('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the order.')
    } finally {
      setLoading(false)
    }
  }, [orderNumber])

  useEffect(() => {
    load()
  }, [load])

  async function handleStatusUpdate(e) {
    e.preventDefault()
    if (!nextStatus) return
    setSaving(true)
    setNotice('')
    setError('')
    try {
      const updated = await updateAdminOrderStatus(orderNumber, nextStatus)
      setOrder(updated)
      setNextStatus('')
      setNotice('Order status updated.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the order.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div aria-busy="true">
        <h1 className="type-h2">Order</h1>
        <p className="type-body-muted mt-2">Loading order…</p>
      </div>
    )
  }

  if (error && !order) {
    return (
      <div>
        <p className="type-small">
          <Link to="/admin/orders" className="hover:underline">
            ← Orders
          </Link>
        </p>
        <div className="card mt-4 p-6" role="alert">
          <p className="type-body">{error}</p>
          <button type="button" className="btn btn-secondary mt-4" onClick={load}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  const options = NEXT_HINT[order.orderStatus] || []
  const addr = order.shippingAddress || {}

  return (
    <div>
      <p className="type-small">
        <Link to="/admin/orders" className="hover:underline">
          ← Orders
        </Link>
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="type-h2">{order.orderNumber}</h1>
        <OrderStatusBadge status={order.orderStatus} />
      </div>
      <p className="type-body-muted mt-1">
        Placed {order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN') : '—'} ·{' '}
        {order.paymentMethodLabel || order.paymentMethod} · {order.paymentStatus}
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

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Items */}
          <section className="card p-5" aria-label="Order items">
            <h2 className="type-h3">Items ({order.itemCount})</h2>
            <ul className="mt-4 divide-y divide-linen">
              {(order.items || []).map((l) => (
                <li key={l.key} className="flex items-center gap-4 py-3">
                  {l.image && (
                    <img src={l.image} alt="" className="h-14 w-12 shrink-0 rounded-[3px] border border-linen object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.name}</p>
                    <p className="type-small">
                      {l.size ? `Size ${l.size}` : ''}
                      {l.size && l.colour ? ' · ' : ''}
                      {l.colour || ''} · Qty {l.qty}
                    </p>
                  </div>
                  <p className="type-price shrink-0 tabular-nums">
                    ₹{Number(l.price * l.qty).toLocaleString('en-IN')}
                  </p>
                </li>
              ))}
            </ul>
            <hr className="divider my-4" />
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-fog">Subtotal</dt>
                <dd className="tabular-nums">₹{Number(order.subtotal).toLocaleString('en-IN')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fog">Shipping ({order.deliveryMethod?.label || order.deliveryMethod?.id})</dt>
                <dd className="tabular-nums">₹{Number(order.shippingCost).toLocaleString('en-IN')}</dd>
              </div>
              <div className="flex justify-between font-medium">
                <dt>Total</dt>
                <dd className="tabular-nums">₹{Number(order.total).toLocaleString('en-IN')}</dd>
              </div>
            </dl>
          </section>

          {/* Customer + address */}
          <section className="card grid gap-6 p-5 sm:grid-cols-2" aria-label="Customer and address">
            <div>
              <h2 className="type-label">Customer</h2>
              <p className="mt-2 text-sm font-medium">
                {order.customer?.firstName} {order.customer?.lastName}
              </p>
              <p className="type-small">{order.customer?.email}</p>
              <p className="type-small">{order.customer?.phone}</p>
              {account && (
                <p className="type-small mt-2">
                  Account: {account.name} ({account.role})
                </p>
              )}
            </div>
            <div>
              <h2 className="type-label">Shipping address</h2>
              <p className="mt-2 text-sm">
                {addr.address}
                {addr.apartment ? `, ${addr.apartment}` : ''}
                <br />
                {addr.city}, {addr.state} {addr.pin}
                <br />
                {addr.country}
              </p>
            </div>
          </section>
        </div>

        {/* Status panel */}
        <aside className="card h-fit p-5" aria-label="Order status">
          <h2 className="type-h3">Order status</h2>
          <p className="type-small mt-2 capitalize">
            Current: <strong>{order.orderStatus}</strong> · Payment: <strong>{order.paymentStatus}</strong>
          </p>
          {options.length === 0 ? (
            <p className="type-body-muted mt-4 text-sm">
              This order is {order.orderStatus} — a final state that cannot be changed.
            </p>
          ) : (
            <form onSubmit={handleStatusUpdate} className="mt-4 flex flex-col gap-3">
              <label className="block">
                <span className="field-label">Move to</span>
                <select className="field-select" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)} required>
                  <option value="">Select status…</option>
                  {options.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn btn-primary" disabled={saving || !nextStatus}>
                {saving ? 'Updating…' : 'Update status'}
              </button>
            </form>
          )}
        </aside>
      </div>
    </div>
  )
}

export default OrderDetail
