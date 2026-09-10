import 'dotenv/config'
import { createApp } from './app.js'
import { connectDB, disconnectDB, redactCredentials } from './config/db.js'

const PORT = Number(process.env.PORT) || 5000

async function start() {
  if (!process.env.MONGODB_URI) {
    console.warn('[db] MONGODB_URI is not set — starting API without a database connection.')
  } else {
    try {
      await connectDB()
    } catch (err) {
      // Sanitized: error text can embed the connection string.
      console.error(`[db] ${redactCredentials(err.message)}${err.code ? ` (code: ${err.code})` : ''}`)
      if (err.cause) console.error(`[db] Cause: ${err.cause}`)
      console.warn('[db] Starting API without a database connection.')
    }
  }

  const app = createApp()
  const server = app.listen(PORT, () => {
    console.log(`[api] CLOTHZA API listening on http://localhost:${PORT}`)
  })

  let shuttingDown = false
  const shutdown = (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[api] Received ${signal} — shutting down gracefully…`)
    server.close(async () => {
      try {
        await disconnectDB()
      } catch (err) {
        console.error(`[db] Error during disconnect: ${redactCredentials(err.message)}`)
      }
      process.exit(0)
    })
    // Force exit if connections hang.
    setTimeout(() => process.exit(1), 10000).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  /* Operational safety net: log (sanitized) instead of crashing silent.
     Request-scoped errors are already handled by Express middleware. */
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    console.error(`[api] Unhandled rejection: ${redactCredentials(message)}`)
  })
}

start()
