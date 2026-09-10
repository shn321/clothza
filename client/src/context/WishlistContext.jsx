import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  addWishlistItem as apiAddItem,
  fetchWishlist,
  mergeWishlistServer,
  removeWishlistItem as apiRemoveItem,
} from '../lib/api.js'
import { useAuth } from './AuthContext.jsx'
import { useProducts } from './ProductsContext.jsx'

/* CLOTHZA wishlist store — dual mode (Step 13).
   Guest users: localStorage only, exactly as before (array of product
   ids resolved against the API-backed catalog).
   Authenticated users: MongoDB is the source of truth via the API; on
   login the guest-local ids are unioned into the database wishlist
   (unique, no duplicates) and the guest key is cleared ONLY after the
   server confirms. On logout the database wishlist stays in MongoDB
   and the store falls back to the guest-local list.
   Public API (ids/items/count/isSaved/toggle/remove) is unchanged;
   `syncing`/`error` are additive. */

const STORAGE_KEY = 'clothza-wishlist-v1'

const WishlistContext = createContext(null)

function sanitize(stored) {
  if (!Array.isArray(stored)) return []
  const seen = new Set()
  const ids = []
  for (const id of stored) {
    if (typeof id !== 'string' || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
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

const FRIENDLY_SYNC_ERROR = 'Could not sync your wishlist. Please check your connection and try again.'

export function WishlistProvider({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [ids, setIds] = useState(load)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const { getBySlug } = useProducts()
  // User id whose database wishlist is currently loaded (merge runs once).
  const loadedForRef = useRef(null)
  const userRef = useRef(user)
  useEffect(() => {
    userRef.current = user
  }, [user])

  // Persist guest wishlist on every change — never while authenticated.
  useEffect(() => {
    if (userRef.current) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
    } catch {
      // Storage full or unavailable — wishlist still works in memory.
    }
  }, [ids])

  // Sync across tabs — guest mode only.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && !userRef.current) {
        try {
          setIds(sanitize(e.newValue ? JSON.parse(e.newValue) : []))
        } catch {
          // Ignore malformed cross-tab writes.
        }
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Session transitions: login → union guest ids into MongoDB (once per
  // user) then load the database list; logout → fall back to guest-local.
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      loadedForRef.current = null
      setIds(load())
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
          ? await mergeWishlistServer(guest)
          : await fetchWishlist()
        if (cancelled) return
        setIds(data.ids)
        // Guest data is safe to drop only after the server confirmed.
        if (guest.length > 0) clearGuestStorage()
      } catch {
        if (cancelled) return
        // Stay on the in-memory/guest list so nothing is lost; retry on
        // the next session change or mutation.
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

  const toggle = useCallback((productId) => {
    if (!userRef.current) {
      setIds((prev) =>
        prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId],
      )
      return Promise.resolve()
    }
    setError('')
    const saved = ids.includes(productId)
    const op = saved ? apiRemoveItem(productId) : apiAddItem(productId)
    return op
      .then((data) => {
        setIds(data.ids)
      })
      .catch(() => {
        setError(FRIENDLY_SYNC_ERROR)
      })
  }, [ids])

  const remove = useCallback((productId) => {
    if (!userRef.current) {
      setIds((prev) => prev.filter((id) => id !== productId))
      return Promise.resolve()
    }
    setError('')
    return apiRemoveItem(productId)
      .then((data) => {
        setIds(data.ids)
      })
      .catch(() => {
        setError(FRIENDLY_SYNC_ERROR)
      })
  }, [])

  const value = useMemo(() => {
    const items = ids
      .map((id) => getBySlug(id))
      .filter(Boolean)
    return {
      ids,
      items,
      count: items.length,
      syncing,
      error,
      isSaved: (productId) => ids.includes(productId),
      toggle,
      remove,
    }
  }, [ids, syncing, error, getBySlug, toggle, remove])

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>
}

export function useWishlist() {
  const ctx = useContext(WishlistContext)
  if (!ctx) throw new Error('useWishlist must be used inside <WishlistProvider>')
  return ctx
}
