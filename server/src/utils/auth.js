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
  /* Cross-domain deployments (app on one domain, API on another) need
     SameSite=None (always with Secure) or the browser will not send the
     session cookie on API fetches. Same-site setups keep the Lax
     default. Set COOKIE_SAMESITE=none only when the frontend and API
     live on different sites. */
  const raw = String(process.env.COOKIE_SAMESITE || 'lax').trim().toLowerCase()
  const sameSite = raw === 'none' ? 'none' : raw === 'strict' ? 'strict' : 'lax'
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
