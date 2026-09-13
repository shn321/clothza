import { useEffect, useMemo, useState } from 'react'
import { getDefaultContent } from '../data/defaultContent.js'
import { fetchPublicContent } from '../lib/api.js'

/* useSiteContent(key) — CMS-backed storefront content with safe fallback.
   - Renders defaults instantly (no layout shift, works offline).
   - Fetches GET /api/content/:key once per key (module-level cache, so
     repeated mounts never re-request).
   - On failure, keeps defaults silently (homepage never breaks). */

const cache = new Map() // key -> content object
const inflight = new Map() // key -> promise

export function useSiteContent(key) {
  const fallback = useMemo(() => getDefaultContent(key), [key])
  const [content, setContent] = useState(() => cache.get(key) || fallback)
  const [loading, setLoading] = useState(() => !cache.has(key))
  const [isLive, setIsLive] = useState(() => cache.has(key))

  useEffect(() => {
    let cancelled = false
    if (cache.has(key)) {
      setContent(cache.get(key))
      setLoading(false)
      setIsLive(true)
      return undefined
    }
    setLoading(true)
    let promise = inflight.get(key)
    if (!promise) {
      promise = fetchPublicContent(key)
        .then((c) => c)
        .catch(() => null)
        .finally(() => {
          inflight.delete(key)
        })
      inflight.set(key, promise)
    }
    promise.then((live) => {
      if (cancelled) return
      if (live && typeof live === 'object') {
        cache.set(key, live)
        setContent(live)
        setIsLive(true)
      } else {
        setContent(fallback)
        setIsLive(false)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [key, fallback])

  return { content: content || fallback, loading, isLive, fallback }
}

/* Test/dev helper — clear the module cache (e.g. after admin publish). */
export function invalidateContentCache(key) {
  if (key) cache.delete(key)
  else cache.clear()
}
