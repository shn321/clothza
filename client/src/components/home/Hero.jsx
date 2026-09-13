import { Link } from 'react-router-dom'
import { useSiteContent } from '../../hooks/useSiteContent.js'

function Hero() {
  const { content: hero } = useSiteContent('homepage.hero')

  if (hero?.enabled === false) return null

  const desktopSrc = hero?.image || ''
  const mobileSrc = hero?.mobileImage || desktopSrc
  const alt = hero?.imageAlt || 'CLOTHZA hero image'
  const mobileAlt = hero?.mobileImageAlt || alt

  return (
    <section aria-labelledby="home-hero-heading" className="bg-ivory">
      <div className="clothza-container grid items-center gap-10 py-12 md:py-20 lg:grid-cols-2 lg:gap-16">
        <div className="hero-entrance max-w-xl">
          {hero?.eyebrow ? <p className="type-label">{hero.eyebrow}</p> : null}
          <h1 id="home-hero-heading" className="type-display mt-4">
            {hero?.heading || 'CLOTHZA'}
          </h1>
          {hero?.tagline ? <p className="type-tagline mt-3">{hero.tagline}</p> : null}
          {hero?.description ? (
            <p className="type-body-muted mt-5 max-w-md">{hero.description}</p>
          ) : null}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            {hero?.primaryButtonText ? (
              <Link to={hero.primaryButtonLink || '/shop'} className="btn btn-primary">
                {hero.primaryButtonText}
              </Link>
            ) : null}
            {hero?.secondaryButtonEnabled !== false && hero?.secondaryButtonText ? (
              <Link to={hero.secondaryButtonLink || '/collections'} className="btn btn-secondary">
                {hero.secondaryButtonText}
              </Link>
            ) : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-[4px] border border-linen bg-porcelain">
          <picture>
            {mobileSrc && mobileSrc !== desktopSrc ? (
              <source media="(max-width: 640px)" srcSet={mobileSrc} />
            ) : null}
            <img
              src={desktopSrc}
              alt={alt}
              data-mobile-alt={mobileAlt}
              fetchPriority="high"
              className="aspect-[4/5] w-full object-cover sm:aspect-[5/5] lg:aspect-[4/5]"
            />
          </picture>
        </div>
      </div>
    </section>
  )
}

export default Hero
