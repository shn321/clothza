/* 404 handler for unknown routes — must be registered after all routes. */
export function notFound(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  })
}

/* Central error handler — must be the last middleware (4 args).
   Production hardening (Step 21):
   - Mongoose CastError (malformed ObjectId anywhere) → safe 400.
   - Duplicate key (11000) → safe 409, never the raw index message.
   - Oversized JSON body → 413 JSON (never the default HTML page).
   - 5xx in production → generic message + NO stack. Development keeps
     the real message/stack server-side for debugging, but stack traces,
     connection strings, paths and secrets never leave the server in
     production responses. */
export function errorHandler(err, req, res, next) {
  const isProduction = process.env.NODE_ENV === 'production'

  if (err && (err.name === 'CastError' || err.name === 'BSONError')) {
    return res.status(400).json({ success: false, message: 'Invalid request.' })
  }
  if (err && err.code === 11000) {
    return res.status(409).json({ success: false, message: 'Duplicate entry. Please try again.' })
  }
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ success: false, message: 'Request body is too large.' })
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Malformed JSON in request body.' })
  }

  const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500
  const response = { success: false }

  if (status < 500) {
    response.message = err.message || 'Request failed'
  } else if (isProduction) {
    response.message = 'Internal server error'
  } else {
    response.message = err.message || 'Internal server error'
  }
  if (!isProduction && err.stack) {
    response.stack = err.stack
  }
  res.status(status).json(response)
}
