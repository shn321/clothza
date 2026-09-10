import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { AUTH_COOKIE_NAME, getJwtSecret } from '../utils/auth.js'

/* Protect routes with the JWT stored in the HTTP-only cookie.
   On success attaches a SAFE user object (no passwordHash) as req.user.
   Invalid / expired / missing tokens get a clean 401 — internal
   details and secrets are never leaked. */

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME]
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated' })
    }
    const secret = getJwtSecret()
    if (!secret) {
      const err = new Error('Authentication is not configured')
      err.statusCode = 500
      throw err
    }
    let payload
    try {
      payload = jwt.verify(token, secret)
    } catch {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' })
    }
    /* A forged token can carry a non-ObjectId `sub` — treat lookup
       failure (including CastError) as unauthenticated, never 500. */
    let user = null
    try {
      user = await User.findById(payload.sub)
    } catch {
      user = null
    }
    if (!user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' })
    }
    req.user = user
    req.auth = { userId: String(user._id) }
    return next()
  } catch (err) {
    return next(err)
  }
}

/* Admin gate — MUST run after requireAuth. The role is read from the
   database-backed session user (req.user), never from request data.
   401 = no session, 403 = signed in but not an admin. */
export function requireAdmin(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' })
    }
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Admins only.' })
    }
    return next()
  } catch (err) {
    return next(err)
  }
}
