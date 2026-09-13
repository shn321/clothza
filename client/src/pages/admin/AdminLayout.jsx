import { useState } from 'react'
import { FileText, LayoutDashboard, Menu, Package, ShoppingBag, Star, Tag, Users, X } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'

/* Admin shell — responsive sidebar on desktop, collapsible drawer on
   mobile. Keeps the CLOTHZA palette (ivory/charcoal/linen/bronze). */

const NAV = [
  { to: '/admin', end: true, label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/admin/products', label: 'Products', Icon: Package },
  { to: '/admin/orders', label: 'Orders', Icon: ShoppingBag },
  { to: '/admin/reviews', label: 'Reviews', Icon: Star },
  { to: '/admin/coupons', label: 'Coupons', Icon: Tag },
  { to: '/admin/customers', label: 'Customers', Icon: Users },
  { to: '/admin/content', label: 'Content', Icon: FileText },
]

function navClass({ isActive }) {
  return `flex items-center gap-3 rounded-[3px] px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
    isActive ? 'bg-charcoal text-ivory' : 'text-charcoal/75 hover:bg-charcoal/5 hover:text-charcoal'
  }`
}

function AdminNav({ onNavigate }) {
  return (
    <nav aria-label="Admin navigation" className="flex flex-col gap-1">
      {NAV.map(({ to, end, label, Icon }) => (
        <NavLink key={to} to={to} end={end} className={navClass} onClick={onNavigate}>
          <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

function AdminLayout() {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <div className="bg-ivory text-charcoal">
      <div className="clothza-container !max-w-7xl py-6 md:py-10">
        {/* Mobile admin bar */}
        <div className="mb-4 flex items-center justify-between md:hidden">
          <p className="type-label">CLOTHZA · Admin</p>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close admin menu' : 'Open admin menu'}
            aria-expanded={open}
            className="inline-flex items-center gap-2 rounded-[3px] border border-linen bg-porcelain px-3 py-2 text-sm font-medium"
          >
            {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            Menu
          </button>
        </div>

        <div className="grid gap-6 md:grid-cols-[240px_1fr]">
          {/* Sidebar — desktop */}
          <aside className="hidden md:block">
            <div className="card sticky top-24 p-4">
              <p className="type-label px-1 pb-3">CLOTHZA · Admin</p>
              <AdminNav />
              <hr className="divider my-4" />
              <Link to="/" className="btn btn-ghost w-full !justify-start text-sm">
                ← Back to store
              </Link>
            </div>
          </aside>

          {/* Sidebar — mobile drawer */}
          {open && (
            <div className="card p-4 md:hidden">
              <AdminNav onNavigate={close} />
              <hr className="divider my-4" />
              <Link to="/" className="btn btn-ghost w-full !justify-start text-sm">
                ← Back to store
              </Link>
            </div>
          )}

          {/* Main content */}
          <div className="min-w-0">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminLayout
