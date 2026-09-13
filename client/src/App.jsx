import { Navigate, Route, Routes } from 'react-router-dom'
import AdminRoute from './components/auth/AdminRoute.jsx'
import ProtectedRoute from './components/auth/ProtectedRoute.jsx'
import Footer from './components/layout/Footer.jsx'
import Navbar from './components/layout/Navbar.jsx'
import Account from './pages/Account.jsx'
import OrderDetail from './pages/account/OrderDetail.jsx'
import Notifications from './pages/account/Notifications.jsx'
import AdminLayout from './pages/admin/AdminLayout.jsx'
import Content from './pages/admin/Content.jsx'
import CouponForm from './pages/admin/CouponForm.jsx'
import Coupons from './pages/admin/Coupons.jsx'
import Customers from './pages/admin/Customers.jsx'
import Dashboard from './pages/admin/Dashboard.jsx'
import MediaLibrary from './pages/admin/MediaLibrary.jsx'
import OrderDetailAdmin from './pages/admin/OrderDetail.jsx'
import Orders from './pages/admin/Orders.jsx'
import Reviews from './pages/admin/Reviews.jsx'
import ProductForm from './pages/admin/ProductForm.jsx'
import Products from './pages/admin/Products.jsx'
import Cart from './pages/Cart.jsx'
import Checkout from './pages/Checkout.jsx'
import Collections from './pages/Collections.jsx'
import Home from './pages/Home.jsx'
import Login from './pages/Login.jsx'
import Men from './pages/Men.jsx'
import OrderConfirmation from './pages/OrderConfirmation.jsx'
import Placeholder from './pages/Placeholder.jsx'
import ProductDetail from './pages/ProductDetail.jsx'
import Register from './pages/Register.jsx'
import Shop from './pages/Shop.jsx'
import Wishlist from './pages/Wishlist.jsx'
import Women from './pages/Women.jsx'

function App() {
  return (
    <div className="flex min-h-screen flex-col bg-ivory text-charcoal">
      <Navbar />
      <div className="flex-1">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/shop" element={<Shop />} />
        {/* Alias for search Enter-key ("new arrivals"): reuses the existing
            Shop newest-sort view instead of a duplicate page. */}
        <Route path="/new-arrivals" element={<Navigate to="/shop?sort=newest" replace />} />
        <Route path="/product/:slug" element={<ProductDetail />} />
        <Route path="/men" element={<Men />} />
        <Route path="/women" element={<Women />} />
        <Route path="/collections" element={<Collections />} />
        <Route
          path="/account"
          element={
            <ProtectedRoute>
              <Account />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account/orders/:orderNumber"
          element={
            <ProtectedRoute>
              <OrderDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account/notifications"
          element={
            <ProtectedRoute>
              <Notifications />
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        {/* Admin — authentication + admin role enforced by AdminRoute;
            every /api/admin request is re-authorized server-side. */}
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminLayout />
            </AdminRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="products" element={<Products />} />
          <Route path="products/new" element={<ProductForm />} />
          <Route path="products/:id/edit" element={<ProductForm />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/:orderNumber" element={<OrderDetailAdmin />} />
          <Route path="reviews" element={<Reviews />} />
          <Route path="coupons" element={<Coupons />} />
          <Route path="coupons/new" element={<CouponForm />} />
          <Route path="coupons/:id/edit" element={<CouponForm />} />
          <Route path="customers" element={<Customers />} />
          <Route path="content" element={<Content />} />
          <Route path="content/media" element={<MediaLibrary />} />
        </Route>
        <Route path="/wishlist" element={<Wishlist />} />
        <Route path="/cart" element={<Cart />} />
        <Route
          path="/checkout"
          element={
            <ProtectedRoute>
              <Checkout />
            </ProtectedRoute>
          }
        />
        <Route path="/order-confirmation" element={<OrderConfirmation />} />
        <Route
          path="/contact"
          element={
            <Placeholder page="contact" eyebrow="Contact" title="Contact" note="Minimal placeholder. Contact page comes later." />
          }
        />
        <Route
          path="/shipping"
          element={
            <Placeholder page="shipping" eyebrow="Shipping" title="Shipping" note="Minimal placeholder. Shipping info comes later." />
          }
        />
        <Route
          path="/returns"
          element={
            <Placeholder page="returns" eyebrow="Returns" title="Returns" note="Minimal placeholder. Returns info comes later." />
          }
        />
        <Route
          path="/faq"
          element={
            <Placeholder page="faq" eyebrow="FAQ" title="FAQ" note="Minimal placeholder. FAQ page comes later." />
          }
        />
        <Route
          path="/about"
          element={
            <Placeholder page="about" eyebrow="About" title="About" note="Minimal placeholder. About page comes later." />
          }
        />
        <Route
          path="/privacy"
          element={
            <Placeholder eyebrow="Privacy" title="Privacy" note="Minimal placeholder. Privacy page comes later." />
          }
        />
        <Route
          path="/terms"
          element={
            <Placeholder eyebrow="Terms" title="Terms" note="Minimal placeholder. Terms page comes later." />
          }
        />
        <Route
          path="*"
          element={
            <Placeholder eyebrow="Not found" title="Page not found" note="This route does not exist yet." />
          }
        />
      </Routes>
      </div>
      <Footer />
    </div>
  )
}

export default App
