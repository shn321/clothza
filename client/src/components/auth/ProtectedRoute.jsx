import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'

/* Reusable gate for authenticated-only pages (e.g. /account).
   While the session is restoring, a minimal loading state renders so an
   already-logged-in user is never flashed to /login on refresh. */

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <main className="bg-ivory text-charcoal" aria-busy="true" aria-label="Checking your session">
        <div className="clothza-container clothza-section">
          <p className="type-body-muted">Checking your session…</p>
        </div>
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}

export default ProtectedRoute
