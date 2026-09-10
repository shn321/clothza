import { useCallback, useEffect, useState } from 'react'
import { ApiError, fetchAdminCustomers } from '../../lib/api.js'

function Customers() {
  const [customers, setCustomers] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 })
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminCustomers({ q: q.trim() || undefined, page, limit: 20 })
      setCustomers(result.customers)
      setPagination(result.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load customers.')
    } finally {
      setLoading(false)
    }
  }, [q, page])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div>
      <h1 className="type-h2">Customers</h1>
      <p className="type-body-muted mt-1">
        {pagination.total} {pagination.total === 1 ? 'customer' : 'customers'}
      </p>

      <div className="card mt-5 grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="field-label">Search</span>
          <input
            type="search"
            className="field-input"
            placeholder="Name or email…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            className="btn btn-ghost text-sm"
            onClick={() => {
              setQ('')
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
            Loading customers…
          </p>
        ) : error ? (
          <div className="p-6" role="alert">
            <p className="type-body">{error}</p>
            <button type="button" className="btn btn-secondary mt-4" onClick={load}>
              Retry
            </button>
          </div>
        ) : customers.length === 0 ? (
          <p className="type-body-muted p-6">No customers found.</p>
        ) : (
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr className="border-b border-linen text-xs uppercase tracking-wider text-fog">
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Orders</th>
                <th className="px-4 py-3 text-right font-medium">Total spent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linen">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-cream/60">
                  <td className="px-4 py-3">
                    <p className="font-medium">{c.name}</p>
                    <p className="type-small">{c.email}</p>
                  </td>
                  <td className="px-4 py-3 text-fog">
                    {c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-IN') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="type-small capitalize">{c.role}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{c.orderCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    ₹{Number(c.totalSpent).toLocaleString('en-IN')}
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

export default Customers
