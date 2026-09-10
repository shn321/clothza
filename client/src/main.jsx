import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { CartProvider } from './context/CartContext.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { NotificationProvider } from './context/NotificationContext.jsx'
import { ProductsProvider } from './context/ProductsContext.jsx'
import { WishlistProvider } from './context/WishlistContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
      <CartProvider>
        <ProductsProvider>
          <WishlistProvider>
            <NotificationProvider>
              <App />
            </NotificationProvider>
          </WishlistProvider>
        </ProductsProvider>
      </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
