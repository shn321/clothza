import { Heart } from 'lucide-react'
import { Link } from 'react-router-dom'
import ProductCard from '../components/product/ProductCard.jsx'
import { ProductGridSkeleton, ProductLoadError } from '../components/product/ProductStates.jsx'
import { useCart } from '../context/CartContext.jsx'
import { useProducts } from '../context/ProductsContext.jsx'
import { useWishlist } from '../context/WishlistContext.jsx'

function Wishlist() {
  const { items, count, ids } = useWishlist()
  const { loading, error, retry } = useProducts()
  const { addItem } = useCart()

  if (loading) {
    return (
      <main className="bg-ivory text-charcoal">
        <div className="clothza-container py-12 md:py-16">
          <div className="mx-auto max-w-2xl text-center">
            <p className="type-label">Saved pieces</p>
            <h1 className="type-h1 mt-2">Wishlist</h1>
          </div>
          <ProductGridSkeleton count={4} />
        </div>
      </main>
    )
  }

  if (error && ids.length > 0) {
    return (
      <main className="bg-ivory text-charcoal">
        <div className="clothza-container py-16 md:py-24">
          <ProductLoadError message={error} onRetry={retry} />
        </div>
      </main>
    )
  }

  if (items.length === 0) {
    return (
      <main className="bg-ivory text-charcoal">
        <div className="clothza-container py-16 md:py-24">
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 text-center">
            <Heart size={28} strokeWidth={1.25} aria-hidden="true" className="text-fog" />
            <p className="type-label">Wishlist</p>
            <h1 className="type-h2">Your wishlist is empty.</h1>
            <p className="type-body-muted">
              Tap the heart on any piece to keep it here for later.
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
          <p className="type-label">Saved pieces</p>
          <h1 className="type-h1 mt-2">Wishlist</h1>
          <p className="type-body-muted mt-3">
            {count} {count === 1 ? 'piece' : 'pieces'} saved for later.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-5 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
          {items.map((p) => {
            const needsSize = Array.isArray(p.sizes) && p.sizes.length > 0
            return (
              <div key={p.id} className="flex flex-col gap-3">
                <ProductCard product={p} />
                {needsSize ? (
                  <Link
                    to={`/product/${p.slug || p.id}`}
                    className="btn btn-secondary w-full"
                    aria-label={`Select size for ${p.name}`}
                  >
                    Select Size
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => addItem(p, { qty: 1 })}
                    className="btn btn-secondary w-full"
                    aria-label={`Add ${p.name} to bag`}
                  >
                    Add to Bag
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-12 text-center">
          <Link to="/shop" className="btn btn-secondary">
            Continue Shopping
          </Link>
        </div>
      </div>
    </main>
  )
}

export default Wishlist
