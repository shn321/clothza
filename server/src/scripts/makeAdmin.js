/* CLOTHZA first-admin bootstrap (Step 16) — DEVELOPMENT ONLY.
   Promotes an EXISTING registered user to role "admin".

   There is NO HTTP endpoint for this — becoming admin requires direct
   database access (MONGODB_URI), which is itself the secret. Nothing
   is hard-coded, no password lives in frontend code, and anonymous
   callers can never escalate.

   Usage (from server/):
     node src/scripts/makeAdmin.js admin@example.com
     # or: ADMIN_EMAIL=admin@example.com node src/scripts/makeAdmin.js

   The email must already belong to a registered account (sign up via
   the storefront first). Re-running is idempotent. */

import 'dotenv/config'
import { connectDB, disconnectDB, redactCredentials } from '../config/db.js'
import User from '../models/User.js'

function usage() {
  console.log('Usage: node src/scripts/makeAdmin.js <email>')
  console.log('   or: ADMIN_EMAIL=<email> node src/scripts/makeAdmin.js')
}

async function main() {
  const raw = process.argv[2] || process.env.ADMIN_EMAIL || ''
  const email = String(raw).trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    usage()
    console.error('[admin] A valid email address is required. Aborting.')
    process.exit(1)
  }
  if (!process.env.MONGODB_URI) {
    console.error('[admin] MONGODB_URI is not set. Aborting.')
    process.exit(1)
  }
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_ADMIN_BOOTSTRAP !== 'true') {
    console.error('[admin] Refusing to run in production without ALLOW_ADMIN_BOOTSTRAP=true. Aborting.')
    process.exit(1)
  }

  await connectDB()
  const user = await User.findOne({ email })
  if (!user) {
    console.error(`[admin] No registered account found for "${email}". Sign up first, then re-run.`)
    await disconnectDB()
    process.exit(1)
  }
  if (user.role === 'admin') {
    console.log(`[admin] "${email}" is already an admin. Nothing to do.`)
    await disconnectDB()
    return
  }
  user.role = 'admin'
  await user.save()
  console.log(`[admin] Promoted "${email}" to admin.`)
  await disconnectDB()
}

main().catch(async (err) => {
  console.error(`[admin] Failed: ${redactCredentials(err.message)}`)
  try {
    await disconnectDB()
  } catch {
    // Ignore disconnect errors during failure shutdown.
  }
  process.exit(1)
})
