import bcrypt from 'bcryptjs'
import User, { toSafeUser } from '../models/User.js'
import { clearAuthCookie, getJwtSecret, setAuthCookie, signAuthToken } from '../utils/auth.js'
import jwt from 'jsonwebtoken'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8
const MAX_NAME_LENGTH = 80

function invalid(message) {
  const err = new Error(message)
  err.statusCode = 400
  return err
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function validateName(name) {
  const trimmed = String(name || '').trim().replace(/\s+/g, ' ')
  if (!trimmed) throw invalid('Name is required')
  if (trimmed.length < 2) throw invalid('Name must be at least 2 characters')
  if (trimmed.length > MAX_NAME_LENGTH) throw invalid('Name is too long')
  return trimmed
}

function validateEmail(email) {
  const normalized = normalizeEmail(email)
  if (!normalized) throw invalid('Email is required')
  if (normalized.length > 254 || !EMAIL_RE.test(normalized)) {
    throw invalid('Please provide a valid email address')
  }
  return normalized
}

function validatePassword(password) {
  const value = String(password || '')
  if (!value) throw invalid('Password is required')
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw invalid('Password must be at least 8 characters')
  }
  if (value.length > 128) throw invalid('Password is too long')
  return value
}

/* POST /api/auth/register — { name, email, password } */
export async function register(req, res, next) {
  try {
    let name
    let email
    let password
    try {
      name = validateName(req.body?.name)
      email = validateEmail(req.body?.email)
      password = validatePassword(req.body?.password)
    } catch (validationError) {
      return res.status(validationError.statusCode || 400).json({
        success: false,
        message: validationError.message,
      })
    }

    const existing = await User.findOne({ email }).lean()
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await User.create({ name, email, passwordHash })

    const token = signAuthToken(user._id)
    setAuthCookie(res, token)

    return res.status(201).json({ success: true, data: { user: toSafeUser(user) } })
  } catch (err) {
    // Duplicate-key race (e.g. parallel requests with the same email).
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' })
    }
    next(err)
  }
}

/* POST /api/auth/login — { email, password } */
export async function login(req, res, next) {
  try {
    const email = normalizeEmail(req.body?.email)
    const password = String(req.body?.password || '')
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' })
    }

    // Generic message — never reveal whether the email or password was wrong.
    const INVALID = 'Invalid email or password'
    const user = await User.findOne({ email }).select('+passwordHash')
    if (!user || !user.passwordHash) {
      return res.status(401).json({ success: false, message: INVALID })
    }
    const matches = await bcrypt.compare(password, user.passwordHash)
    if (!matches) {
      return res.status(401).json({ success: false, message: INVALID })
    }

    const token = signAuthToken(user._id)
    setAuthCookie(res, token)

    return res.status(200).json({ success: true, data: { user: toSafeUser(user) } })
  } catch (err) {
    next(err)
  }
}

/* POST /api/auth/logout — always succeeds, even when unauthenticated. */
export async function logout(req, res) {
  clearAuthCookie(res)
  return res.status(200).json({ success: true, message: 'Logged out successfully' })
}

/* GET /api/auth/me — current session user. */
export async function me(req, res) {
  // requireAuth already attached req.user; this is a safety net.
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' })
  }
  return res.status(200).json({ success: true, data: { user: toSafeUser(req.user) } })
}

/* Lightweight token check used only by tests/diagnostics — not exposed. */
export function verifyToken(token) {
  return jwt.verify(token, getJwtSecret())
}
