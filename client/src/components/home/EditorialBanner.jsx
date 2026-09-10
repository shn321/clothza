import { Link } from 'react-router-dom'
import { EDITORIAL_IMAGE } from '../../data/home.js'

function EditorialBanner() {
  return (
    <section aria-labelledby="home-editorial-heading" className="bg-ivory">
      <div className="clothza-container grid items-center gap-10 py-14 md:py-24 lg:grid-cols-2 lg:gap-16">
        <div className="overflow-hidden rounded-[4px] border border-linen bg-porcelain">
          <img
            src={EDITORIAL_IMAGE.src}
            alt={EDITORIAL_IMAGE.alt}
            loading="lazy"
            className="aspect-[4/3] w-full object-cover lg:aspect-[4/5]"
          />
        </div>
        <div className="max-w-lg">
          <p className="type-label">The everyday edit</p>
          <h2 id="home-editorial-heading" className="type-h1 mt-3">
            Made for Every Day.
          </h2>
          <p className="type-body-muted mt-5">
            Thoughtful silhouettes, refined textures and effortless pieces
            designed to move with you.
          </p>
          <Link to="/collections" className="btn btn-primary mt-8">
            Discover the Collection
          </Link>
        </div>
      </div>
    </section>
  )
}

export default EditorialBanner
