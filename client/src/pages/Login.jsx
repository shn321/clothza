import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const from = location.state?.from || '/account'

  function validate() {
    const next = {}
    if (!email.trim()) next.email = 'Email is required'
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address'
    if (!password) next.password = 'Password is required'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setServerError('')
    if (!validate()) return
    setSubmitting(true)
    try {
      await login({ email: email.trim(), password })
      navigate(from, { replace: true })
    } catch (err) {
      setServerError(err?.message || 'Login failed. Please check your details and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container clothza-section">
        <div className="mx-auto w-full max-w-md">
          <p className="type-label">Welcome back</p>
          <h1 className="type-h2 mt-2">Log in</h1>
          <p className="type-body-muted mt-2">
            New to CLOTHZA?{' '}
            <Link to="/register" className="underline underline-offset-4">
              Create an account
            </Link>
          </p>

          <form onSubmit={handleSubmit} noValidate className="card mt-6 flex flex-col gap-4 p-6">
            {serverError && (
              <p role="alert" className="rounded-[3px] border border-linen bg-parchment px-3 py-2 text-sm">
                {serverError}
              </p>
            )}

            <div>
              <label htmlFor="login-email" className="field-label">
                Email <span aria-hidden="true">*</span>
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                aria-required="true"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'login-email-error' : undefined}
                className="field-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
              {errors.email && (
                <p id="login-email-error" role="alert" className="mt-1 text-sm text-red-800">
                  {errors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="login-password" className="field-label">
                Password <span aria-hidden="true">*</span>
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  aria-required="true"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'login-password-error' : undefined}
                  className="field-input pr-11"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-[3px] p-1.5 text-fog transition-colors hover:bg-charcoal/5 hover:text-charcoal"
                >
                  {showPassword ? (
                    <EyeOff size={18} strokeWidth={1.5} aria-hidden="true" />
                  ) : (
                    <Eye size={18} strokeWidth={1.5} aria-hidden="true" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p id="login-password-error" role="alert" className="mt-1 text-sm text-red-800">
                  {errors.password}
                </p>
              )}
            </div>

            <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
              {submitting ? 'Logging in…' : 'Log in'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}

export default Login
