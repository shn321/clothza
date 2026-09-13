import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSiteContent } from '../../hooks/useSiteContent.js'

function InstagramIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  )
}

function FacebookIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  )
}

function XIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4l16 16" />
      <path d="M20 4L4 20" />
    </svg>
  )
}

const FALLBACK_SHOP = [
  { label: 'New Arrivals', to: '/shop?sort=newest' },
  { label: 'Men', to: '/men' },
  { label: 'Women', to: '/women' },
  { label: 'Collections', to: '/collections' },
]

const FALLBACK_CARE = [
  { label: 'Contact', to: '/contact' },
  { label: 'Shipping', to: '/shipping' },
  { label: 'Returns', to: '/returns' },
  { label: 'FAQ', to: '/faq' },
]

const FALLBACK_COMPANY = [
  { label: 'About', to: '/about' },
  { label: 'Privacy', to: '/privacy' },
  { label: 'Terms', to: '/terms' },
]

const SOCIAL_ICONS = { Instagram: InstagramIcon, Facebook: FacebookIcon, X: XIcon }

const footerLink =
  'inline-block py-1 text-sm text-fog transition-colors duration-200 hover:text-charcoal'

function LinkColumn({ title, links }) {
  const safe = Array.isArray(links) && links.length > 0 ? links : []
  if (safe.length === 0) return null
  return (
    <nav aria-label={title}>
      <h2 className="type-label">{title}</h2>
      <ul className="mt-4 flex flex-col gap-1">
        {safe.map((l) => (
          <li key={l.label}>
            <Link to={l.to || '#'} className={footerLink}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Footer() {
  const { content } = useSiteContent('site.footer')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState({ type: 'idle', message: '' })

  const shopLinks = content?.shopLinks?.length ? content.shopLinks : FALLBACK_SHOP
  const careLinks = content?.customerCareLinks?.length ? content.customerCareLinks : FALLBACK_CARE
  const companyLinks = content?.companyLinks?.length ? content.companyLinks : FALLBACK_COMPANY
  const socialLinks =
    Array.isArray(content?.socialLinks) && content.socialLinks.length > 0
      ? content.socialLinks
      : [
          { label: 'Instagram', href: '#' },
          { label: 'Facebook', href: '#' },
          { label: 'X', href: '#' },
        ]

  const handleSubmit = (e) => {
    e.preventDefault()
    const value = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setStatus({ type: 'error', message: 'Please enter a valid email address.' })
      return
    }
    setStatus({
      type: 'success',
      message: "You're on the list. Welcome to CLOTHZA.",
    })
    setEmail('')
  }

  return (
    <footer className="border-t border-linen bg-cream text-charcoal">
      <div className="clothza-container py-12 md:py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1.6fr] lg:gap-12">
          {/* Brand */}
          <div>
            <Link
              to="/"
              aria-label="CLOTHZA home"
              className="text-lg font-medium tracking-[0.28em]"
            >
              {content?.brandName || 'CLOTHZA'}
            </Link>
            <p className="type-small mt-2">{content?.tagline || 'Style Made Simple.'}</p>
            <p className="type-small mt-4 max-w-xs">
              {content?.description || 'Thoughtfully designed essentials for modern everyday style.'}
            </p>
            <div className="mt-5 flex items-center gap-1">
              {socialLinks.map(({ label, href }) => {
                const Icon = SOCIAL_ICONS[label] || InstagramIcon
                return (
                  <a
                    key={label}
                    href={href || '#'}
                    aria-label={`CLOTHZA on ${label}`}
                    className="inline-flex items-center justify-center rounded-[3px] p-2 text-charcoal transition-colors duration-200 hover:bg-charcoal/5"
                  >
                    <Icon />
                  </a>
                )
              })}
            </div>
          </div>

          {/* Link columns */}
          <LinkColumn title="Shop" links={shopLinks} />
          <LinkColumn title="Customer Care" links={careLinks} />
          <LinkColumn title="Company" links={companyLinks} />

          {/* Newsletter */}
          <div>
            <h2 className="type-label">{content?.newsletterHeading || 'Join the CLOTHZA list'}</h2>
            <p className="type-small mt-4">
              {content?.newsletterDescription ||
                'Updates on new collections and private offers. No noise, unsubscribe anytime.'}
            </p>
            <form onSubmit={handleSubmit} noValidate className="mt-4">
              <label htmlFor="footer-newsletter-email" className="field-label">
                Email address
              </label>
              <div className="flex flex-col gap-3">
                <input
                  id="footer-newsletter-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (status.type !== 'idle') setStatus({ type: 'idle', message: '' })
                  }}
                  aria-describedby="footer-newsletter-feedback"
                  aria-invalid={status.type === 'error'}
                  className="field-input"
                />
                <button type="submit" className="btn btn-primary w-full sm:w-auto">
                  Subscribe
                </button>
              </div>
              <p
                id="footer-newsletter-feedback"
                role="status"
                aria-live="polite"
                className={`mt-2 text-sm leading-6 ${
                  status.type === 'error' ? 'text-red-800' : 'text-fog'
                }`}
              >
                {status.message || ' '}
              </p>
            </form>
          </div>
        </div>

        {/* Bottom bar */}
        <hr className="divider mt-12" />
        <div className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="type-small">{content?.copyrightText || '© 2026 CLOTHZA. All rights reserved.'}</p>
          <div className="flex items-center gap-6">
            <Link to="/privacy" className={footerLink}>
              Privacy
            </Link>
            <Link to="/terms" className={footerLink}>
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer
