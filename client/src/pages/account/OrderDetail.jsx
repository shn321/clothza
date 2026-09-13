import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import OrderStatusBadge from '../../components/order/OrderStatusBadge.jsx'
import OrderStatusTimeline from '../../components/order/OrderStatusTimeline.jsx'
import { formatINR } from '../../data/home.js'
import { cancelOrder, fetchOrder } from '../../lib/api.js'
import { formatDateLong } from '../../utils/checkout.js'

/* Order detail — owner's persistent order with items, totals, address,
   payment info and cancellation while the status permits it. */

const CANCELLABLE = ['pending', 'confirmed', 'processing']

function OrderDetail() {
  const { orderNumber } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelError, setCancelError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = await fetchOrder(orderNumber)
        if (!cancelled) setOrder(data)
      } catch {
        if (!cancelled) setError('Order not found.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [orderNumber])

  async function handleCancel() {
    if (!confirmingCancel) {
      setConfirmingCancel(true)
      return
    }
    setCancelling(true)
    setCancelError('')
    try {
      const updated = await cancelOrder(orderNumber)
      setOrder(updated)
      setConfirmingCancel(false)
    } catch (err) {
      setCancelError(err?.message || 'Could not cancel your order. Please try again.')
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <main className="bg-ivory text-charcoal">
        <div className="clothza-container clothza-section">
          <p className="type-body-muted" aria-busy="true">Loading your order…</p>
        </div>
      </main>
    )
  }

  if (error || !order) {
    return (
      <main className="bg-ivory text-charcoal">
        <div className="clothza-container clothza-section">
          <div className="mx-auto w-full max-w-2xl">
            <p className="type-label">Order</p>
            <h1 className="type-h2 mt-2">Order not found.</h1>
            <p className="type-body-muted mt-2">
              This order does not exist or belongs to another account.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link to="/account" className="btn btn-secondary">
                Back to Account
              </Link>
              <Link to="/shop" className="btn btn-primary">
                Continue Shopping
              </Link>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const customerName = `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim()
  const addressParts = [
    order.shippingAddress?.address,
    order.shippingAddress?.apartment,
    [order.shippingAddress?.city, order.shippingAddress?.state, order.shippingAddress?.pin]
      .filter(Boolean)
      .join(' '),
    order.shippingAddress?.country,
  ].filter(Boolean)
  const canCancel = CANCELLABLE.includes(order.orderStatus)

  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container clothza-section">
        <div className="mx-auto w-full max-w-2xl">
          <button type="button" onClick={() => navigate('/account')} className="type-small underline underline-offset-4">
            ← Back to Account
          </button>
          <p className="type-label mt-4">Order {order.orderNumber}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="type-h2">Order details</h1>
            <OrderStatusBadge status={order.orderStatus} />
            {order.isDemoPayment && (
              <span className="inline-flex items-center rounded-full border border-bronze/40 bg-cream px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-bronze-deep">
                Demo payment
              </span>
            )}
          </div>
          <p className="type-small mt-2">
            Placed {formatDateLong(order.createdAt) || 'recently'} · {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
          </p>

          <section aria-label="Order progress" className="card mt-6 p-6">
            <h2 className="type-label">Order progress</h2>
            <div className="mt-4">
              <OrderStatusTimeline status={order.orderStatus} />
            </div>
          </section>

          <section aria-label="Ordered products" className="card mt-6 p-6">
            <h2 className="type-label">Ordered products</h2>
            <ul className="mt-4 flex flex-col gap-4">
              {(order.items || []).map((l) => (
                <li key={l.key} className="flex gap-3">
                  <span className="w-14 shrink-0 overflow-hidden rounded-[3px] border border-linen bg-ivory">
                    {l.image && (
                      <img src={l.image} alt="" aria-hidden="true" className="aspect-[3/4] w-full object-cover" />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{l.name}</span>
                    <span className="type-small">
                      {[l.size ? `Size ${l.size}` : null, l.colour || null].filter(Boolean).join(' · ') || 'One size'}
                    </span>
                    <span className="type-small">Qty {l.qty}</span>
                  </span>
                  <span className="type-price shrink-0 text-sm">{formatINR(l.price * l.qty)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-5 flex flex-col gap-3 border-t border-linen pt-4 text-sm">
              <div className="flex justify-between gap-6">
                <dt className="text-fog">Subtotal</dt>
                <dd className="font-medium">{formatINR(order.subtotal)}</dd>
              </div>
              {Number(order.discount) > 0 && (
                <div className="flex justify-between gap-6">
                  <dt className="text-fog">
                    Discount{order.coupon?.code ? ` (${order.coupon.code})` : ''}
                  </dt>
                  <dd className="font-medium">−{formatINR(order.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-6">
                <dt className="text-fog">Delivery ({order.deliveryMethod?.label || 'Standard'})</dt>
                <dd className="font-medium">
                  {order.shippingCost === 0 ? 'Free' : formatINR(order.shippingCost)}
                </dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="text-fog">Tax</dt>
                <dd className="font-medium">{formatINR(order.tax ?? 0)}</dd>
              </div>
              <div className="flex justify-between gap-6 border-t border-linen pt-3">
                <dt className="font-medium">Total amount</dt>
                <dd className="type-price text-lg">{formatINR(order.total)}</dd>
              </div>
            </dl>
          </section>

          <section aria-label="Delivery and payment" className="card mt-6 p-6">
            <h2 className="type-label">Delivery &amp; payment</h2>
            <dl className="mt-4 flex flex-col gap-3 text-sm">
              <div className="flex justify-between gap-6 border-b border-linen pb-3">
                <dt className="text-fog">Customer</dt>
                <dd className="text-right font-medium">{customerName || '—'}</dd>
              </div>
              <div className="flex justify-between gap-6 border-b border-linen pb-3">
                <dt className="text-fog">Email</dt>
                <dd className="break-all text-right font-medium">{order.customer?.email || '—'}</dd>
              </div>
              <div className="flex justify-between gap-6 border-b border-linen pb-3">
                <dt className="text-fog">Phone</dt>
                <dd className="text-right font-medium">{order.customer?.phone || '—'}</dd>
              </div>
              <div className="flex justify-between gap-6 border-b border-linen pb-3">
                <dt className="text-fog">Order date</dt>
                <dd className="text-right font-medium">{formatDateLong(order.createdAt) || '—'}</dd>
              </div>
              <div className="flex justify-between gap-6 border-b border-linen pb-3">
                <dt className="text-fog">Delivery address</dt>
                <dd className="max-w-56 text-right font-medium">
                  {addressParts.length > 0 ? addressParts.join(', ') : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-6 border-b border-linen pb-3">
                <dt className="text-fog">Payment method</dt>
                <dd className="text-right font-medium">
                  {order.paymentMethodLabel || order.paymentMethod}
                  {order.isDemoPayment && ' (simulated — no real charge)'}
                </dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="text-fog">Payment status</dt>
                <dd className="text-right font-medium capitalize">{order.paymentStatus}</dd>
              </div>
            </dl>

            {canCancel && (
              <div className="mt-6 border-t border-linen pt-5">
                {cancelError && (
                  <p role="alert" className="mb-3 text-sm text-red-800">{cancelError}</p>
                )}
                {confirmingCancel ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="type-small w-full">Cancel this order? Stock will be restored.</p>
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={cancelling}
                      className="btn btn-primary"
                    >
                      {cancelling ? 'Cancelling…' : 'Yes, cancel order'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingCancel(false)}
                      disabled={cancelling}
                      className="btn btn-secondary"
                    >
                      Keep order
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={handleCancel} className="btn btn-secondary">
                    Cancel order
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

export default OrderDetail
