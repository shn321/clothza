import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import AccessDenied from '../../pages/admin/AccessDenied.jsx'

/* Gate for /admin routes — authentication AND the server-backed admin
   role. The frontend check is convenience only; /api/admin enforces
   requireAuth + requireAdmin on every request. */

function AdminRoute({ children }) {
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

  if (user.role !== 'admin') {
    return <AccessDenied />
  }

  return children
}

export default AdminRoute
