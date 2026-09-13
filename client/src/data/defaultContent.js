/* CLOTHZA CMS client defaults — safe fallbacks mirroring the server
   factory defaults (server/src/utils/contentDefaults.js). The storefront
   renders these instantly, then swaps in live CMS content when the API
   responds. If the API fails, the site keeps looking exactly as before. */

const img = (id, w = 1200) =>
  `https://images.unsplash.com/${id}?q=80&w=${w}&auto=format&fit=crop`

export const DEFAULT_CONTENT = {
  'homepage.hero': {
    enabled: true,
    eyebrow: 'New season essentials',
    heading: 'CLOTHZA',
    tagline: 'Style Made Simple.',
    description: 'Timeless essentials designed for the way you live.',
    image: img('photo-1469334031218-e382a71b716b', 1600),
    imageAlt: 'Model wearing a timeless beige coat in soft daylight',
    mobileImage: img('photo-1469334031218-e382a71b716b', 900),
    mobileImageAlt: 'Model wearing a timeless beige coat in soft daylight',
    primaryButtonText: 'Shop New Arrivals',
    primaryButtonLink: '/shop?sort=newest',
    secondaryButtonText: 'Explore Collections',
    secondaryButtonLink: '/collections',
    secondaryButtonEnabled: true,
  },
  'homepage.newArrivals': {
    enabled: true,
    eyebrow: 'Just landed',
    heading: 'New Arrivals',
    description: '',
    viewAllText: 'View All',
    viewAllLink: '/shop',
    count: 4,
  },
  'homepage.collections': {
    enabled: true,
    eyebrow: 'Curated paths',
    heading: 'Shop by Category',
    description: '',
    viewAllText: 'View all',
    viewAllLink: '/collections',
    cards: [
      {
        title: 'Men',
        subtitle: 'Explore',
        link: '/men',
        image: img('photo-1617137968427-85924c800a22', 900),
        imageAlt: 'Man wearing a minimal white shirt',
      },
      {
        title: 'Women',
        subtitle: 'Explore',
        link: '/women',
        image: img('photo-1539109136881-3be0616acf4b', 900),
        imageAlt: 'Woman wearing an elegant beige coat',
      },
      {
        title: 'Accessories',
        subtitle: 'Explore',
        link: '/collections',
        image: img('photo-1553062407-98eeb64c6a62', 900),
        imageAlt: 'Premium tan leather bag on a neutral background',
      },
    ],
  },
  'homepage.promo': {
    enabled: true,
    eyebrow: 'The everyday edit',
    heading: 'Made for Every Day.',
    description:
      'Thoughtful silhouettes, refined textures and effortless pieces designed to move with you.',
    image: img('photo-1445205170230-053b83016050', 1600),
    imageAlt: 'Editorial view of a curated neutral clothing rail',
    mobileImage: img('photo-1445205170230-053b83016050', 900),
    mobileImageAlt: 'Editorial view of a curated neutral clothing rail',
    buttonText: 'Discover the Collection',
    buttonLink: '/collections',
  },
  'homepage.values': {
    enabled: true,
    eyebrow: 'Why Clothza',
    items: [
      { index: '01', title: 'Thoughtful Design', text: 'Designed with intention, made for everyday life.' },
      { index: '02', title: 'Quality First', text: 'Considered materials and details that last.' },
      { index: '03', title: 'Effortless Style', text: 'Versatile pieces made to work together.' },
    ],
  },
  'site.general': {
    tagline: 'Style Made Simple.',
    introText: 'Timeless essentials designed for the way you live.',
    shippingText: 'Free shipping on orders over ₹999. Dispatched in 24–48 hours.',
    returnsText: 'Easy 7-day returns. No questions asked.',
    customerCareText: 'Write to care@clothza.example — we reply within 24 hours.',
    faqIntro: 'Answers to the questions our customers ask most often.',
    aboutHeading: 'About CLOTHZA',
    aboutText: 'Thoughtfully designed essentials for modern everyday style.',
    contactHeading: 'Contact',
    contactText: 'Minimal placeholder. Contact page comes later.',
  },
  'site.newsletter': {
    enabled: true,
    eyebrow: 'Newsletter',
    heading: 'Stay in the know.',
    description: 'Be the first to discover new arrivals, collections and exclusive offers.',
    placeholder: 'you@example.com',
    buttonText: 'Subscribe',
    successMessage: "You're on the list. Welcome to CLOTHZA.",
  },
  'site.footer': {
    brandName: 'CLOTHZA',
    tagline: 'Style Made Simple.',
    description: 'Thoughtfully designed essentials for modern everyday style.',
    newsletterHeading: 'Join the CLOTHZA list',
    newsletterDescription: 'Updates on new collections and private offers. No noise, unsubscribe anytime.',
    customerCareLinks: [
      { label: 'Contact', to: '/contact' },
      { label: 'Shipping', to: '/shipping' },
      { label: 'Returns', to: '/returns' },
      { label: 'FAQ', to: '/faq' },
    ],
    companyLinks: [
      { label: 'About', to: '/about' },
      { label: 'Privacy', to: '/privacy' },
      { label: 'Terms', to: '/terms' },
    ],
    shopLinks: [
      { label: 'New Arrivals', to: '/shop?sort=newest' },
      { label: 'Men', to: '/men' },
      { label: 'Women', to: '/women' },
      { label: 'Collections', to: '/collections' },
    ],
    socialLinks: [
      { label: 'Instagram', href: '#' },
      { label: 'Facebook', href: '#' },
      { label: 'X', href: '#' },
    ],
    copyrightText: '© 2026 CLOTHZA. All rights reserved.',
  },
  'site.pages': {
    aboutEyebrow: 'About',
    aboutTitle: 'About',
    aboutNote: 'Minimal placeholder. About page comes later.',
    contactEyebrow: 'Contact',
    contactTitle: 'Contact',
    contactNote: 'Minimal placeholder. Contact page comes later.',
    shippingEyebrow: 'Shipping',
    shippingTitle: 'Shipping',
    shippingNote: 'Minimal placeholder. Shipping info comes later.',
    returnsEyebrow: 'Returns',
    returnsTitle: 'Returns',
    returnsNote: 'Minimal placeholder. Returns info comes later.',
    faqEyebrow: 'FAQ',
    faqTitle: 'FAQ',
    faqNote: 'Minimal placeholder. FAQ page comes later.',
  },
}

export function getDefaultContent(key) {
  const d = DEFAULT_CONTENT[key]
  return d ? JSON.parse(JSON.stringify(d)) : null
}
