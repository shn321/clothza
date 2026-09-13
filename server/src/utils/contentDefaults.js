/* CLOTHZA CMS defaults + validation.
   Single source of truth for every CMS-editable key. The same shapes
   are mirrored in client/src/data/defaultContent.js as safe fallbacks.
   Defaults reproduce the CURRENT hardcoded storefront so the site looks
   identical after CMS integration. */

const img = (id, w = 1200) =>
  `https://images.unsplash.com/${id}?q=80&w=${w}&auto=format&fit=crop`

export const CONTENT_KEYS = [
  'homepage.hero',
  'homepage.newArrivals',
  'homepage.collections',
  'homepage.promo',
  'homepage.values',
  'site.general',
  'site.newsletter',
  'site.footer',
  'site.pages',
]

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

/* ---------- validation helpers ---------- */

const MAX_SHORT = 200
const MAX_LONG = 2000
const MAX_URL = 2048

function str(v, max = MAX_SHORT) {
  const s = String(v ?? '').trim()
  if (s.length > max) return { tooLong: true, value: s.slice(0, max) }
  return { value: s }
}

function reqStr(v, max = MAX_SHORT) {
  const { value, tooLong } = str(v, max)
  if (!value) return { error: 'This field is required.' }
  if (tooLong) return { error: `Must be under ${max} characters.` }
  return { value }
}

function optStr(v, max = MAX_SHORT) {
  const { value, tooLong } = str(v, max)
  if (tooLong) return { error: `Must be under ${max} characters.` }
  return { value }
}

function optLong(v, max = MAX_LONG) {
  return optStr(v, max)
}

function isValidUrlOrPath(v) {
  const s = String(v ?? '').trim()
  if (!s || s.length > MAX_URL) return false
  if (s.startsWith('data:image/')) return s.length <= 7_000_000 // ~5MB base64
  return /^(https?:\/\/|\/).+/i.test(s)
}

function optImage(v) {
  const s = String(v ?? '').trim()
  if (!s) return { value: '' }
  if (!isValidUrlOrPath(s)) return { error: 'Must be a valid http(s) URL, site path (/...), or image data URL.' }
  return { value: s }
}

function reqImage(v) {
  const s = String(v ?? '').trim()
  if (!s) return { error: 'Image is required.' }
  return optImage(s)
}

function optLink(v) {
  const s = String(v ?? '').trim()
  if (!s) return { value: '' }
  if (s.length > MAX_URL) return { error: 'Link is too long.' }
  if (/^(https?:\/\/|\/|#|mailto:)/i.test(s)) return { value: s }
  return { error: 'Link must start with http(s)://, /, # or mailto:.' }
}

function reqLink(v) {
  const s = String(v ?? '').trim()
  if (!s) return { error: 'Link is required.' }
  return optLink(s)
}

function bool(v) {
  if (typeof v !== 'boolean') return { error: 'Must be true or false.' }
  return { value: v }
}

function optBool(v) {
  if (v === undefined) return { value: undefined }
  return bool(v)
}

function count(v, min = 1, max = 12) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) return { error: `Must be a whole number from ${min} to ${max}.` }
  return { value: n }
}

/* Per-key validators return { value } or { error }. Unknown fields are
   dropped so clients can never smuggle extra data into the document. */

function validateHero(b) {
  const o = {}
  const put = (k, r) => {
    if (r.error) throw new Error(`${k}: ${r.error}`)
    if (r.value !== undefined) o[k] = r.value
  }
  put('eyebrow', optStr(b.eyebrow))
  put('heading', reqStr(b.heading, 120))
  put('tagline', optStr(b.tagline, 120))
  put('description', optLong(b.description, 600))
  put('image', reqImage(b.image))
  put('imageAlt', optStr(b.imageAlt, 300))
  put('mobileImage', optImage(b.mobileImage))
  put('mobileImageAlt', optStr(b.mobileImageAlt, 300))
  put('primaryButtonText', reqStr(b.primaryButtonText, 80))
  put('primaryButtonLink', reqLink(b.primaryButtonLink))
  put('secondaryButtonText', optStr(b.secondaryButtonText, 80))
  put('secondaryButtonLink', optLink(b.secondaryButtonLink))
  const sbe = optBool(b.secondaryButtonEnabled)
  if (sbe.error) throw new Error(`secondaryButtonEnabled: ${sbe.error}`)
  if (sbe.value !== undefined) o.secondaryButtonEnabled = sbe.value
  const en = optBool(b.enabled)
  if (en.error) throw new Error(`enabled: ${en.error}`)
  if (en.value !== undefined) o.enabled = en.value
  return o
}

function validateLinkItem(item, i) {
  if (!item || typeof item !== 'object') throw new Error(`Item ${i + 1} is invalid.`)
  const label = reqStr(item.label, 60)
  if (label.error) throw new Error(`Item ${i + 1} label: ${label.error}`)
  const to = optLink(item.to ?? item.href ?? '')
  if (to.error) throw new Error(`Item ${i + 1} link: ${to.error}`)
  return { label: label.value, to: to.value || '#', ...(item.href ? { href: to.value || '#' } : {}) }
}

function validateCollectionCard(c, i) {
  if (!c || typeof c !== 'object') throw new Error(`Card ${i + 1} is invalid.`)
  const title = reqStr(c.title, 60)
  if (title.error) throw new Error(`Card ${i + 1} title: ${title.error}`)
  const subtitle = optStr(c.subtitle, 80)
  if (subtitle.error) throw new Error(`Card ${i + 1} subtitle: ${subtitle.error}`)
  const link = optLink(c.link ?? c.to ?? '')
  if (link.error) throw new Error(`Card ${i + 1} link: ${link.error}`)
  const image = reqImage(c.image)
  if (image.error) throw new Error(`Card ${i + 1} image: ${image.error}`)
  const alt = optStr(c.imageAlt ?? c.alt ?? '', 300)
  if (alt.error) throw new Error(`Card ${i + 1} alt: ${alt.error}`)
  return {
    title: title.value,
    subtitle: subtitle.value,
    link: link.value || '/collections',
    image: image.value,
    imageAlt: alt.value,
  }
}

const KEY_VALIDATORS = {
  'homepage.hero': validateHero,
  'homepage.newArrivals': (b) => {
    const o = {}
    const need = (k, r) => {
      if (r.error) throw new Error(`${k}: ${r.error}`)
      if (r.value !== undefined) o[k] = r.value
    }
    need('eyebrow', optStr(b.eyebrow))
    need('heading', reqStr(b.heading, 120))
    need('description', optLong(b.description, 600))
    need('viewAllText', optStr(b.viewAllText, 60))
    need('viewAllLink', optLink(b.viewAllLink))
    need('count', count(b.count ?? 4))
    const en = optBool(b.enabled)
    if (en.error) throw new Error(`enabled: ${en.error}`)
    if (en.value !== undefined) o.enabled = en.value
    return o
  },
  'homepage.collections': (b) => {
    const o = {}
    const need = (k, r) => {
      if (r.error) throw new Error(`${k}: ${r.error}`)
      if (r.value !== undefined) o[k] = r.value
    }
    need('eyebrow', optStr(b.eyebrow))
    need('heading', reqStr(b.heading, 120))
    need('description', optLong(b.description, 600))
    need('viewAllText', optStr(b.viewAllText, 60))
    need('viewAllLink', optLink(b.viewAllLink))
    if (!Array.isArray(b.cards)) throw new Error('cards: Must provide at least 1 card (max 6).')
    if (b.cards.length < 1 || b.cards.length > 6) throw new Error('cards: Must provide 1 to 6 cards.')
    o.cards = b.cards.map(validateCollectionCard)
    const en = optBool(b.enabled)
    if (en.error) throw new Error(`enabled: ${en.error}`)
    if (en.value !== undefined) o.enabled = en.value
    return o
  },
  'homepage.promo': (b) => {
    const o = {}
    const need = (k, r) => {
      if (r.error) throw new Error(`${k}: ${r.error}`)
      if (r.value !== undefined) o[k] = r.value
    }
    need('eyebrow', optStr(b.eyebrow))
    need('heading', reqStr(b.heading, 120))
    need('description', optLong(b.description, 800))
    need('image', reqImage(b.image))
    need('imageAlt', optStr(b.imageAlt, 300))
    need('mobileImage', optImage(b.mobileImage))
    need('mobileImageAlt', optStr(b.mobileImageAlt, 300))
    need('buttonText', reqStr(b.buttonText, 80))
    need('buttonLink', reqLink(b.buttonLink))
    const en = optBool(b.enabled)
    if (en.error) throw new Error(`enabled: ${en.error}`)
    if (en.value !== undefined) o.enabled = en.value
    return o
  },
  'homepage.values': (b) => {
    const o = {}
    const eb = optStr(b.eyebrow)
    if (eb.error) throw new Error(`eyebrow: ${eb.error}`)
    o.eyebrow = eb.value
    if (!Array.isArray(b.items)) throw new Error('items: Must provide 1 to 4 items.')
    if (b.items.length < 1 || b.items.length > 4) throw new Error('items: Must provide 1 to 4 items.')
    o.items = b.items.map((it, i) => {
      if (!it || typeof it !== 'object') throw new Error(`Item ${i + 1} is invalid.`)
      const title = reqStr(it.title, 80)
      if (title.error) throw new Error(`Item ${i + 1} title: ${title.error}`)
      const text = optLong(it.text, 400)
      if (text.error) throw new Error(`Item ${i + 1} text: ${text.error}`)
      const index = optStr(it.index, 10)
      if (index.error) throw new Error(`Item ${i + 1} index: ${index.error}`)
      return { index: index.value || String(i + 1).padStart(2, '0'), title: title.value, text: text.value }
    })
    const en = optBool(b.enabled)
    if (en.error) throw new Error(`enabled: ${en.error}`)
    if (en.value !== undefined) o.enabled = en.value
    return o
  },
  'site.general': (b) => {
    const fields = [
      'tagline',
      'introText',
      'shippingText',
      'returnsText',
      'customerCareText',
      'faqIntro',
      'aboutHeading',
      'aboutText',
      'contactHeading',
      'contactText',
    ]
    const o = {}
    for (const f of fields) {
      const r = f.endsWith('Text') || f === 'introText' ? optLong(b[f], 1000) : optStr(b[f], 200)
      if (r.error) throw new Error(`${f}: ${r.error}`)
      o[f] = r.value ?? ''
    }
    return o
  },
  'site.newsletter': (b) => {
    const o = {}
    const need = (k, r, maxNote) => {
      if (r.error) throw new Error(`${k}: ${r.error}`)
      o[k] = r.value ?? ''
    }
    need('eyebrow', optStr(b.eyebrow))
    const heading = reqStr(b.heading, 120)
    if (heading.error) throw new Error(`heading: ${heading.error}`)
    o.heading = heading.value
    need('description', optLong(b.description, 600))
    need('placeholder', optStr(b.placeholder, 80))
    need('buttonText', optStr(b.buttonText, 40))
    need('successMessage', optStr(b.successMessage, 200))
    const en = optBool(b.enabled)
    if (en.error) throw new Error(`enabled: ${en.error}`)
    if (en.value !== undefined) o.enabled = en.value
    return o
  },
  'site.footer': (b) => {
    const o = {}
    const need = (k, r) => {
      if (r.error) throw new Error(`${k}: ${r.error}`)
      o[k] = r.value ?? ''
    }
    need('brandName', optStr(b.brandName, 60))
    need('tagline', optStr(b.tagline, 160))
    need('description', optLong(b.description, 600))
    need('newsletterHeading', optStr(b.newsletterHeading, 120))
    need('newsletterDescription', optLong(b.newsletterDescription, 600))
    need('copyrightText', optStr(b.copyrightText, 200))
    for (const listKey of ['customerCareLinks', 'companyLinks', 'shopLinks']) {
      const arr = b[listKey]
      if (arr === undefined) {
        o[listKey] = []
        continue
      }
      if (!Array.isArray(arr)) throw new Error(`${listKey}: Must be a list of links.`)
      if (arr.length > 10) throw new Error(`${listKey}: Max 10 links.`)
      o[listKey] = arr.map((it, i) => {
        if (!it || typeof it !== 'object') throw new Error(`${listKey} item ${i + 1} is invalid.`)
        const label = reqStr(it.label, 60)
        if (label.error) throw new Error(`${listKey} item ${i + 1} label: ${label.error}`)
        const to = optLink(it.to ?? '#')
        if (to.error) throw new Error(`${listKey} item ${i + 1} link: ${to.error}`)
        return { label: label.value, to: to.value || '#' }
      })
    }
    const social = b.socialLinks
    if (social === undefined) {
      o.socialLinks = []
    } else {
      if (!Array.isArray(social)) throw new Error('socialLinks: Must be a list.')
      if (social.length > 8) throw new Error('socialLinks: Max 8 links.')
      o.socialLinks = social.map((it, i) => {
        if (!it || typeof it !== 'object') throw new Error(`socialLinks item ${i + 1} is invalid.`)
        const label = reqStr(it.label, 40)
        if (label.error) throw new Error(`socialLinks item ${i + 1} label: ${label.error}`)
        const href = optLink(it.href ?? '#')
        if (href.error) throw new Error(`socialLinks item ${i + 1} URL: ${href.error}`)
        return { label: label.value, href: href.value || '#' }
      })
    }
    return o
  },
  'site.pages': (b) => {
    const fields = [
      'aboutEyebrow',
      'aboutTitle',
      'aboutNote',
      'contactEyebrow',
      'contactTitle',
      'contactNote',
      'shippingEyebrow',
      'shippingTitle',
      'shippingNote',
      'returnsEyebrow',
      'returnsTitle',
      'returnsNote',
      'faqEyebrow',
      'faqTitle',
      'faqNote',
    ]
    const o = {}
    for (const f of fields) {
      const max = f.endsWith('Note') ? 600 : 120
      const r = f.endsWith('Note') ? optLong(b[f], max) : optStr(b[f], max)
      if (r.error) throw new Error(`${f}: ${r.error}`)
      o[f] = r.value ?? ''
    }
    return o
  },
}

export function isAllowedKey(key) {
  return CONTENT_KEYS.includes(key)
}

export function getDefaultContent(key) {
  const d = DEFAULT_CONTENT[key]
  return d ? JSON.parse(JSON.stringify(d)) : null
}

export function validateContent(key, body) {
  if (!isAllowedKey(key)) return { error: 'Unknown content key.' }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Content must be an object.' }
  }
  try {
    const value = KEY_VALIDATORS[key](body)
    return { value }
  } catch (err) {
    return { error: err?.message || 'Invalid content.' }
  }
}
