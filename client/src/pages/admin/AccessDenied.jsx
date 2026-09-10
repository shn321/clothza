import { Link } from 'react-router-dom'

/* Rendered for signed-in non-admin users visiting /admin — no admin
   data is fetched or shown here. */

function AccessDenied() {
  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container clothza-section mx-auto max-w-xl text-center">
        <p className="type-label">Admin area</p>
        <h1 className="type-h1 mt-3">Access denied</h1>
        <p className="type-body-muted mt-4">
          This section is reserved for CLOTHZA administrators. If you believe you should have
          access, please contact the store owner.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/" className="btn btn-primary">
            Back to store
          </Link>
          <Link to="/account" className="btn btn-secondary">
            My account
          </Link>
        </div>
      </div>
    </main>
  )
}

export default AccessDenied
