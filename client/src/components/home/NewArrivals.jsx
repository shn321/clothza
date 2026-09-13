import { Link } from 'react-router-dom'
import { useProducts } from '../../context/ProductsContext.jsx'
import { useSiteContent } from '../../hooks/useSiteContent.js'
import ProductCard from '../product/ProductCard.jsx'
import { ProductGridSkeleton, ProductLoadError } from '../product/ProductStates.jsx'

function NewArrivals() {
  const { getNewArrivals, loading, error, retry } = useProducts()
  const { content } = useSiteContent('homepage.newArrivals')

  if (content?.enabled === false) return null

  const count =
    Number.isInteger(content?.count) && content.count > 0 ? Math.min(content.count, 12) : 4
  const items = getNewArrivals(count)

  return (
    <section aria-labelledby="home-new-heading" className="bg-cream">
      <div className="clothza-container py-14 md:py-20">
        <div className="flex items-end justify-between gap-6">
          <div>
            {content?.eyebrow ? <p className="type-label">{content.eyebrow}</p> : null}
            <h2 id="home-new-heading" className="type-h2 mt-2">
              {content?.heading || 'New Arrivals'}
            </h2>
            {content?.description ? (
              <p className="type-body-muted mt-2 max-w-xl">{content.description}</p>
            ) : null}
          </div>
          <Link
            to={content?.viewAllLink || '/shop'}
            className="btn btn-secondary"
            aria-label="View all new arrivals"
          >
            {content?.viewAllText || 'View All'}
          </Link>
        </div>

        {loading ? (
          <ProductGridSkeleton count={count} />
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
