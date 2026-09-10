import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useProducts } from '../context/ProductsContext.jsx'
import { CATEGORIES } from '../data/home.js'

const categoryImage = (name) => CATEGORIES.find((c) => c.name === name)?.image || ''
const categoryAlt = (name) => CATEGORIES.find((c) => c.name === name)?.alt || `${name} collection`

function Collections() {
  const { products, loading } = useProducts()
  const countBy = (fn) => products.filter(fn).length

  const collections = [
    {
      name: 'New Season',
      description: 'The latest arrivals, refreshed for the season.',
      to: '/shop?sort=newest',
      count: countBy((p) => p.isNewArrival),
      image: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?q=80&w=900&auto=format&fit=crop',
      alt: 'Model wearing a new-season wrap dress',
    },
    {
      name: 'Bestsellers',
      description: 'The pieces our community reaches for most.',
      to: '/shop?sort=rating',
      count: countBy((p) => p.isBestSeller),
      image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?q=80&w=900&auto=format&fit=crop',
      alt: 'Bestselling canvas backpack on a neutral background',
    },
    {
      name: 'Men',
      description: 'Tailored staples and everyday staples for him.',
      to: '/men',
      count: countBy((p) => p.category === 'men'),
      image: categoryImage('Men'),
      alt: categoryAlt('Men'),
    },
    {
      name: 'Women',
      description: 'Fluid silhouettes and considered details for her.',
      to: '/women',
      count: countBy((p) => p.category === 'women'),
      image: categoryImage('Women'),
      alt: categoryAlt('Women'),
    },
    {
      name: 'Accessories',
      description: 'Finishing touches in leather, canvas and acetate.',
      to: '/shop?category=accessories',
      count: countBy((p) => p.category === 'accessories'),
      image: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?q=80&w=900&auto=format&fit=crop',
      alt: 'Leather crossbody bag from the accessories collection',
    },
    {
      name: 'Essentials',
      description: 'The timeless core of the CLOTHZA wardrobe.',
      to: '/shop',
      count: countBy((p) => p.tags.includes('essentials')),
      image: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?q=80&w=900&auto=format&fit=crop',
      alt: 'Essential white oxford shirt in soft light',
    },
  ]

  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container py-12 md:py-16">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="type-label">Curated edits</p>
          <h1 className="type-h1 mt-2">Collections</h1>
          <p className="type-body-muted mt-3">
            Considered edits for every wardrobe — explore by mood, moment or staple.
          </p>
        </div>

        {/* Collection grid */}
        <div className="mt-10 grid gap-5 sm:grid-cols-2 md:gap-6 lg:grid-cols-3">
          {collections.map((c) => (
            <Link
              key={c.name}
              to={c.to}
              className="group flex flex-col overflow-hidden rounded-[4px] border border-linen bg-porcelain"
              aria-label={`Explore the ${c.name} collection, ${c.count} pieces`}
            >
              <span className="block overflow-hidden">
                <img
                  src={c.image}
                  alt={c.alt}
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                />
              </span>
              <span className="flex flex-1 flex-col gap-1 p-5">
                <span className="type-label" aria-live="polite">
                  {loading ? 'Counting pieces…' : `${c.count} ${c.count === 1 ? 'piece' : 'pieces'}`}
                </span>
                <span className="type-h3 mt-1">{c.name}</span>
                <span className="type-small mt-1">{c.description}</span>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-charcoal">
                  Explore
                  <ArrowRight size={15} strokeWidth={1.5} aria-hidden="true" />
                </span>
              </span>
            </Link>
          ))}
        </div>

        {/* Closing CTA */}
        <div className="mx-auto mt-12 flex w-full max-w-xl flex-col items-center gap-4 text-center">
          <p className="type-body-muted">
            Looking for everything in one place?
          </p>
          <Link to="/shop" className="btn btn-primary">
            Shop the Full Collection
          </Link>
        </div>
      </div>
    </main>
  )
}

export default Collections
