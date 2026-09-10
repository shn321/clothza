import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'
import { formatINR } from '../data/home.js'

function Cart() {
  const { items, count, subtotal, updateQty, removeItem } = useCart()

  if (items.length === 0) {
    return (
      <main className="bg-ivory text-charcoal">
        <div className="clothza-container py-16 md:py-24">
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 text-center">
            <ShoppingBag size={28} strokeWidth={1.25} aria-hidden="true" className="text-fog" />
            <p className="type-label">Your bag</p>
            <h1 className="type-h2">Your bag is empty.</h1>
            <p className="type-body-muted">
              Discover timeless essentials designed for the way you live.
            </p>
            <Link to="/shop" className="btn btn-primary mt-2">
              Continue Shopping
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container py-12 md:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="type-label">Your bag</p>
          <h1 className="type-h1 mt-2">Shopping Bag</h1>
          <p className="type-body-muted mt-3">
            {count} {count === 1 ? 'item' : 'items'} in your bag.
          </p>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_22rem] lg:gap-12">
          {/* Lines */}
          <ul aria-label="Items in your bag" className="flex flex-col divide-y divide-linen border-y border-linen">
            {items.map((l) => (
              <li key={l.key} className="flex gap-4 py-5 sm:gap-6">
                <Link
                  to={`/product/${l.slug}`}
                  aria-label={`View ${l.name}`}
                  className="w-20 shrink-0 overflow-hidden rounded-[4px] border border-linen bg-porcelain sm:w-24"
                >
                  {l.image && (
                    <img src={l.image} alt="" aria-hidden="true" className="aspect-[3/4] w-full object-cover" />
                  )}
                </Link>

                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-[0.9375rem] font-medium leading-6">
                        <Link
                          to={`/product/${l.slug}`}
                          className="transition-colors duration-200 hover:text-bronze-deep"
                        >
                          {l.name}
                        </Link>
                      </h2>
                      <p className="type-small mt-0.5">
                        {[l.size && `Size ${l.size}`, l.colour && l.colour]
                          .filter(Boolean)
                          .join(' · ') || 'One size'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(l.key)}
                      aria-label={`Remove ${l.name} from bag`}
                      className="inline-flex shrink-0 items-center justify-center rounded-[3px] p-2 text-fog transition-colors duration-200 hover:bg-charcoal/5 hover:text-charcoal"
                    >
                      <Trash2 size={17} strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="inline-flex items-center rounded-[3px] border border-linen bg-porcelain">
                      <button
                        type="button"
                        onClick={() => updateQty(l.key, l.qty - 1)}
                        disabled={l.qty <= 1}
                        aria-label={`Decrease quantity of ${l.name}`}
                        className="p-2.5 text-charcoal transition-colors duration-200 hover:bg-charcoal/5 disabled:opacity-40"
                      >
                        <Minus size={15} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                      <span
                        className="min-w-8 text-center text-sm font-medium"
                        aria-live="polite"
                        aria-label={`Quantity ${l.qty}`}
                      >
                        {l.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQty(l.key, l.qty + 1)}
                        disabled={l.qty >= l.max}
                        aria-label={`Increase quantity of ${l.name}`}
                        className="p-2.5 text-charcoal transition-colors duration-200 hover:bg-charcoal/5 disabled:opacity-40"
                      >
                        <Plus size={15} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </div>
                    <p className="type-price">{formatINR(l.price * l.qty)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Summary */}
          <aside aria-label="Order summary" className="lg:sticky lg:top-28 lg:self-start">
            <div className="rounded-[4px] border border-linen bg-porcelain p-6">
              <h2 className="type-label">Order summary</h2>
              <dl className="mt-4 flex flex-col gap-3 text-sm">
                <div className="flex justify-between gap-6">
                  <dt className="text-fog">Subtotal</dt>
                  <dd className="font-medium">{formatINR(subtotal)}</dd>
                </div>
                <div className="flex justify-between gap-6">
                  <dt className="text-fog">Shipping</dt>
                  <dd className="text-right font-medium">Calculated at checkout</dd>
                </div>
                <div className="flex justify-between gap-6 border-t border-linen pt-3">
                  <dt className="font-medium">Total</dt>
                  <dd className="type-price text-lg">{formatINR(subtotal)}</dd>
                </div>
              </dl>
              <Link to="/checkout" className="btn btn-primary mt-6 w-full">
                Proceed to Checkout
              </Link>
              <Link to="/shop" className="btn btn-secondary mt-3 w-full">
                Continue Shopping
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}

export default Cart
