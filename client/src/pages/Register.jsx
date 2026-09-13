import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  /* Return guests to where they came from (e.g. /checkout) after signup. */
  const from = location.state?.from || '/account'

  function validate() {
    const next = {}
    if (!name.trim()) next.name = 'Name is required'
    else if (name.trim().length < 2) next.name = 'Name must be at least 2 characters'
    if (!email.trim()) next.email = 'Email is required'
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address'
    if (!password) next.password = 'Password is required'
    else if (password.length < 8) next.password = 'Password must be at least 8 characters'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setServerError('')
    if (!validate()) return
    setSubmitting(true)
    try {
      await register({ name: name.trim(), email: email.trim(), password })
      navigate(from, { replace: true })
    } catch (err) {
      setServerError(err?.message || 'Registration failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container clothza-section">
        <div className="mx-auto w-full max-w-md">
          <p className="type-label">Join CLOTHZA</p>
          <h1 className="type-h2 mt-2">Create an account</h1>
          <p className="type-body-muted mt-2">
            Already have an account?{' '}
            <Link to="/login" className="underline underline-offset-4">
              Log in
            </Link>
          </p>

          <form onSubmit={handleSubmit} noValidate className="card mt-6 flex flex-col gap-4 p-6">
            {serverError && (
              <p role="alert" className="rounded-[3px] border border-linen bg-parchment px-3 py-2 text-sm">
                {serverError}
              </p>
            )}

            <div>
              <label htmlFor="register-name" className="field-label">
                Name <span aria-hidden="true">*</span>
              </label>
              <input
                id="register-name"
                name="name"
                type="text"
                autoComplete="name"
                required
                aria-required="true"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'register-name-error' : undefined}
                className="field-input"
                placeholder="Your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
              />
              {errors.name && (
                <p id="register-name-error" role="alert" className="mt-1 text-sm text-red-800">
                  {errors.name}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="register-email" className="field-label">
                Email <span aria-hidden="true">*</span>
              </label>
              <input
                id="register-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                aria-required="true"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'register-email-error' : undefined}
                className="field-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
              {errors.email && (
                <p id="register-email-error" role="alert" className="mt-1 text-sm text-red-800">
                  {errors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="register-password" className="field-label">
                Password <span aria-hidden="true">*</span>
              </label>
              <div className="relative">
                <input
                  id="register-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  aria-required="true"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={
                    [errors.password ? 'register-password-error' : null, 'register-password-hint']
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  className="field-input pr-11"
                  placeholder="At least 8 characters"
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
              <p id="register-password-hint" className="type-small mt-1">
                Minimum 8 characters. A mix of letters, numbers and symbols is stronger.
              </p>
              {errors.password && (
                <p id="register-password-error" role="alert" className="mt-1 text-sm text-red-800">
                  {errors.password}
                </p>
              )}
            </div>

            <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}

export default Register
