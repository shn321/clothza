import { useState } from 'react'
import { useSiteContent } from '../../hooks/useSiteContent.js'

function Newsletter() {
  const { content } = useSiteContent('site.newsletter')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState({ type: 'idle', message: '' })

  if (content?.enabled === false) return null

  const handleSubmit = (e) => {
    e.preventDefault()
    const value = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setStatus({ type: 'error', message: 'Please enter a valid email address.' })
      return
    }
    setStatus({ type: 'success', message: content?.successMessage || "You're on the list. Welcome to CLOTHZA." })
    setEmail('')
  }

  return (
    <section aria-labelledby="home-newsletter-heading" className="bg-parchment">
      <div className="clothza-container py-14 md:py-20">
        <div className="mx-auto flex w-full max-w-xl flex-col items-center text-center">
          {content?.eyebrow ? <p className="type-label">{content.eyebrow}</p> : null}
          <h2 id="home-newsletter-heading" className="type-h2 mt-2">
            {content?.heading || 'Stay in the know.'}
          </h2>
          {content?.description ? (
            <p className="type-body-muted mt-4">{content.description}</p>
          ) : null}
          <form onSubmit={handleSubmit} noValidate className="mt-6 w-full">
            <label htmlFor="home-newsletter-email" className="field-label text-left">
              Email address
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="home-newsletter-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder={content?.placeholder || 'you@example.com'}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (status.type !== 'idle') setStatus({ type: 'idle', message: '' })
                }}
                aria-describedby="home-newsletter-feedback"
                aria-invalid={status.type === 'error'}
                className="field-input flex-1"
              />
              <button type="submit" className="btn btn-primary sm:w-auto">
                {content?.buttonText || 'Subscribe'}
              </button>
            </div>
            <p
              id="home-newsletter-feedback"
              role="status"
              aria-live="polite"
              className={`mt-2 min-h-6 text-left text-sm leading-6 ${
                status.type === 'error' ? 'text-red-800' : 'text-fog'
              }`}
            >
              {status.message || ' '}
            </p>
          </form>
        </div>
      </div>
    </section>
  )
}

export default Newsletter
