import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { fetchCurrentUser, loginUser, logoutUser, registerUser } from '../lib/api.js'

/* CLOTHZA auth store — session lives in an HTTP-only cookie set by the
   API. The JWT is never stored in localStorage, sessionStorage, or React
   state; this context holds only the safe public user profile.
   On startup it restores the session via GET /api/auth/me. */

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Session restoration on application startup.
  useEffect(() => {
    let cancelled = false
    async function restore() {
      try {
        const current = await fetchCurrentUser()
        if (!cancelled) setUser(current)
      } catch {
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    restore()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async ({ email, password }) => {
    setError('')
    try {
      const loggedIn = await loginUser({ email, password })
      setUser(loggedIn)
      return loggedIn
    } catch (err) {
      const message = err?.message || 'Login failed. Please try again.'
      setError(message)
      throw err
    }
  }, [])

  const register = useCallback(async ({ name, email, password }) => {
    setError('')
    try {
      const created = await registerUser({ name, email, password })
      setUser(created)
      return created
    } catch (err) {
      const message = err?.message || 'Registration failed. Please try again.'
      setError(message)
      throw err
    }
  }, [])

  const logout = useCallback(async () => {
    setError('')
    try {
      await logoutUser()
    } catch {
      // Logout clears the cookie server-side; even if the request fails
      // the local session must end so stale state never lingers.
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
      clearError: () => setError(''),
    }),
    [user, loading, error, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
