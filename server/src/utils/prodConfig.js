/* CLOTHZA production configuration check (Step 33) — pure and
   testable. Given an env-like object, reports fatal problems and
   warnings for NODE_ENV=production. Development is NEVER blocked:
   missing values there stay warnings at boot. Production fail-fast
   (missing MONGODB_URI / JWT_SECRET) prevents serving traffic with an
   unusable or insecure configuration. Never prints secret values —
   only variable names. */

export function checkProductionConfig(env = process.env) {
  const fatal = []
  const warnings = []
  const nodeEnv = String(env?.NODE_ENV || '').trim().toLowerCase()
  if (nodeEnv !== 'production') return { fatal, warnings }

  if (!String(env?.MONGODB_URI || '').trim()) {
    fatal.push('MONGODB_URI is required in production.')
  }
  const jwtSecret = String(env?.JWT_SECRET || '')
  if (!jwtSecret.trim()) {
    fatal.push('JWT_SECRET is required in production.')
  } else if (jwtSecret.length < 32) {
    warnings.push('JWT_SECRET is shorter than 32 characters — use a long random value, unique per environment.')
  }
  if (!String(env?.CLIENT_URL || '').trim()) {
    warnings.push(
      'CLIENT_URL is not set — CORS is fail-closed, so browsers will be rejected until it is set to the exact frontend origin.',
    )
  }
  /* A cross-site session cookie (Vercel frontend + Render API on
     different domains) requires SameSite=None with Secure — otherwise
     browsers drop the login cookie and every authenticated request
     401s with "Not authenticated". An explicit lax/strict alongside a
     CLIENT_URL is therefore almost certainly a misconfiguration. */
  const sameSite = String(env?.COOKIE_SAMESITE || '').trim().toLowerCase()
  if (String(env?.CLIENT_URL || '').trim() && (sameSite === 'lax' || sameSite === 'strict')) {
    warnings.push(
      `COOKIE_SAMESITE is "${sameSite}" while CLIENT_URL is set — cross-site deployments (frontend and API on different domains) require COOKIE_SAMESITE=none with Secure, otherwise browsers will not send the session cookie.`,
    )
  }
  return { fatal, warnings }
}
