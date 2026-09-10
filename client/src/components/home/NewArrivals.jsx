import { Link } from 'react-router-dom'
import { useProducts } from '../../context/ProductsContext.jsx'
import ProductCard from '../product/ProductCard.jsx'
import { ProductGridSkeleton, ProductLoadError } from '../product/ProductStates.jsx'

function NewArrivals() {
  const { getNewArrivals, loading, error, retry } = useProducts()
  const items = getNewArrivals(4)

  return (
    <section aria-labelledby="home-new-heading" className="bg-cream">
      <div className="clothza-container py-14 md:py-20">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="type-label">Just landed</p>
            <h2 id="home-new-heading" className="type-h2 mt-2">
              New Arrivals
            </h2>
          </div>
          <Link to="/shop" className="btn btn-secondary" aria-label="View all new arrivals">
            View All
          </Link>
        </div>

        {loading ? (
          <ProductGridSkeleton count={4} />
        ) : error ? (
          <ProductLoadError message={error} onRetry={retry} />
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-5 md:gap-6 lg:grid-cols-4">
            {items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export default NewArrivals
