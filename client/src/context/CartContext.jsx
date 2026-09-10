import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  addCartItem as apiAddItem,
  clearCartServer,
  fetchCart,
  mergeCartServer,
  removeCartItem as apiRemoveItem,
  updateCartItem as apiUpdateItem,
} from '../lib/api.js'
import { useAuth } from './AuthContext.jsx'

/* CLOTHZA cart store — dual mode (Step 13).
   Guest users: localStorage only, exactly as before.
   Authenticated users: MongoDB is the source of truth via the API;
   on login the guest-local cart is merged into the database cart
   (same product + size + colour combines quantities, stock-clamped)
   and the guest key is cleared ONLY after the server confirms.
   On logout the database cart stays in MongoDB and the store falls
   back to the guest-local cart — local writes never touch the DB.
   Line identity = product + size + colour, so re-adding the same
   variant increases quantity instead of duplicating the line.
   Public API (items/count/subtotal/addItem/updateQty/removeItem/
   clearCart) is unchanged; `syncing`/`error` are additive. */

const STORAGE_KEY = 'clothza-cart-v1'
const MAX_PER_LINE = 10

const CartContext = createContext(null)

const lineKey = (productId, size, colour) =>
  `${productId}|${size || ''}|${colour || ''}`

const clampQty = (qty, max) => Math.min(Math.max(1, Number(qty) || 1), Math.max(1, max || MAX_PER_LINE))

function sanitize(stored) {
  if (!Array.isArray(stored)) return []
  const lines = []
  for (const l of stored) {
    if (
      !l ||
      typeof l.productId !== 'string' ||
      typeof l.name !== 'string' ||
      typeof l.price !== 'number' ||
      typeof l.qty !== 'number'
    ) {
      continue
    }
    const max = typeof l.max === 'number' && l.max > 0 ? l.max : MAX_PER_LINE
    lines.push({
      key: typeof l.key === 'string' ? l.key : lineKey(l.productId, l.size, l.colour),
      productId: l.productId,
      slug: typeof l.slug === 'string' ? l.slug : l.productId,
      name: l.name,
      image: typeof l.image === 'string' ? l.image : '',
      price: l.price,
      size: l.size || null,
      colour: l.colour || null,
      max,
      qty: clampQty(l.qty, max),
    })
  }
  return lines
}

function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return sanitize(JSON.parse(raw))
  } catch {
    return []
  }
}

function clearGuestStorage() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Unavailable storage — nothing to clear.
  }
}

const FRIENDLY_SYNC_ERROR = 'Could not sync your bag. Please check your connection and try again.'

export function CartProvider({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [items, setItems] = useState(load)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  // User id whose database cart is currently loaded (merge runs once).
  const loadedForRef = useRef(null)
  const userRef = useRef(user)
  useEffect(() => {
    userRef.current = user
  }, [user])

  // Persist guest cart on every change — never while authenticated, so
  // server state can never leak into (or be resurrected from) the guest key.
  useEffect(() => {
    if (userRef.current) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      // Storage full or unavailable — cart still works in memory.
    }
  }, [items])

  // Sync across tabs — guest mode only.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && !userRef.current) {
        try {
          setItems(sanitize(e.newValue ? JSON.parse(e.newValue) : []))
        } catch {
          // Ignore malformed cross-tab writes.
        }
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Session transitions: login → merge guest cart into MongoDB (once per
  // user) then load the database cart; logout → fall back to guest-local.
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      loadedForRef.current = null
      setItems(load())
      setError('')
      return
    }
    if (loadedForRef.current === user.id) return
    loadedForRef.current = user.id
    let cancelled = false
    async function synchronize() {
      setSyncing(true)
      setError('')
      try {
        const guest = load()
        const data = guest.length > 0
          ? await mergeCartServer(guest)
          : await fetchCart()
        if (cancelled) return
        setItems(data.items)
        // Guest data is safe to drop only after the server confirmed.
        if (guest.length > 0) clearGuestStorage()
      } catch {
        if (cancelled) return
        // Stay on the in-memory/guest cart so nothing the shopper added
        // is lost; retry on the next session change or mutation.
        loadedForRef.current = null
        setError(FRIENDLY_SYNC_ERROR)
      } finally {
        if (!cancelled) setSyncing(false)
      }
    }
    synchronize()
    return () => {
      cancelled = true
    }
  }, [user, authLoading])

  const addItem = useCallback((product, { size = null, colour = null, qty = 1 } = {}) => {
    if (!userRef.current) {
      const max = Math.min(Math.max(product.stock || MAX_PER_LINE, 1), MAX_PER_LINE)
      const key = lineKey(product.id, size, colour)
      const snapshot = {
        key,
        productId: product.id,
        slug: product.slug || product.id,
        name: product.name,
        image: product.images?.[0] || product.image || '',
        price: product.price,
        size,
        colour,
        max,
      }
      setItems((prev) => {
        const existing = prev.find((l) => l.key === key)
        if (existing) {
          return prev.map((l) =>
            l.key === key ? { ...l, qty: clampQty(l.qty + qty, l.max) } : l,
          )
        }
        return [...prev, { ...snapshot, qty: clampQty(qty, max) }]
      })
      return Promise.resolve()
    }
    setError('')
    return apiAddItem({ productId: product.id, size, colour, qty })
      .then((data) => {
        setItems(data.items)
      })
      .catch(() => {
        setError(FRIENDLY_SYNC_ERROR)
      })
  }, [])

  const updateQty = useCallback((key, qty) => {
    if (!userRef.current) {
      setItems((prev) =>
        prev.map((l) => (l.key === key ? { ...l, qty: clampQty(qty, l.max) } : l)),
      )
      return Promise.resolve()
    }
    const line = items.find((l) => l.key === key)
    if (!line) return Promise.resolve()
    setError('')
    return apiUpdateItem(line.productId, { qty, size: line.size, colour: line.colour })
      .then((data) => {
        setItems(data.items)
      })
      .catch(() => {
        setError(FRIENDLY_SYNC_ERROR)
      })
  }, [items])

  const removeItem = useCallback((key) => {
    if (!userRef.current) {
      setItems((prev) => prev.filter((l) => l.key !== key))
      return Promise.resolve()
    }
    const line = items.find((l) => l.key === key)
    if (!line) return Promise.resolve()
    setError('')
    return apiRemoveItem(line.productId, { size: line.size, colour: line.colour })
      .then((data) => {
        setItems(data.items)
      })
      .catch(() => {
        setError(FRIENDLY_SYNC_ERROR)
      })
  }, [items])

  const clearCart = useCallback(() => {
    if (!userRef.current) {
      setItems([])
      return Promise.resolve()
    }
    setError('')
    return clearCartServer()
      .then((data) => {
        setItems(data.items)
      })
      .catch(() => {
        setError(FRIENDLY_SYNC_ERROR)
      })
  }, [])

  const value = useMemo(() => {
    const count = items.reduce((n, l) => n + l.qty, 0)
    const subtotal = items.reduce((n, l) => n + l.qty * l.price, 0)
    return { items, count, subtotal, syncing, error, addItem, updateQty, removeItem, clearCart }
  }, [items, syncing, error, addItem, updateQty, removeItem, clearCart])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>')
  return ctx
}
