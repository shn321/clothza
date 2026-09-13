import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSiteContent } from '../../hooks/useSiteContent.js'

function CategorySection() {
  const { content } = useSiteContent('homepage.collections')

  if (content?.enabled === false) return null

  const cards = Array.isArray(content?.cards) ? content.cards : []

  return (
    <section aria-labelledby="home-categories-heading" className="bg-ivory">
      <div className="clothza-container py-14 md:py-20">
        <div className="flex items-end justify-between gap-6">
          <div>
            {content?.eyebrow ? <p className="type-label">{content.eyebrow}</p> : null}
            <h2 id="home-categories-heading" className="type-h2 mt-2">
              {content?.heading || 'Shop by Category'}
            </h2>
            {content?.description ? (
              <p className="type-body-muted mt-2 max-w-xl">{content.description}</p>
            ) : null}
          </div>
          <Link
            to={content?.viewAllLink || '/collections'}
            className="type-nav hidden items-center gap-2 sm:inline-flex"
            aria-label="View all collections"
          >
            {content?.viewAllText || 'View all'}{' '}
            <ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-2 md:gap-6 lg:grid-cols-3">
          {cards.map((c) => (
            <Link
              key={c.title}
              to={c.link || '/collections'}
              className="group relative overflow-hidden rounded-[4px] border border-linen bg-porcelain"
              aria-label={`Explore ${c.title}`}
            >
              <img
                src={c.image}
                alt={c.imageAlt || c.title}
                loading="lazy"
                className="aspect-[3/4] w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
              />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-ivory/90 px-5 py-4 backdrop-blur">
                <span className="type-nav">{c.title}</span>
                <span className="inline-flex items-center gap-1 text-sm text-fog transition-colors duration-200 group-hover:text-charcoal">
                  {c.subtitle || 'Explore'}{' '}
                  <ArrowRight size={15} strokeWidth={1.5} aria-hidden="true" />
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

export default CategorySection
