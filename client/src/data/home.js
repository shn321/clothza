/* ============================================================
   CLOTHZA homepage content — TEMPORARY frontend demo data
   No database, no API. Replace image URLs with local assets
   or Cloudinary URLs later. Product shape mirrors the future
   MongoDB product document (image, name, price, ...).
   ============================================================ */

const img = (id, w = 1200) =>
  `https://images.unsplash.com/${id}?q=80&w=${w}&auto=format&fit=crop`

export const HERO_IMAGE = {
  src: img('photo-1469334031218-e382a71b716b', 1600),
  alt: 'Model wearing a timeless beige coat in soft daylight',
}

export const CATEGORIES = [
  {
    name: 'Men',
    to: '/men',
    image: img('photo-1617137968427-85924c800a22', 900),
    alt: 'Man wearing a minimal white shirt',
  },
  {
    name: 'Women',
    to: '/women',
    image: img('photo-1539109136881-3be0616acf4b', 900),
    alt: 'Woman wearing an elegant beige coat',
  },
  {
    name: 'Accessories',
    to: '/collections',
    image: img('photo-1553062407-98eeb64c6a62', 900),
    alt: 'Premium tan leather bag on a neutral background',
  },
]

/* Temporary demo products — visual demonstration only. */
export const DEMO_PRODUCTS = [
  {
    id: 'demo-tee',
    name: 'Essential Oversized Tee',
    price: 1499,
    image: img('photo-1521572163474-6864f9cf17ab', 800),
    alt: 'Essential oversized white tee on a clean background',
  },
  {
    id: 'demo-oxford',
    name: 'Relaxed Oxford Shirt',
    price: 2299,
    image: img('photo-1596755094514-f87e34085b2c', 800),
    alt: 'Relaxed white oxford shirt hanging in soft light',
  },
  {
    id: 'demo-trousers',
    name: 'Everyday Wide-Leg Trousers',
    price: 2499,
    image: img('photo-1541099649105-f69ad21f3246', 800),
    alt: 'Everyday wide-leg denim trousers folded neatly',
  },
  {
    id: 'demo-knit',
    name: 'Minimal Knit Top',
    price: 1799,
    originalPrice: 2199,
    image: img('photo-1434389677669-e08b4cac3105', 800),
    alt: 'Minimal knit tops hanging on a neutral rail',
  },
]

export const EDITORIAL_IMAGE = {
  src: img('photo-1445205170230-053b83016050', 1600),
  alt: 'Editorial view of a curated neutral clothing rail',
}

export const BRAND_VALUES = [
  {
    index: '01',
    title: 'Thoughtful Design',
    text: 'Designed with intention, made for everyday life.',
  },
  {
    index: '02',
    title: 'Quality First',
    text: 'Considered materials and details that last.',
  },
  {
    index: '03',
    title: 'Effortless Style',
    text: 'Versatile pieces made to work together.',
  },
]

export const formatINR = (value) => `₹${Number(value).toLocaleString('en-IN')}`
