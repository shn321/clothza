/* Scoring helpers work on any product list in the frontend shape
   (see lib/api.js normalizeProduct). The runtime list comes from the
   API-backed catalog — never import a hardcoded list here. */

const CATEGORY_LABEL = { men: 'Men', women: 'Women', accessories: 'Accessories' }

export const getCategoryLabel = (category) => CATEGORY_LABEL[category] || category || ''

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
}

function tokenize(query) {
  return normalize(query).split(/[^a-z0-9]+/).filter(Boolean)
}

function wordsOf(value) {
  return normalize(value).split(/[^a-z0-9]+/).filter(Boolean)
}

/* Word-prefix matching keeps live typing useful ("blaz" -> "blazer",
   "jean" -> "jeans") without substring false positives ("men" must not
   match "women" or "everything"). Single-char tokens require an exact
   word so "t-shirt" -> ["t","shirt"] doesn't match every "t*" word. */
function wordMatches(words, token) {
  if (!token) return false
  if (token.length === 1) return words.includes(token)
  return words.some((w) => w === token || w.startsWith(token))
}

/* Build one searchable haystack per product: name, category (+label),
   subcategory, tags, colors, description. */
function haystackWordsFor(product) {
  return wordsOf(
    [
      product.name,
      product.category,
      getCategoryLabel(product.category),
      product.subcategory,
      (product.tags || []).join(' '),
      (product.colors || []).join(' '),
      product.description,
    ].join(' '),
  )
}

function scoreProduct(product, tokens) {
  const nameWords = wordsOf(product.name)
  const subcategoryWords = wordsOf(product.subcategory)
  const tagWords = wordsOf((product.tags || []).join(' '))
  const categoryWords = wordsOf(
    `${product.category || ''} ${getCategoryLabel(product.category)}`,
  )
  const colorWords = wordsOf((product.colors || []).join(' '))
  const descriptionWords = wordsOf(product.description)
  const allWords = haystackWordsFor(product)

  let score = 0
  for (const token of tokens) {
    if (!token) continue
    if (wordMatches(nameWords, token)) {
      score += normalize(product.name).startsWith(token) ? 12 : 10
    } else if (wordMatches(subcategoryWords, token)) score += 7
    else if (wordMatches(tagWords, token)) score += 6
    else if (wordMatches(categoryWords, token)) score += 5
    else if (wordMatches(colorWords, token)) score += 4
    else if (wordMatches(descriptionWords, token)) score += 2
    else if (!wordMatches(allWords, token)) return -1 // AND semantics
    else score += 2
  }

  // Tie-breakers: bestsellers / featured / rating surface better matches first.
  if (product.isBestSeller) score += 1.5
  if (product.isFeatured) score += 1
  if (product.isNewArrival) score += 0.5
  score += Math.min(Number(product.rating) || 0, 5) / 10
  return score
}

/* Client-side search over a product list (fallback when the API search
   is unreachable). Matches every query token against name, category,
   subcategory, tags, colors and description. Returns best matches first. */
export function searchProducts(query, list = [], limit = 7) {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  const scored = []
  for (const product of list) {
    // Cheap pre-filter before scoring.
    const allWords = haystackWordsFor(product)
    const matchesAll = tokens.every((t) => wordMatches(allWords, t))
    if (!matchesAll) continue
    const score = scoreProduct(product, tokens)
    if (score >= 0) scored.push({ product, score })
  }
  scored.sort((a, b) => b.score - a.score)
  const sliced =
    typeof limit === 'number' && limit > 0 ? scored.slice(0, limit) : scored
  return sliced.map((s) => s.product)
}

export const POPULAR_SEARCHES = ['Denim', 'Knit', 'Tote', 'Blazer', 'Dress', 'Cotton']

export function getPopularProducts(limit = 3, list = []) {
  return list.filter((p) => p.isBestSeller).slice(0, limit)
}

/* Enter-key navigation for the search overlay.
   Exact navigation keywords resolve to existing pages; everything else
   falls through to the Shop results page with the term preserved in the
   URL (?q=) so it survives refresh/share. Returns null for empty queries
   (Enter then does nothing). */
export function resolveSearchNavigation(query) {
  const raw = String(query || '').trim()
  if (!raw) return null
  const key = raw
    .toLowerCase()
    .replace(/[’‘'']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

  switch (key) {
    case 'men':
    case 'mens':
    case 'man':
      return '/men'
    case 'women':
    case 'womens':
    case 'woman':
      return '/women'
    case 'new arrivals':
    case 'new arrival':
    case 'new season':
      return '/new-arrivals'
    case 'collections':
    case 'collection':
      return '/collections'
    case 'shop':
    case 'all':
    case 'all products':
    case 'products':
      return '/shop'
    case 'accessories':
    case 'accessory':
      return '/shop?category=accessories'
    default:
      return `/shop?q=${encodeURIComponent(raw)}`
  }
}
