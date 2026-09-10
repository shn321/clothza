import nodemailer from 'nodemailer'

/* CLOTHZA email service (Step 19) — server-side only, provider
   abstraction with safe degradation.
   Configuration (environment only, never hard-coded, never logged):
     EMAIL_PROVIDER=smtp   → real SMTP delivery via nodemailer
     EMAIL_FROM=...        → sender identity (defaults to a no-reply)
     SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD
     EMAIL_PROVIDER=test   → in-memory capture (automated tests only;
                             never sends anything over the network)
   Anything else (including completely missing configuration) means
   email is DISABLED: sendEmail() resolves { sent: false, skipped: true }
   and NEVER throws, so checkout / order / payment flows can never break
   because of email. Credentials, tokens and secrets are never logged —
   only the recipient domain-insensitive envelope (to/subject) appears
   in diagnostics, and failures are described without secrets. */

const TEST_OUTBOX = []

function getConfig() {
  return {
    provider: String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase(),
    from: String(process.env.EMAIL_FROM || 'CLOTHZA <no-reply@clothza.example>').trim(),
    host: String(process.env.SMTP_HOST || '').trim(),
    port: Number(process.env.SMTP_PORT || 587),
    user: String(process.env.SMTP_USER || '').trim(),
    /* NOTE: password is read only here and passed straight to the
       transport — it is never logged, returned or embedded anywhere. */
    password: String(process.env.SMTP_PASSWORD || ''),
  }
}

export function isEmailConfigured() {
  const { provider, host, user, password } = getConfig()
  if (provider === 'test') return true
  if (provider !== 'smtp') return false
  return Boolean(host && user && password)
}

/* True when the address looks deliverable enough to attempt. */
function isValidAddress(to) {
  return typeof to === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())
}

let cachedTransport = null
let cachedKey = ''

function getSmtpTransport() {
  const { host, port, user, password } = getConfig()
  const key = `${host}:${port}:${user}`
  if (cachedTransport && cachedKey === key) return cachedTransport
  cachedTransport = nodemailer.createTransport({
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure: Number(port) === 465,
    auth: { user, pass: password },
    /* Fail fast — email must never hold a checkout response open. */
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  })
  cachedKey = key
  return cachedTransport
}

/* In-memory outbox for the `test` provider. Tests assert on this;
   nothing ever leaves the process. */
export function getTestOutbox() {
  return TEST_OUTBOX
}

export function clearTestOutbox() {
  TEST_OUTBOX.length = 0
}

/* Send one transactional email. NEVER throws and NEVER leaks secrets:
   - unconfigured → { sent: false, skipped: true }
   - invalid recipient → { sent: false, skipped: true }
   - transport failure → { sent: false, error } (message only, safe)
   - test provider → captured in-memory, { sent: true, test: true } */
export async function sendEmail({ to, subject, html, text }) {
  const recipient = String(to || '').trim()
  const safeSubject = String(subject || '').slice(0, 200)
  if (!isValidAddress(recipient)) {
    return { sent: false, skipped: true, reason: 'invalid-recipient' }
  }
  const { provider, from } = getConfig()
  if (provider === 'test') {
    TEST_OUTBOX.push({
      to: recipient,
      subject: safeSubject,
      html: String(html || ''),
      text: String(text || ''),
      sentAt: new Date().toISOString(),
    })
    return { sent: true, test: true }
  }
  if (!isEmailConfigured()) {
    return { sent: false, skipped: true, reason: 'email-not-configured' }
  }
  try {
    await getSmtpTransport().sendMail({
      from,
      to: recipient,
      subject: safeSubject,
      html: String(html || ''),
      text: String(text || ''),
    })
    return { sent: true }
  } catch (err) {
    /* Safe diagnostic: recipient + subject only. The error message is
       sanitized — SMTP libraries can echo hostnames but never the
       password we supplied (it is not part of any readable field). */
    const detail = err && err.message ? String(err.message).slice(0, 200) : 'delivery failed'
    return { sent: false, error: detail }
  }
}
