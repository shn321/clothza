import jwt from 'jsonwebtoken'
import { toSafeUser } from '../models/User.js'

/* Shared auth helpers: token signing + secure cookie handling.
   The JWT lives ONLY in an HTTP-only cookie — never in JSON bodies,
   never in localStorage, never in logs. */

export const AUTH_COOKIE_NAME = 'clothza_token'
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function getExpiresMs() {
  const raw = String(process.env.JWT_EXPIRES_IN || '7d').trim().toLowerCase()
  const match = raw.match(/^(\d+)\s*([smhd])$/)
  if (!match) return SEVEN_DAYS_MS
  const value = Number.parseInt(match[1], 10)
  const unit = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }[match[2]]
  return value * unit
}

export function getJwtSecret() {
  return process.env.JWT_SECRET || ''
}

export function signAuthToken(userId) {
  const secret = getJwtSecret()
  if (!secret) {
    const err = new Error('Authentication is not configured')
    err.statusCode = 500
    throw err
  }
  return jwt.sign({ sub: String(userId) }, secret, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' })
}

export function cookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production'
  /* Cross-site deployments (app on one domain, API on another — e.g.
     Vercel frontend + Render API) need SameSite=None (always with
     Secure) or the browser will neither store the login Set-Cookie
     nor send it back on later API fetches, so every authenticated
     request (including /api/auth/me and /api/admin/*) 401s with
     "Not authenticated" even though login appeared to succeed.
     Same-site setups keep the Lax default. An explicit
     COOKIE_SAMESITE value is always honored; when it is unset in
     production with CLIENT_URL configured, None is the default so a
     missing env var cannot silently break cross-site sessions. */
  const explicit = String(process.env.COOKIE_SAMESITE || '').trim().toLowerCase()
  let sameSite
  if (explicit === 'none' || explicit === 'strict' || explicit === 'lax') {
    sameSite = explicit
  } else if (!explicit && isProduction && String(process.env.CLIENT_URL || '').trim()) {
    sameSite = 'none'
  } else {
    sameSite = 'lax'
  }
  return {
    httpOnly: true,
    secure: isProduction || sameSite === 'none',
    sameSite,
    maxAge: getExpiresMs(),
    path: '/',
  }
}

export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, cookieOptions())
}

export function clearAuthCookie(res, extra = {}) {
  /* Must mirror cookieOptions() (sameSite/secure/path) or browsers
     will keep the cookie instead of clearing it. */
  res.clearCookie(AUTH_COOKIE_NAME, { ...cookieOptions(), maxAge: undefined, ...extra })
}

export function safeUserResponse(user) {
  return { success: true, data: { user: toSafeUser(user) } }
}
