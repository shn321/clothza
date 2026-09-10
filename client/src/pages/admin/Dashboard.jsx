import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import OrderStatusBadge from '../../components/order/OrderStatusBadge.jsx'
import { ApiError, fetchAdminAnalytics, fetchAdminDashboard } from '../../lib/api.js'
import { DailyBars, MeterRows } from './AnalyticsCharts.jsx'

/* CLOTHZA admin dashboard (Step 20) — the original live overview
   (revenue/orders/products/customers, recent orders, low stock) plus
   backend-computed business intelligence: period filtering, sales
   charts, status distribution, top products, categories, customers and
   coupons. Every number comes from the server; the client only renders.
   Charts are dependency-free SVG/CSS in the existing admin language. */

function formatINR(value) {
  const n = Number(value) || 0
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

function formatNum(value) {
  return (Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function StatCard({ label, value, sub }) {
  return (
    <div className="card p-5">
      <p className="type-label">{label}</p>
      <p className="type-h2 mt-2 tabular-nums">{value}</p>
      {sub && <p className="type-small mt-1">{sub}</p>}
    </div>
  )
}

const RANGE_OPTIONS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'custom', label: 'Custom' },
]

function rangeLabel(range) {
  const found = RANGE_OPTIONS.find((r) => r.key === range)
  return found ? found.label : range
}

function toInputDate(date) {
  return new Date(date).toISOString().slice(0, 10)
}

/* Module-level defaults (evaluated once, not during render). */
const NOW_MS = Date.now()
const DEFAULT_CUSTOM_END = toInputDate(NOW_MS)
const DEFAULT_CUSTOM_START = toInputDate(NOW_MS - 29 * 24 * 60 * 60 * 1000)

function Dashboard() {
  const [data, setData] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [range, setRange] = useState('30d')
  const [customStart, setCustomStart] = useState(DEFAULT_CUSTOM_START)
  const [customEnd, setCustomEnd] = useState(DEFAULT_CUSTOM_END)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = useCallback(async (activeRange, start, end) => {
    setError('')
    const params = activeRange === 'custom' ? { range: 'custom', start, end } : { range: activeRange }
    try {
      const [dash, overview, sales, products, categories, customers, coupons] = await Promise.all([
        fetchAdminDashboard(),
        fetchAdminAnalytics('overview', params),
        fetchAdminAnalytics('sales', params),
        fetchAdminAnalytics('products', { ...params, limit: 10 }),
        fetchAdminAnalytics('categories', params),
        fetchAdminAnalytics('customers', params),
        fetchAdminAnalytics('coupons', params),
      ])
      setData(dash)
      setAnalytics({ overview, sales, products, categories, customers, coupons })
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function initial() {
      setLoading(true)
      await load('30d')
      if (!cancelled) setLoading(false)
    }
    initial()
    return () => {
      cancelled = true
    }
  }, [load])

  async function applyRange(next) {
    setRange(next)
    if (next === 'custom') return // wait for explicit Apply below
    setRefreshing(true)
    await load(next)
    setRefreshing(false)
  }

  async function applyCustom() {
    setRefreshing(true)
    await load('custom', customStart, customEnd)
    setRefreshing(false)
  }

  async function refresh() {
    setRefreshing(true)
    if (range === 'custom') await load('custom', customStart, customEnd)
    else await load(range)
    setRefreshing(false)
  }

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading dashboard">
        <h1 className="type-h2">Dashboard</h1>
        <p className="type-body-muted mt-2">Loading store overview…</p>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div>
        <h1 className="type-h2">Dashboard</h1>
        <div className="card mt-4 border-red-800/20 bg-red-800/5 p-5" role="alert">
          <p className="type-body">{error}</p>
          <button type="button" className="btn btn-secondary mt-4" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  const totals = data?.totals || {}
  const lowStock = data?.lowStock || { products: [] }
  const recentOrders = Array.isArray(data?.recentOrders) ? data.recentOrders : []

  const overview = analytics?.overview
  const period = overview?.period || { revenue: 0, orders: 0, averageOrderValue: 0 }
  const byStatus = overview?.ordersByStatus || {}
  const days = analytics?.sales?.days || []
  const topProducts = analytics?.products?.items || []
  const categories = analytics?.categories?.items || []
  const customerStats = analytics?.customers || {}
  const couponStats = analytics?.coupons || { top: [] }

  return (
    <div>
      {/* Header: title + range + refresh + last updated */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-h2">Dashboard</h1>
          <p className="type-body-muted mt-1">
            Live overview of your store
            {lastUpdated && (
              <> · last updated {lastUpdated.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</>
            )}
            .
          </p>
        </div>
        <button type="button" className="btn btn-secondary" disabled={refreshing} onClick={refresh}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Date range filter */}
      <div className="card mt-4 p-4" aria-label="Analytics date range">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Preset ranges">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => applyRange(r.key)}
              aria-pressed={range === r.key}
              className={`rounded-[3px] border px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                range === r.key
                  ? 'border-charcoal bg-charcoal text-ivory'
                  : 'border-linen bg-ivory text-charcoal hover:border-charcoal'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="field-label">Start</span>
              <input
                type="date"
                className="field-input"
                value={customStart}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="field-label">End</span>
              <input
                type="date"
                className="field-input"
                value={customEnd}
                min={customStart}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </label>
            <button type="button" className="btn btn-primary" disabled={refreshing} onClick={applyCustom}>
              Apply
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="card mt-4 border-red-800/20 bg-red-800/5 p-4" role="alert">
          <p className="text-sm text-red-800">{error} — showing last loaded data.</p>
        </div>
      )}

      {/* Top summary cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Revenue" value={formatINR(period.revenue)} sub={`last ${rangeLabel(range).toLowerCase()} · paid orders`} />
        <StatCard label="Orders" value={formatNum(period.orders)} sub={`last ${rangeLabel(range).toLowerCase()} · excl. cancelled`} />
        <StatCard label="Total customers" value={formatNum(totals.customers ?? 0)} sub="registered shoppers · all time" />
        <StatCard label="Total products" value={formatNum(totals.products ?? 0)} sub={`${lowStock.count ?? 0} low in stock`} />
      </div>

      {/* Secondary cards */}
      <div className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Pending orders" value={formatNum(byStatus.pending ?? 0)} sub="awaiting confirmation" />
        <StatCard label="Delivered orders" value={formatNum(byStatus.delivered ?? 0)} sub="completed fulfilment" />
        <StatCard label="Cancelled orders" value={formatNum(byStatus.cancelled ?? 0)} sub="excluded from revenue" />
        <StatCard label="Average order value" value={formatINR(period.averageOrderValue)} sub={`last ${rangeLabel(range).toLowerCase()}`} />
      </div>

      {/* Charts row 1: sales + orders over time */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="card p-5" aria-label="Sales over time">
          <h2 className="type-h3">Sales over time</h2>
          <p className="type-small mt-1">Paid revenue per day (UTC) · {rangeLabel(range)}</p>
          <DailyBars days={days} valueKey="revenue" label="Revenue" formatValue={formatINR} />
        </section>
        <section className="card p-5" aria-label="Orders over time">
          <h2 className="type-h3">Orders over time</h2>
          <p className="type-small mt-1">Valid orders per day (UTC) · {rangeLabel(range)}</p>
          <DailyBars days={days} valueKey="orders" label="Orders" formatValue={formatNum} color="#8a6d3b" />
        </section>
      </div>

      {/* Charts row 2: status + top products */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5" aria-label="Order status distribution">
          <h2 className="type-h3">Order status</h2>
          <p className="type-small mt-1">All orders by fulfilment state · all time</p>
          <MeterRows
            rows={['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'].map((s) => ({
              label: s.charAt(0).toUpperCase() + s.slice(1),
              value: byStatus[s] ?? 0,
              display: `${formatNum(byStatus[s] ?? 0)} orders`,
            }))}
            emptyText="No orders yet."
          />
        </section>
        <section className="card p-5" aria-label="Top products">
          <div className="flex items-center justify-between">
            <h2 className="type-h3">Top products</h2>
            <Link to="/admin/products" className="text-sm font-medium text-bronze-deep hover:underline">
              Manage
            </Link>
          </div>
          <p className="type-small mt-1">By revenue from order snapshots · {rangeLabel(range)}</p>
          <MeterRows
            rows={topProducts.map((p) => ({
              label: p.name,
              sub: `${formatNum(p.quantity)} sold · ${formatNum(p.orders)} orders`,
              value: p.revenue,
              display: formatINR(p.revenue),
            }))}
            emptyText="No product sales for this range."
          />
        </section>
      </div>

      {/* Charts row 3: categories + coupons/customers */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5" aria-label="Category performance">
          <h2 className="type-h3">Categories</h2>
          <p className="type-small mt-1">Revenue share by category · {rangeLabel(range)}</p>
          <MeterRows
            rows={categories.map((c) => ({
              label: c.category,
              sub: `${formatNum(c.quantity)} sold · ${formatNum(c.orders)} orders`,
              value: c.revenue,
              display: formatINR(c.revenue),
            }))}
            emptyText="No category sales for this range."
          />
        </section>
        <section className="card p-5" aria-label="Customers and coupons">
          <h2 className="type-h3">Customers & coupons</h2>
          <p className="type-small mt-1">Aggregated · no personal data · {rangeLabel(range)}</p>
          <dl className="mt-4 flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-fog">New customers</dt>
              <dd className="font-medium tabular-nums">{formatNum(customerStats.newCustomers ?? 0)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-fog">Repeat customers</dt>
              <dd className="font-medium tabular-nums">{formatNum(customerStats.repeatCustomers ?? 0)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-fog">Avg orders / customer</dt>
              <dd className="font-medium tabular-nums">{formatNum(customerStats.averageOrdersPerCustomer ?? 0)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-fog">Coupon uses</dt>
              <dd className="font-medium tabular-nums">{formatNum(couponStats.totalUses ?? 0)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-fog">Discount given</dt>
              <dd className="font-medium tabular-nums">{formatINR(couponStats.totalDiscount ?? 0)}</dd>
            </div>
          </dl>
          {(couponStats.top || []).length > 0 && (
            <div className="mt-4 border-t border-linen pt-3">
              <p className="type-label">Most used coupons</p>
              <MeterRows
                rows={couponStats.top.slice(0, 5).map((c) => ({
                  label: c.code,
                  sub: `${formatNum(c.uses)} uses`,
                  value: c.uses,
                  display: formatINR(c.discount),
                }))}
              />
            </div>
          )}
        </section>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Recent orders */}
        <section className="card p-5" aria-label="Recent orders">
          <div className="flex items-center justify-between">
            <h2 className="type-h3">Recent orders</h2>
            <Link to="/admin/orders" className="text-sm font-medium text-bronze-deep hover:underline">
              View all
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <p className="type-body-muted mt-4">No orders yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-linen">
              {recentOrders.map((o) => (
                <li key={o.orderNumber} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link
                      to={`/admin/orders/${encodeURIComponent(o.orderNumber)}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {o.orderNumber}
                    </Link>
                    <p className="type-small truncate">
                      {o.customer?.firstName} {o.customer?.lastName} · {o.itemCount} items
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="type-price tabular-nums">₹{Number(o.total).toLocaleString('en-IN')}</span>
                    <OrderStatusBadge status={o.orderStatus} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Low stock */}
        <section className="card p-5" aria-label="Low stock products">
          <div className="flex items-center justify-between">
            <h2 className="type-h3">Low stock</h2>
            <Link to="/admin/products" className="text-sm font-medium text-bronze-deep hover:underline">
              Manage stock
            </Link>
          </div>
          {(lowStock.products || []).length === 0 ? (
            <p className="type-body-muted mt-4">All products are well stocked.</p>
          ) : (
            <ul className="mt-4 divide-y divide-linen">
              {(lowStock.products || []).map((p) => (
                <li key={p._id || p.slug} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="type-small truncate">{p.slug}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums ${
                      (p.stock ?? 0) === 0
                        ? 'border-red-800/20 bg-red-800/5 text-red-800'
                        : 'border-bronze/40 bg-cream text-bronze-deep'
                    }`}
                  >
                    {(p.stock ?? 0) === 0 ? 'Out of stock' : `${p.stock} left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

export default Dashboard
