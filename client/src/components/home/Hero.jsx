import { Link } from 'react-router-dom'
import { HERO_IMAGE } from '../../data/home.js'

function Hero() {
  return (
    <section aria-labelledby="home-hero-heading" className="bg-ivory">
      <div className="clothza-container grid items-center gap-10 py-12 md:py-20 lg:grid-cols-2 lg:gap-16">
        <div className="hero-entrance max-w-xl">
          <p className="type-label">New season essentials</p>
          <h1 id="home-hero-heading" className="type-display mt-4">
            CLOTHZA
          </h1>
          <p className="type-tagline mt-3">Style Made Simple.</p>
          <p className="type-body-muted mt-5 max-w-md">
            Timeless essentials designed for the way you live.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link to="/shop?sort=newest" className="btn btn-primary">
              Shop New Arrivals
            </Link>
            <Link to="/collections" className="btn btn-secondary">
              Explore Collections
            </Link>
          </div>
        </div>

        <div className="overflow-hidden rounded-[4px] border border-linen bg-porcelain">
          <img
            src={HERO_IMAGE.src}
            alt={HERO_IMAGE.alt}
            fetchpriority="high"
            className="aspect-[4/5] w-full object-cover sm:aspect-[5/5] lg:aspect-[4/5]"
          />
        </div>
      </div>
    </section>
  )
}

export default Hero
