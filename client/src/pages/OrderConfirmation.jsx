import { useState } from 'react'
import { Check, PackageSearch } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { formatINR } from '../data/home.js'
import { formatDateLong, loadLastOrder } from '../utils/checkout.js'

function OrderConfirmation() {
  const [order] = useState(loadLastOrder)
  const { user } = useAuth()

  if (!order) {
    return (
      <main className="bg-ivory text-charcoal">
        <div className="clothza-container py-16 md:py-24">
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 text-center">
            <PackageSearch size={28} strokeWidth={1.25} aria-hidden="true" className="text-fog" />
            <p className="type-label">Order confirmation</p>
            <h1 className="type-h2">No recent order found.</h1>
            <p className="type-body-muted">
              Looks like you have not placed an order yet. Explore the collection to
              get started.
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Link to="/shop" className="btn btn-primary">
                Continue Shopping
              </Link>
              <Link to="/" className="btn btn-secondary">
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const customerName = `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim()
  const addressParts = [
    order.shipping?.address,
    order.shipping?.apartment,
    [order.shipping?.city, order.shipping?.state, order.shipping?.pin].filter(Boolean).join(' '),
    order.shipping?.country,
  ].filter(Boolean)
  const etaLabel = order.delivery?.window?.startISO && order.delivery?.window?.endISO
    ? `${formatDateLong(order.delivery.window.startISO)} – ${formatDateLong(order.delivery.window.endISO)}`
    : order.delivery?.eta || ''

  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container py-12 md:py-16">
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 text-center">
          <span className="inline-flex items-center justify-center rounded-full bg-charcoal p-3 text-ivory">
            <Check size={24} strokeWidth={2} aria-hidden="true" />
          </span>
          <p className="type-label">Order placed successfully</p>
          <h1 className="type-h1">Thank you{customerName ? `, ${order.customer.firstName}` : ''}.</h1>
          <p className="type-body-muted">Thank you for shopping with CLOTHZA.</p>
          <p className="type-price text-lg" aria-label={`Order number ${order.number}`}>
            Order {order.number}
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl gap-6 md:grid-cols-2">
          {/* Details */}
          <section aria-label="Order details" className="rounded-[4px] border border-linen bg-porcelain p-6">
            <h2 className="type-label">Order details</h2>
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
                <dt className="text-fog">Delivery address</dt>
                <dd className="max-w-56 text-right font-medium">
                  {addressParts.length > 0 ? addressParts.join(', ') : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-6 border-b border-linen pb-3">
                <dt className="text-fog">Delivery method</dt>
                <dd className="text-right font-medium">{order.delivery?.label || '—'}</dd>
              </div>
              <div className="flex justify-between gap-6 border-b border-linen pb-3">
                <dt className="text-fog">Estimated delivery</dt>
                <dd className="text-right font-medium">{etaLabel || '—'}</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="text-fog">Payment method</dt>
                <dd className="text-right font-medium">{order.payment?.label || '—'}</dd>
              </div>
              {order.payment?.status && (
                <div className="flex justify-between gap-6 border-t border-linen pt-3">
                  <dt className="text-fog">Payment status</dt>
                  <dd className="text-right font-medium capitalize">{order.payment.status}</dd>
                </div>
              )}
            </dl>
            {order.payment?.isDemo && (
              <p className="type-small mt-4 rounded-[3px] border border-bronze/40 bg-cream p-3">
                Demo payment — simulated for this portfolio project. No real money moved.
              </p>
            )}
            <p className="type-small mt-4">
              This confirmation is saved — reloading this page will not place another order.
              Track live status under My Orders.
            </p>
          </section>

          {/* Items + totals */}
          <section aria-label="Ordered products" className="rounded-[4px] border border-linen bg-porcelain p-6">
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
                    Coupon discount{order.coupon?.code ? ` (${order.coupon.code})` : ''}
                  </dt>
                  <dd className="font-medium">−{formatINR(order.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-6">
                <dt className="text-fog">Delivery</dt>
                <dd className="font-medium">
                  {order.deliveryCharge === 0 ? 'Free' : formatINR(order.deliveryCharge)}
                </dd>
              </div>
              <div className="flex justify-between gap-6 border-t border-linen pt-3">
                <dt className="font-medium">Total amount</dt>
                <dd className="type-price text-lg">{formatINR(order.total)}</dd>
              </div>
            </dl>
          </section>
        </div>

        <div className="mx-auto mt-10 flex w-full max-w-md flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link to="/shop" className="btn btn-primary w-full sm:w-auto">
            Continue Shopping
          </Link>
          {user && order.number && (
            <Link
              to={`/account/orders/${encodeURIComponent(order.number)}`}
              className="btn btn-secondary w-full sm:w-auto"
            >
              View in My Orders
            </Link>
          )}
          <Link to="/" className="btn btn-secondary w-full sm:w-auto">
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  )
}

export default OrderConfirmation
