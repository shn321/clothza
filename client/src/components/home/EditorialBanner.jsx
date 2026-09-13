import { Link } from 'react-router-dom'
import { useSiteContent } from '../../hooks/useSiteContent.js'

function EditorialBanner() {
  const { content: promo } = useSiteContent('homepage.promo')

  if (promo?.enabled === false) return null

  const desktopSrc = promo?.image || ''
  const mobileSrc = promo?.mobileImage || desktopSrc
  const alt = promo?.imageAlt || 'CLOTHZA editorial image'

  return (
    <section aria-labelledby="home-editorial-heading" className="bg-ivory">
      <div className="clothza-container grid items-center gap-10 py-14 md:py-24 lg:grid-cols-2 lg:gap-16">
        <div className="overflow-hidden rounded-[4px] border border-linen bg-porcelain">
          <picture>
            {mobileSrc && mobileSrc !== desktopSrc ? (
              <source media="(max-width: 640px)" srcSet={mobileSrc} />
            ) : null}
            <img
              src={desktopSrc}
              alt={alt}
              loading="lazy"
              className="aspect-[4/3] w-full object-cover lg:aspect-[4/5]"
            />
          </picture>
        </div>
        <div className="max-w-lg">
          {promo?.eyebrow ? <p className="type-label">{promo.eyebrow}</p> : null}
          <h2 id="home-editorial-heading" className="type-h1 mt-3">
            {promo?.heading || 'Made for Every Day.'}
          </h2>
          {promo?.description ? (
            <p className="type-body-muted mt-5">{promo.description}</p>
          ) : null}
          {promo?.buttonText ? (
            <Link to={promo.buttonLink || '/collections'} className="btn btn-primary mt-8">
              {promo.buttonText}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default EditorialBanner
