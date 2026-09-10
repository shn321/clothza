import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import OrderStatusBadge from '../../components/order/OrderStatusBadge.jsx'
import { ApiError, fetchAdminOrders } from '../../lib/api.js'

const STATUSES = ['', 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']

function Orders() {
  const [orders, setOrders] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 })
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminOrders({
        q: q.trim() || undefined,
        status: status || undefined,
        page,
        limit: 20,
      })
      setOrders(result.orders)
      setPagination(result.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load orders.')
    } finally {
      setLoading(false)
    }
  }, [q, status, page])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div>
      <h1 className="type-h2">Orders</h1>
      <p className="type-body-muted mt-1">
        {pagination.total} {pagination.total === 1 ? 'order' : 'orders'}
      </p>

      <div className="card mt-5 grid gap-3 p-4 sm:grid-cols-[1fr_200px_auto]">
        <label className="block">
          <span className="field-label">Search</span>
          <input
            type="search"
            className="field-input"
            placeholder="Order number, name or email…"
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
        <div className="flex items-end">
          <button
            type="button"
            className="btn btn-ghost text-sm"
            onClick={() => {
              setQ('')
              setStatus('')
              setPage(1)
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="card mt-4 overflow-x-auto">
        {loading ? (
          <p className="type-body-muted p-6" aria-busy="true">
            Loading orders…
          </p>
        ) : error ? (
          <div className="p-6" role="alert">
            <p className="type-body">{error}</p>
            <button type="button" className="btn btn-secondary mt-4" onClick={load}>
              Retry
            </button>
          </div>
        ) : orders.length === 0 ? (
          <p className="type-body-muted p-6">No orders match these filters.</p>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-linen text-xs uppercase tracking-wider text-fog">
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Payment</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linen">
              {orders.map((o) => (
                <tr key={o.orderNumber} className="hover:bg-cream/60">
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/orders/${encodeURIComponent(o.orderNumber)}`}
                      className="font-medium hover:underline"
                    >
                      {o.orderNumber}
                    </Link>
                    <p className="type-small">{o.itemCount} items</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>
                      {o.customer?.firstName} {o.customer?.lastName}
                    </p>
                    <p className="type-small truncate">{o.customer?.email}</p>
                  </td>
                  <td className="px-4 py-3 text-fog">
                    {o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-IN') : '—'}
                  </td>
                  <td className="px-4 py-3 tabular-nums">₹{Number(o.total).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3">
                    <span className="type-small capitalize">
                      {o.paymentMethod} · {o.paymentStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={o.orderStatus} />
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

export default Orders
