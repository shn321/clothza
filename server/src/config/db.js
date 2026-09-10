import mongoose from 'mongoose'

/* MongoDB connection module.
   Reads MONGODB_URI from the environment only — never hard-code or log
   credentials. All logs and errors are sanitized so connection strings,
   usernames and passwords can never leak into terminal output. */

let cached = null

/* Redact `://user:pass@` userinfo from any text (URIs, error messages). */
export function redactCredentials(text) {
  return String(text || '').replace(/:\/\/[^/\s@]+@/g, '://<redacted>@')
}

export async function connectDB() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.warn('[db] MONGODB_URI is not set — starting API without a database connection.')
    return null
  }
  if (cached) return cached
  mongoose.set('strictQuery', true)
  try {
    cached = await mongoose.connect(uri)
  } catch (err) {
    cached = null
    const safe = new Error('MongoDB connection failed')
    safe.cause = redactCredentials(err && err.message)
    safe.code = err && err.code
    throw safe
  }
  // Host name only — never the full URI.
  console.log(`[db] MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`)
  return cached
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect()
    cached = null
    console.log('[db] MongoDB disconnected.')
  }
}

/* 'connected' | 'connecting' | 'disconnected' — safe for API responses. */
export function getDbState() {
  switch (mongoose.connection.readyState) {
    case 1:
      return 'connected'
    case 2:
      return 'connecting'
    default:
      return 'disconnected'
  }
}

export function isDbConnected() {
  return mongoose.connection.readyState === 1
}
