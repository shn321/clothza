import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import {
  clearNotifications as clearAllApi,
  deleteNotification as deleteApi,
  fetchNotifications,
  markAllNotificationsRead as markAllApi,
  markNotificationRead as markReadApi,
} from '../lib/api.js'

/* CLOTHZA notification store (Step 19) — lightweight, no WebSockets.
   Loads the owner's latest notifications on sign-in, refreshes after
   important actions (call `refresh()` — e.g. after placing an order)
   and re-checks quietly every 90s while signed in. Guests get an empty
   shelf; nothing here affects them. */

const NotificationContext = createContext(null)

const POLL_MS = 90000

export function NotificationProvider({ children }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([])
      setUnreadCount(0)
      return
    }
    setLoading(true)
    try {
      const { notifications, unreadCount: unread } = await fetchNotifications({ limit: 8 })
      setItems(notifications)
      setUnreadCount(unread)
    } catch {
      // Shelf stays as-is on transient failures; never blocks the UI.
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!user) return undefined
    const timer = window.setInterval(() => {
      refresh()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [user, refresh])

  const markRead = useCallback(async (id) => {
    try {
      const updated = await markReadApi(id)
      setItems((prev) => prev.map((n) => (n.id === id ? updated : n)))
      setUnreadCount((prev) => Math.max(0, prev - 1))
      return updated
    } catch {
      await refresh()
      return null
    }
  }, [refresh])

  const markAllRead = useCallback(async () => {
    try {
      const { unreadCount: unread } = await markAllApi()
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })))
      setUnreadCount(unread)
    } catch {
      await refresh()
    }
  }, [refresh])

  const removeItem = useCallback(async (id) => {
    const prev = items
    setItems((list) => list.filter((n) => n.id !== id))
    try {
      await deleteApi(id)
      await refresh()
    } catch {
      setItems(prev)
    }
  }, [items, refresh])

  const clearAll = useCallback(async () => {
    setItems([])
    setUnreadCount(0)
    try {
      await clearAllApi()
    } catch {
      await refresh()
    }
  }, [refresh])

  const value = useMemo(
    () => ({ items, unreadCount, loading, refresh, markRead, markAllRead, removeItem, clearAll }),
    [items, unreadCount, loading, refresh, markRead, markAllRead, removeItem, clearAll],
  )

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotifications() {
  return useContext(NotificationContext)
}
