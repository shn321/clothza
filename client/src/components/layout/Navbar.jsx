import { useEffect, useRef, useState } from 'react'
import { Heart, Menu, Search, ShoppingBag, User, X } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useCart } from '../../context/CartContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useWishlist } from '../../context/WishlistContext.jsx'
import NotificationBell from './NotificationBell.jsx'
import SearchOverlay from '../search/SearchOverlay.jsx'

const CENTER_LINKS = [
  { label: 'New Arrivals', to: '/shop?sort=newest' },
  { label: 'Men', to: '/men' },
  { label: 'Women', to: '/women' },
  { label: 'Collections', to: '/collections' },
]

const DRAWER_LINKS = [
  ...CENTER_LINKS,
  { label: 'Account', to: '/account' },
  { label: 'Wishlist', to: '/wishlist' },
]

const linkUnderline =
  'relative py-1 text-charcoal/75 transition-colors duration-200 hover:text-charcoal after:absolute after:bottom-0 after:left-0 after:h-px after:w-0 after:bg-charcoal after:transition-[width] after:duration-200 hover:after:w-full'

function IconLink({ to, label, children }) {
  return (
    <Link
      to={to}
      aria-label={label}
      className="relative inline-flex items-center justify-center rounded-[3px] p-2 text-charcoal transition-colors duration-200 hover:bg-charcoal/5"
    >
      {children}
    </Link>
  )
}

function BagLink() {
  const { count } = useCart()
  return (
    <IconLink
      to="/cart"
      label={count > 0 ? `Shopping bag, ${count} ${count === 1 ? 'item' : 'items'}` : 'Shopping bag'}
    >
      <ShoppingBag size={20} strokeWidth={1.5} aria-hidden="true" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-charcoal px-1 text-[10px] font-medium leading-none text-ivory"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </IconLink>
  )
}

function AccountLink() {
  const { user, loading } = useAuth()
  const label = loading ? 'Account' : user ? `Account, signed in as ${user.name}` : 'Account, log in or register'
  return (
    <IconLink to="/account" label={label}>
      <User size={20} strokeWidth={1.5} aria-hidden="true" />
      {!loading && user && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 h-2 w-2 rounded-full bg-bronze"
        />
      )}
    </IconLink>
  )
}

function WishlistLink() {
  const { count } = useWishlist()
  return (
    <IconLink
      to="/wishlist"
      label={count > 0 ? `Wishlist, ${count} ${count === 1 ? 'item' : 'items'}` : 'Wishlist'}
    >
      <Heart size={20} strokeWidth={1.5} aria-hidden="true" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-charcoal px-1 text-[10px] font-medium leading-none text-ivory"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </IconLink>
  )
}

function Navbar() {
  const [open, setOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const location = useLocation()
  const closeRef = useRef(null)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const close = () => setOpen(false)

  // Close on route change
  useEffect(() => {
    setOpen(false)
    setSearchOpen(false)
  }, [location.pathname, location.search])

  // Escape to close + scroll lock + initial focus
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open ])

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-linen bg-ivory/90 backdrop-blur">
        <nav
          aria-label="Main navigation"
          className="clothza-container grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-2 md:h-20"
        >
          {/* LEFT: mobile menu button + desktop wordmark */}
          <div className="flex items-center justify-start gap-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="clothza-mobile-menu"
              className="inline-flex items-center justify-center rounded-[3px] p-2 text-charcoal transition-colors duration-200 hover:bg-charcoal/5 md:hidden"
            >
              <Menu size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <Link
              to="/"
              aria-label="CLOTHZA home"
              className="hidden text-lg font-medium tracking-[0.28em] text-charcoal md:inline-block"
            >
              CLOTHZA
            </Link>
          </div>

          {/* CENTER: mobile wordmark + desktop links */}
          <div className="flex items-center justify-center">
            <Link
              to="/"
              aria-label="CLOTHZA home"
              className="text-base font-medium tracking-[0.28em] text-charcoal md:hidden"
            >
              CLOTHZA
            </Link>
            <div className="hidden items-center gap-8 md:flex">
              {CENTER_LINKS.map((l) => (
                <Link key={l.label} to={l.to} className={`type-nav ${linkUnderline}`}>
                  {l.label}
                </Link>
              ))}
            </div>
          </div>

          {/* RIGHT: icons */}
          <div className="flex items-center justify-end gap-0.5 sm:gap-1">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search products"
              aria-expanded={searchOpen}
              aria-controls="clothza-search"
              className="relative inline-flex items-center justify-center rounded-[3px] p-2 text-charcoal transition-colors duration-200 hover:bg-charcoal/5"
            >
              <Search size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <span className="hidden md:inline-flex">
              <AccountLink />
            </span>
            <span className="hidden md:inline-flex">
              <WishlistLink />
            </span>
            <NotificationBell />
            <BagLink />
          </div>
        </nav>
      </header>

      {/* Mobile drawer overlay */}
      <div
        aria-hidden={!open}
        onClick={close}
        className={`fixed inset-0 z-[60] bg-charcoal/30 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Mobile drawer */}
      <aside
        id="clothza-mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!open}
        inert={!open}
        className={`fixed left-0 top-0 z-[61] flex h-full w-[86%] max-w-xs flex-col border-r border-linen bg-ivory transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-linen px-5 py-4">
          <span className="text-sm font-medium tracking-[0.28em] text-charcoal">
            CLOTHZA
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="inline-flex items-center justify-center rounded-[3px] p-2 text-charcoal transition-colors duration-200 hover:bg-charcoal/5"
          >
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Mobile navigation" className="flex flex-col gap-1 p-5">
          {isAdmin && (
            <Link
              to="/admin"
              onClick={close}
              tabIndex={open ? 0 : -1}
              className="flex items-center justify-between rounded-[3px] bg-charcoal px-2 py-2.5 text-ivory transition-colors duration-200"
            >
              <span className="type-nav !text-ivory">Admin Dashboard</span>
            </Link>
          )}
          {DRAWER_LINKS.map((l) => (
            <Link
              key={l.label}
              to={l.to}
              onClick={close}
              tabIndex={open ? 0 : -1}
              className="flex items-center justify-between rounded-[3px] px-2 py-2.5 transition-colors duration-200 hover:bg-charcoal/5"
            >
              <span className="type-nav">{l.label}</span>
              {l.label === 'Account' && (
                <User size={18} strokeWidth={1.5} aria-hidden="true" className="text-fog" />
              )}
              {l.label === 'Wishlist' && (
                <Heart size={18} strokeWidth={1.5} aria-hidden="true" className="text-fog" />
              )}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Search */}
      <div id="clothza-search">
        <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      </div>
    </>
  )
}

export default Navbar
