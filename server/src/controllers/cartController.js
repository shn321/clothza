import Cart, { cartLineKey, maxQtyForStock } from '../models/Cart.js'
import { findProductByRef, frontendProductId } from '../utils/catalog.js'

/* CLOTHZA database cart (Step 13) — authenticated users only.
   The user ALWAYS comes from the JWT session (req.user); a userId from
   the request body/query is never accepted, so users can only ever touch
   their own cart. Product price/name/image/sizes/colors/stock are ALWAYS
   re-read from MongoDB — frontend product fields are never trusted. */

const EMPTY_CART = { items: [], count: 0, subtotal: 0 }

/* ---- input helpers ---- */

function normVariant(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function pickSize(source) {
  return normVariant(source?.size)
}

function pickColour(source) {
  return normVariant(source?.colour ?? source?.color)
}

function badRequest(res, message) {
  return res.status(400).json({ success: false, message })
}

/* Validate size/colour against the product document.
   Mirrors the ProductDetail rules: size is required (and must be a real
   option) only when the product defines sizes; colour is free-form only
   when the product defines no color list. Returns { size, colour }. */
function validateVariant(product, size, colour) {
  const sizes = Array.isArray(product.sizes) ? product.sizes : []
  const colors = Array.isArray(product.colors) ? product.colors : []
  let finalSize = size
  if (sizes.length > 0) {
    if (!finalSize) {
      const err = new Error('Please select a size')
      err.statusCode = 400
      throw err
    }
    if (!sizes.includes(finalSize)) {
      const err = new Error('Invalid size for this product')
      err.statusCode = 400
      throw err
    }
  } else {
    finalSize = null
  }
  let finalColour = colour
  if (finalColour && colors.length > 0 && !colors.includes(finalColour)) {
    const err = new Error('Invalid colour for this product')
    err.statusCode = 400
    throw err
  }
  return { size: finalSize, colour: finalColour }
}

function parseQty(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (!Number.isInteger(n)) {
    const err = new Error('Quantity must be an integer')
    err.statusCode = 400
    throw err
  }
  if (n < 1) {
    const err = new Error('Quantity must be at least 1')
    err.statusCode = 400
    throw err
  }
  return n
}

/* ---- normalization (frontend cart-line shape) ---- */

function normalizeLine(item, stock) {
  const max = maxQtyForStock(stock)
  return {
    key: cartLineKey(item.productId, item.size, item.colour),
    productId: item.productId,
    slug: item.slug,
    name: item.name,
    image: item.image || '',
    price: item.price,
    size: item.size || null,
    colour: item.colour || null,
    max,
    qty: Math.min(item.qty, max),
  }
}

async function cartPayload(cart) {
  if (!cart) return { ...EMPTY_CART }
  await cart.populate({ path: 'items.product', select: 'stock' })
  const items = (cart.items || []).map((item) =>
    normalizeLine(item, item.product?.stock),
  )
  const count = items.reduce((n, l) => n + l.qty, 0)
  const subtotal = items.reduce((n, l) => n + l.qty * l.price, 0)
  return { items, count, subtotal }
}

async function getOrCreateCart(userId) {
  let cart = await Cart.findOne({ user: userId })
  if (!cart) cart = await Cart.create({ user: userId, items: [] })
  return cart
}

/* Add (or merge) one validated product line into the cart document.
   Same productId + size + colour combines quantities (clamped to the
   stock-aware line max); different variants stay separate lines. */
function upsertLine(cart, product, variant, qty) {
  const productId = frontendProductId(product)
  const lineMax = maxQtyForStock(product.stock)
  const wanted = Math.min(qty, lineMax)
  const existing = cart.items.find(
    (l) => l.productId === productId && (l.size || null) === variant.size && (l.colour || null) === variant.colour,
  )
  if (existing) {
    existing.qty = Math.min(existing.qty + wanted, lineMax)
    // Refresh snapshot from the live product document.
    existing.slug = product.slug
    existing.name = product.name
    existing.image = product.images?.[0] || ''
    existing.price = product.price
    existing.product = product._id
  } else {
    cart.items.push({
      product: product._id,
      productId,
      slug: product.slug,
      name: product.name,
      image: product.images?.[0] || '',
      price: product.price,
      size: variant.size,
      colour: variant.colour,
      qty: wanted,
    })
  }
}

/* Find lines for :productId, disambiguated by optional size/colour.
   Returns { line } or sends the error response and returns null. */
function findLine(cart, productId, size, colour, res) {
  const specified = size !== undefined || colour !== undefined
  const candidates = cart.items.filter(
    (l) =>
      l.productId === productId &&
      (size === undefined || (l.size || null) === size) &&
      (colour === undefined || (l.colour || null) === colour),
  )
  if (candidates.length === 0) {
    res.status(404).json({ success: false, message: 'Item not found in cart' })
    return null
  }
  if (candidates.length > 1 && !specified) {
    res.status(400).json({
      success: false,
      message: 'Multiple variants in cart — please specify size and colour',
    })
    return null
  }
  if (candidates.length > 1) {
    res.status(404).json({ success: false, message: 'Item not found in cart' })
    return null
  }
  return candidates[0]
}

/* ---- handlers ---- */

/* GET /api/cart */
export async function getCart(req, res, next) {
  try {
    const cart = await Cart.findOne({ user: req.user._id })
    return res.status(200).json({ success: true, data: await cartPayload(cart) })
  } catch (err) {
    return next(err)
  }
}

/* POST /api/cart/items — { productId | slug, size?, colour?|color?, qty? } */
export async function addCartItem(req, res, next) {
  try {
    const ref = req.body?.productId ?? req.body?.slug ?? req.body?.id
    const product = await findProductByRef(ref)
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' })
    }
    let variant
    try {
      variant = validateVariant(product, pickSize(req.body), pickColour(req.body))
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message })
    }
    let qty = 1
    if (req.body?.qty !== undefined) {
      try {
        qty = parseQty(req.body.qty)
      } catch (err) {
        return badRequest(res, err.message)
      }
    }
    const cart = await getOrCreateCart(req.user._id)
    upsertLine(cart, product, variant, qty)
    await cart.save()
    return res.status(200).json({ success: true, data: await cartPayload(cart) })
  } catch (err) {
    return next(err)
  }
}

/* PATCH /api/cart/items/:productId — { qty, size?, colour? }.
   qty 0 removes the line. */
export async function updateCartItem(req, res, next) {
  try {
    if (req.body?.qty === undefined) {
      return badRequest(res, 'Quantity is required')
    }
    const rawQty = req.body.qty
    const n = typeof rawQty === 'string' && rawQty.trim() !== '' ? Number(rawQty) : rawQty
    if (!Number.isInteger(n)) return badRequest(res, 'Quantity must be an integer')
    if (n < 0) return badRequest(res, 'Quantity must be at least 0')

    const product = await findProductByRef(req.params.productId)
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' })
    }
    const productId = frontendProductId(product)
    const cart = await Cart.findOne({ user: req.user._id })
    if (!cart) {
      return res.status(404).json({ success: false, message: 'Item not found in cart' })
    }
    const size = req.body?.size !== undefined ? pickSize(req.body) : undefined
    const colour =
      req.body?.colour !== undefined || req.body?.color !== undefined ? pickColour(req.body) : undefined
    const line = findLine(cart, productId, size, colour, res)
    if (!line) return undefined

    if (n === 0) {
      cart.items = cart.items.filter((l) => l !== line)
    } else {
      line.qty = Math.min(n, maxQtyForStock(product.stock))
      line.slug = product.slug
      line.name = product.name
      line.image = product.images?.[0] || ''
      line.price = product.price
      line.product = product._id
    }
    await cart.save()
    return res.status(200).json({ success: true, data: await cartPayload(cart) })
  } catch (err) {
    return next(err)
  }
}

/* DELETE /api/cart/items/:productId[?size=&colour=] */
export async function removeCartItem(req, res, next) {
  try {
    const product = await findProductByRef(req.params.productId)
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' })
    }
    const productId = frontendProductId(product)
    const cart = await Cart.findOne({ user: req.user._id })
    if (!cart) {
      return res.status(404).json({ success: false, message: 'Item not found in cart' })
    }
    const hasVariantQuery =
      req.query?.size !== undefined || req.query?.colour !== undefined || req.query?.color !== undefined ||
      req.body?.size !== undefined || req.body?.colour !== undefined || req.body?.color !== undefined
    const source = {
      size: req.query?.size ?? req.body?.size,
      colour: req.query?.colour ?? req.query?.color ?? req.body?.colour ?? req.body?.color,
    }
    const line = findLine(
      cart,
      productId,
      hasVariantQuery ? pickSize(source) : undefined,
      hasVariantQuery ? pickColour(source) : undefined,
      res,
    )
    if (!line) return undefined
    cart.items = cart.items.filter((l) => l !== line)
    await cart.save()
    return res.status(200).json({ success: true, data: await cartPayload(cart) })
  } catch (err) {
    return next(err)
  }
}

/* DELETE /api/cart — clear the authenticated user's cart. */
export async function clearCart(req, res, next) {
  try {
    await Cart.findOneAndDelete({ user: req.user._id })
    return res.status(200).json({ success: true, data: { ...EMPTY_CART } })
  } catch (err) {
    return next(err)
  }
}

/* POST /api/cart/merge — { items: [{ productId, size?, colour?, qty? }] }.
   Guest-local cart merged into the database cart on login: same
   productId + size + colour combines quantities (stock-clamped),
   different variants stay separate. Invalid lines are skipped and
   reported — never fail the whole merge. */
export async function mergeCart(req, res, next) {
  try {
    const incoming = Array.isArray(req.body?.items) ? req.body.items : null
    if (!incoming) {
      return badRequest(res, 'Items array is required')
    }
    const cart = await getOrCreateCart(req.user._id)
    let merged = 0
    let skipped = 0
    for (const entry of incoming.slice(0, 200)) {
      try {
        const ref = entry?.productId ?? entry?.slug ?? entry?.id
        const product = await findProductByRef(ref)
        if (!product) {
          skipped += 1
          continue
        }
        const variant = validateVariant(product, pickSize(entry), pickColour(entry))
        const qty = entry?.qty === undefined ? 1 : parseQty(entry.qty)
        upsertLine(cart, product, variant, qty)
        merged += 1
      } catch {
        skipped += 1
      }
    }
    await cart.save()
    const data = await cartPayload(cart)
    return res.status(200).json({ success: true, data: { ...data, merged, skipped } })
  } catch (err) {
    return next(err)
  }
}
